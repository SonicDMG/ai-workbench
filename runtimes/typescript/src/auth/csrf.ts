/**
 * CSRF defense for cookie-authenticated browser flows.
 *
 * Browsers automatically attach session cookies to cross-site requests,
 * which is the whole CSRF attack surface. Our session cookie is set
 * `SameSite=Strict`, which already blocks cross-site automatic
 * inclusion in modern browsers — but layering an `Origin` / `Referer`
 * check is the standard belt-and-braces approach (OWASP) and protects
 * users on legacy or misconfigured browsers and against gadgets that
 * coerce same-site contexts (subdomain takeover, naming collisions).
 *
 * What this middleware does on a state-changing request
 * (POST/PUT/PATCH/DELETE):
 *
 *   1. If `Authorization: Bearer …` is present, skip. Bearer-token
 *      clients are programmatic; tokens are NOT auto-attached by
 *      browsers, so CSRF doesn't apply.
 *   2. Otherwise, read `Origin`. If missing, fall back to `Referer`
 *      and consider only its `origin`.
 *   3. Compare the resulting origin to the allowed origin (the
 *      configured `runtime.publicOrigin`, or the request's own
 *      effective origin when `publicOrigin` is null).
 *   4. Mismatch → 403 `forbidden_origin`.
 *   5. Both headers missing → 403 `forbidden_origin`. A modern browser
 *      always sends one or the other on a state-changing same-origin
 *      request; programmatic clients can either set `Origin` to the
 *      runtime's origin or use Bearer auth.
 *
 * Safe methods (GET / HEAD / OPTIONS) are not checked — they MUST NOT
 * have side effects per RFC 9110, so CSRF is moot.
 *
 * The check is intentionally process-local and stateless. No token
 * storage, no per-form nonces — those are noise on top of a
 * cookie-based session that already has SameSite + this Origin gate.
 */

import type { MiddlewareHandler } from "hono";
import { audit } from "../lib/audit.js";
import { ApiError } from "../lib/errors.js";
import type { AppEnv } from "../lib/types.js";

/**
 * Methods that, by RFC 9110, MUST NOT have side effects. Skip CSRF on
 * these to avoid breaking probes, conditional GETs, and OPTIONS preflight.
 */
const SAFE_METHODS: ReadonlySet<string> = new Set([
	"GET",
	"HEAD",
	"OPTIONS",
	"TRACE",
]);

export interface CsrfOriginOptions {
	/**
	 * Allowed origin for state-changing browser requests, e.g.
	 * "https://workbench.example.com". When `null`, the middleware
	 * derives the allowed origin from the incoming request itself
	 * (`Host` + scheme, or `X-Forwarded-*` if `trustProxyHeaders` is
	 * true). Set this in production deployments — relying on `Host`
	 * is only safe behind a reverse proxy that strips inbound
	 * `Host`/`X-Forwarded-*` you don't control.
	 */
	readonly publicOrigin: string | null;

	/**
	 * Mirror of `runtime.trustProxyHeaders`. When true, the effective
	 * scheme/host for the "request's own origin" fallback is taken
	 * from `X-Forwarded-Proto` / `X-Forwarded-Host` if present.
	 */
	readonly trustProxyHeaders: boolean;
}

/**
 * Strip a URL down to its `scheme://host[:port]` form. Returns `null`
 * for inputs that aren't valid absolute URLs, which the caller treats
 * as "no usable origin claim."
 */
function originOf(rawUrl: string | null | undefined): string | null {
	if (!rawUrl) return null;
	try {
		const u = new URL(rawUrl);
		return u.origin;
	} catch {
		return null;
	}
}

/**
 * Effective origin for "what does THIS request think it is?" — used
 * when no `publicOrigin` is configured. Honors `X-Forwarded-Proto` and
 * `X-Forwarded-Host` only if `trustProxyHeaders` is true; otherwise
 * uses `Host` and the request URL's scheme.
 */
function effectiveRequestOrigin(
	req: Request,
	trustProxyHeaders: boolean,
): string | null {
	const reqUrl = (() => {
		try {
			return new URL(req.url);
		} catch {
			return null;
		}
	})();
	if (!reqUrl) return null;

	let scheme: string | undefined = reqUrl.protocol.replace(/:$/, "");
	let host: string | undefined = reqUrl.host;
	if (trustProxyHeaders) {
		const xfp = req.headers.get("x-forwarded-proto");
		const xfh = req.headers.get("x-forwarded-host");
		// `String.split` always yields at least one element, so the
		// optional chain is defensive against a future stricter typing
		// — `?.trim()` keeps the result narrowed to `string | undefined`.
		if (xfp) scheme = xfp.split(",", 1)[0]?.trim();
		if (xfh) host = xfh.split(",", 1)[0]?.trim();
	}
	if (!scheme || !host) return null;
	return `${scheme}://${host}`;
}

/**
 * Build the CSRF middleware. Mount on the routes that accept session
 * cookies: `/api/v1/workspaces/*` (state-changing methods only) and
 * `/auth/refresh` + `/auth/logout`.
 */
export function csrfOriginCheck(
	opts: CsrfOriginOptions,
): MiddlewareHandler<AppEnv> {
	const configured = originOf(opts.publicOrigin);
	return async (c, next) => {
		if (SAFE_METHODS.has(c.req.method.toUpperCase())) {
			return next();
		}

		const req = c.req.raw;
		const auth = req.headers.get("authorization");
		if (auth?.toLowerCase().startsWith("bearer ")) {
			// Programmatic client. Bearer tokens are not auto-attached
			// by browsers, so this request is not in the CSRF attack
			// surface.
			return next();
		}

		const allowed =
			configured ?? effectiveRequestOrigin(req, opts.trustProxyHeaders);
		if (!allowed) {
			// Without an allowed origin we can't make a safe decision.
			// Refuse closed.
			return rejectAsCsrf(c, "no allowed origin available");
		}

		const claimed =
			originOf(req.headers.get("origin")) ??
			originOf(req.headers.get("referer"));
		if (!claimed) {
			return rejectAsCsrf(
				c,
				"missing Origin and Referer on state-changing request",
			);
		}
		if (claimed !== allowed) {
			return rejectAsCsrf(c, `origin mismatch (got ${claimed})`);
		}
		return next();
	};
}

function rejectAsCsrf(
	c: Parameters<MiddlewareHandler<AppEnv>>[0],
	reason: string,
): never {
	audit(c, {
		action: "auth.csrf_rejected",
		outcome: "failure",
		// `AuditDetails` is intentionally an allowlist; method + path
		// are folded into `reason` rather than added as new fields so
		// every emitter stays inside the documented schema.
		details: { reason: `${c.req.method} ${c.req.path}: ${reason}` },
	});
	throw new ApiError("forbidden_origin", "request origin not allowed", 403);
}
