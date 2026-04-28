/**
 * In-process, IP-keyed rate limiter for the public API surface.
 *
 * This is intentionally a defense-in-depth layer, not a replacement
 * for an upstream WAF / API gateway. A single replica's bucket map is
 * not shared across replicas, so distributed deployments should still
 * front the runtime with a network-level limiter. What this buys us:
 *
 *   - Cheap protection against accidental client loops and naive
 *     credential-stuffing attempts on `/api/v1/*` and `/auth/*`.
 *   - Surface-level `429 Too Many Requests` envelopes that match the
 *     OpenAPI contract (we already advertise 429 on every workspace
 *     route).
 *
 * Algorithm: fixed-window counter. Picked over token-bucket because
 * its state is `{ count, windowStart }` per key — trivial to reason
 * about, easy to test deterministically with an injected clock, and
 * GC is a single sweep. Burstiness at window boundaries (the classic
 * fixed-window flaw) is acceptable here — the goal is throttling
 * abuse, not precise QoS.
 */
import type { Context, MiddlewareHandler } from "hono";
import { errorEnvelope } from "./errors.js";
import type { AppEnv } from "./types.js";

export interface RateLimitOptions {
	/** Max requests per `windowMs` per key. */
	readonly capacity: number;
	/** Window length in milliseconds. */
	readonly windowMs: number;
	/**
	 * Honor `X-Forwarded-For` / `X-Real-IP` when computing the client
	 * key. Only enable when the runtime sits behind a reverse proxy
	 * that overwrites these headers — otherwise clients can spoof
	 * their bucket key and bypass the limit.
	 */
	readonly trustProxyHeaders?: boolean;
	/** Override the key function (tests). Receives the request context. */
	readonly keyOf?: (c: Context<AppEnv>) => string;
	/** Injectable clock (tests). Defaults to `Date.now`. */
	readonly now?: () => number;
}

interface Bucket {
	count: number;
	windowStart: number;
}

export interface RateLimitDecision {
	readonly allowed: boolean;
	readonly remaining: number;
	readonly resetMs: number;
}

const KEY_UNKNOWN = "unknown";

/**
 * Stateless-from-the-caller's-POV limiter. Holds its own Map; tests
 * can construct one directly to assert decisions without spinning up
 * the whole Hono app.
 */
export class FixedWindowLimiter {
	private readonly buckets = new Map<string, Bucket>();
	private lastSweep: number;

	constructor(
		private readonly capacity: number,
		private readonly windowMs: number,
	) {
		if (!Number.isInteger(capacity) || capacity < 1) {
			throw new Error("rate-limit capacity must be a positive integer");
		}
		if (!Number.isInteger(windowMs) || windowMs < 1) {
			throw new Error("rate-limit windowMs must be a positive integer");
		}
		this.lastSweep = 0;
	}

	consume(key: string, now: number): RateLimitDecision {
		this.maybeSweep(now);
		const existing = this.buckets.get(key);
		if (!existing || now - existing.windowStart >= this.windowMs) {
			const bucket: Bucket = { count: 1, windowStart: now };
			this.buckets.set(key, bucket);
			return {
				allowed: true,
				remaining: this.capacity - 1,
				resetMs: this.windowMs,
			};
		}
		const elapsed = now - existing.windowStart;
		const resetMs = Math.max(0, this.windowMs - elapsed);
		if (existing.count >= this.capacity) {
			return { allowed: false, remaining: 0, resetMs };
		}
		const next: Bucket = {
			count: existing.count + 1,
			windowStart: existing.windowStart,
		};
		this.buckets.set(key, next);
		return {
			allowed: true,
			remaining: this.capacity - next.count,
			resetMs,
		};
	}

	/** Drop expired buckets so the map doesn't grow without bound. */
	private maybeSweep(now: number): void {
		// Sweep at most once per window — a single full traversal per
		// window is plenty for the small key cardinality we expect
		// (clients per replica). If the limiter ever needs to run hot
		// enough that this matters, swap to a TTL cache.
		if (now - this.lastSweep < this.windowMs) return;
		this.lastSweep = now;
		for (const [key, bucket] of this.buckets) {
			if (now - bucket.windowStart >= this.windowMs) {
				this.buckets.delete(key);
			}
		}
	}

	/** Test-only — exposes the current size. */
	size(): number {
		return this.buckets.size;
	}
}

/**
 * Build the per-request key. Order of preference:
 *   1. The first IP in `X-Forwarded-For` (when proxy headers are
 *      trusted) — this is the originating client when behind one or
 *      more reverse proxies.
 *   2. `X-Real-IP` (also proxy-trusted) for setups that prefer it.
 *   3. The remote socket address from `@hono/node-server`'s
 *      `c.env.incoming.socket`.
 *   4. The literal `"unknown"` — same bucket for every keyless call,
 *      which is fine: the limit then applies to that aggregate.
 */
function defaultKeyOf(c: Context<AppEnv>, trustProxyHeaders: boolean): string {
	if (trustProxyHeaders) {
		const xff = c.req.header("x-forwarded-for");
		if (xff) {
			const first = xff.split(",")[0]?.trim();
			if (first) return `ip:${first}`;
		}
		const xri = c.req.header("x-real-ip");
		if (xri?.trim()) return `ip:${xri.trim()}`;
	}
	// `c.env` is provided by @hono/node-server; in unit tests using
	// `app.request()` it's an empty object, so this read is best-effort.
	const env = c.env as
		| { incoming?: { socket?: { remoteAddress?: string } } }
		| undefined;
	const remote = env?.incoming?.socket?.remoteAddress;
	if (remote?.trim()) return `ip:${remote.trim()}`;
	return `ip:${KEY_UNKNOWN}`;
}

/**
 * Hono middleware factory. Drop into `app.use(scope, rateLimit({...}))`.
 * On rejection it returns a `429` carrying the canonical error
 * envelope and the standard `Retry-After` + `X-RateLimit-*` headers.
 */
export function rateLimit(opts: RateLimitOptions): MiddlewareHandler<AppEnv> {
	const limiter = new FixedWindowLimiter(opts.capacity, opts.windowMs);
	const trustProxyHeaders = opts.trustProxyHeaders ?? false;
	const now = opts.now ?? (() => Date.now());
	const keyOf =
		opts.keyOf ?? ((c: Context<AppEnv>) => defaultKeyOf(c, trustProxyHeaders));

	return async (c, next) => {
		const key = keyOf(c);
		const decision = limiter.consume(key, now());
		const resetSeconds = Math.ceil(decision.resetMs / 1000);
		c.header("X-RateLimit-Limit", String(opts.capacity));
		c.header("X-RateLimit-Remaining", String(decision.remaining));
		c.header("X-RateLimit-Reset", String(resetSeconds));
		if (!decision.allowed) {
			c.header("Retry-After", String(resetSeconds));
			return c.json(
				errorEnvelope(
					c,
					"rate_limited",
					`rate limit exceeded; retry after ${resetSeconds}s`,
				),
				429,
			);
		}
		await next();
	};
}
