import { Hono } from "hono";
import { describe, expect, test } from "vitest";
import { FixedWindowLimiter, rateLimit } from "../../src/lib/rate-limit.js";
import { requestId } from "../../src/lib/request-id.js";
import type { AppEnv } from "../../src/lib/types.js";

describe("FixedWindowLimiter", () => {
	test("allows requests up to capacity then rejects", () => {
		const limiter = new FixedWindowLimiter(3, 1_000);
		const t0 = 0;
		expect(limiter.consume("k", t0)).toMatchObject({
			allowed: true,
			remaining: 2,
		});
		expect(limiter.consume("k", t0)).toMatchObject({
			allowed: true,
			remaining: 1,
		});
		expect(limiter.consume("k", t0)).toMatchObject({
			allowed: true,
			remaining: 0,
		});
		const denied = limiter.consume("k", t0);
		expect(denied.allowed).toBe(false);
		expect(denied.remaining).toBe(0);
		expect(denied.resetMs).toBeGreaterThan(0);
	});

	test("resets the counter after the window elapses", () => {
		const limiter = new FixedWindowLimiter(2, 1_000);
		expect(limiter.consume("k", 0).allowed).toBe(true);
		expect(limiter.consume("k", 0).allowed).toBe(true);
		expect(limiter.consume("k", 0).allowed).toBe(false);
		// Cross the window boundary — bucket recycles.
		expect(limiter.consume("k", 1_000).allowed).toBe(true);
	});

	test("isolates buckets per key", () => {
		const limiter = new FixedWindowLimiter(1, 1_000);
		expect(limiter.consume("a", 0).allowed).toBe(true);
		expect(limiter.consume("a", 0).allowed).toBe(false);
		expect(limiter.consume("b", 0).allowed).toBe(true);
	});

	test("garbage-collects expired buckets on subsequent calls", () => {
		const limiter = new FixedWindowLimiter(1, 1_000);
		limiter.consume("a", 0);
		limiter.consume("b", 0);
		expect(limiter.size()).toBe(2);
		// First call across the window boundary triggers a sweep.
		limiter.consume("c", 5_000);
		expect(limiter.size()).toBe(1);
	});

	test("rejects invalid configuration", () => {
		expect(() => new FixedWindowLimiter(0, 1_000)).toThrow(/positive integer/);
		expect(() => new FixedWindowLimiter(1, 0)).toThrow(/positive integer/);
	});
});

describe("rateLimit middleware", () => {
	function buildApp(opts: {
		capacity: number;
		windowMs: number;
		now: () => number;
		key?: string;
	}) {
		const app = new Hono<AppEnv>();
		app.use("*", requestId());
		app.use(
			"/api/v1/*",
			rateLimit({
				capacity: opts.capacity,
				windowMs: opts.windowMs,
				now: opts.now,
				keyOf: () => opts.key ?? "test-key",
			}),
		);
		app.get("/api/v1/ping", (c) => c.json({ ok: true }));
		app.get("/healthz", (c) => c.json({ status: "ok" }));
		return app;
	}

	test("emits X-RateLimit-* headers on every response", async () => {
		const app = buildApp({ capacity: 5, windowMs: 60_000, now: () => 0 });
		const res = await app.request("/api/v1/ping");
		expect(res.status).toBe(200);
		expect(res.headers.get("X-RateLimit-Limit")).toBe("5");
		expect(res.headers.get("X-RateLimit-Remaining")).toBe("4");
		expect(res.headers.get("X-RateLimit-Reset")).toBe("60");
	});

	test("returns 429 with envelope and Retry-After when capacity is exhausted", async () => {
		const app = buildApp({ capacity: 2, windowMs: 60_000, now: () => 0 });
		await app.request("/api/v1/ping");
		await app.request("/api/v1/ping");
		const res = await app.request("/api/v1/ping");
		expect(res.status).toBe(429);
		expect(res.headers.get("Retry-After")).toBe("60");
		expect(res.headers.get("X-RateLimit-Remaining")).toBe("0");
		const body = (await res.json()) as {
			error: { code: string; requestId: string };
		};
		expect(body.error.code).toBe("rate_limited");
		expect(body.error.requestId).toBeTruthy();
	});

	test("does not apply outside the configured scope", async () => {
		const app = buildApp({ capacity: 1, windowMs: 60_000, now: () => 0 });
		await app.request("/api/v1/ping"); // burns the quota
		const exhausted = await app.request("/api/v1/ping");
		expect(exhausted.status).toBe(429);
		// /healthz isn't under /api/v1/* — must stay open.
		const open = await app.request("/healthz");
		expect(open.status).toBe(200);
		expect(open.headers.get("X-RateLimit-Limit")).toBeNull();
	});

	test("recovers after the window advances", async () => {
		let now = 0;
		const app = buildApp({
			capacity: 1,
			windowMs: 1_000,
			now: () => now,
		});
		expect((await app.request("/api/v1/ping")).status).toBe(200);
		expect((await app.request("/api/v1/ping")).status).toBe(429);
		now = 1_000;
		expect((await app.request("/api/v1/ping")).status).toBe(200);
	});

	test("buckets are isolated per key", async () => {
		let key = "client-a";
		const app = new Hono<AppEnv>();
		app.use("*", requestId());
		app.use(
			"/api/v1/*",
			rateLimit({
				capacity: 1,
				windowMs: 60_000,
				now: () => 0,
				keyOf: () => key,
			}),
		);
		app.get("/api/v1/ping", (c) => c.json({ ok: true }));
		expect((await app.request("/api/v1/ping")).status).toBe(200);
		expect((await app.request("/api/v1/ping")).status).toBe(429);
		key = "client-b";
		expect((await app.request("/api/v1/ping")).status).toBe(200);
	});
});
