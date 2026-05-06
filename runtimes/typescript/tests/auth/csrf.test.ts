import { Hono } from "hono";
import { describe, expect, test } from "vitest";
import { csrfOriginCheck } from "../../src/auth/csrf.js";
import { ApiError } from "../../src/lib/errors.js";
import type { AppEnv } from "../../src/lib/types.js";

/**
 * Mount the middleware under `/api/v1/workspaces/*` (its production
 * path) plus a stub handler that returns 200 for anything that gets
 * past the gate. Errors from the middleware are surfaced via Hono's
 * `onError` so tests can assert on status code + error code without
 * pulling in the full runtime.
 */
function makeApp(opts: {
	readonly publicOrigin: string | null;
	readonly trustProxyHeaders?: boolean;
}): Hono<AppEnv> {
	const app = new Hono<AppEnv>();
	app.use(
		"/api/v1/workspaces/*",
		csrfOriginCheck({
			publicOrigin: opts.publicOrigin,
			trustProxyHeaders: opts.trustProxyHeaders ?? false,
		}),
	);
	app.all("/api/v1/workspaces/*", (c) => c.json({ ok: true }));
	app.onError((err, c) => {
		if (err instanceof ApiError) {
			return c.json({ error: { code: err.code } }, err.status);
		}
		return c.json({ error: { code: "internal_error" } }, 500);
	});
	return app;
}

const ALLOWED = "https://workbench.example.com";

describe("csrfOriginCheck", () => {
	describe("with publicOrigin configured", () => {
		const app = makeApp({ publicOrigin: ALLOWED });

		test("allows GET without Origin", async () => {
			const res = await app.request("/api/v1/workspaces/abc");
			expect(res.status).toBe(200);
		});

		test("allows POST with matching Origin", async () => {
			const res = await app.request("/api/v1/workspaces", {
				method: "POST",
				headers: { origin: ALLOWED },
			});
			expect(res.status).toBe(200);
		});

		test("rejects POST with mismatching Origin", async () => {
			const res = await app.request("/api/v1/workspaces", {
				method: "POST",
				headers: { origin: "https://evil.example.com" },
			});
			expect(res.status).toBe(403);
			const body = (await res.json()) as { error: { code: string } };
			expect(body.error.code).toBe("forbidden_origin");
		});

		test("rejects POST with no Origin and no Referer", async () => {
			const res = await app.request("/api/v1/workspaces", {
				method: "POST",
			});
			expect(res.status).toBe(403);
		});

		test("falls back to Referer when Origin is missing", async () => {
			const res = await app.request("/api/v1/workspaces", {
				method: "POST",
				headers: { referer: `${ALLOWED}/playground` },
			});
			expect(res.status).toBe(200);
		});

		test("rejects when Referer host is foreign", async () => {
			const res = await app.request("/api/v1/workspaces", {
				method: "POST",
				headers: { referer: "https://evil.example.com/x" },
			});
			expect(res.status).toBe(403);
		});

		test("bypasses the check on Bearer-token requests", async () => {
			// No Origin, no Referer, but a Bearer token. Programmatic
			// clients are not in the CSRF surface.
			const res = await app.request("/api/v1/workspaces", {
				method: "POST",
				headers: { authorization: "Bearer wb_live_xxx_yyy" },
			});
			expect(res.status).toBe(200);
		});

		test.each([
			"DELETE",
			"PATCH",
			"PUT",
		])("covers state-changing %s", async (method) => {
			const res = await app.request("/api/v1/workspaces/x", { method });
			expect(res.status).toBe(403);
		});

		test("treats OPTIONS preflight as safe", async () => {
			const res = await app.request("/api/v1/workspaces", {
				method: "OPTIONS",
			});
			expect(res.status).toBe(200);
		});
	});

	describe("without publicOrigin (effective-origin fallback)", () => {
		const app = makeApp({ publicOrigin: null });

		test("allows POST whose Origin matches the request's own host", async () => {
			const res = await app.request("http://localhost:8080/api/v1/workspaces", {
				method: "POST",
				headers: { origin: "http://localhost:8080" },
			});
			expect(res.status).toBe(200);
		});

		test("rejects POST whose Origin does not match the request's own host", async () => {
			const res = await app.request("http://localhost:8080/api/v1/workspaces", {
				method: "POST",
				headers: { origin: "http://attacker.localhost" },
			});
			expect(res.status).toBe(403);
		});
	});

	describe("trustProxyHeaders", () => {
		test("honors X-Forwarded-Proto / X-Forwarded-Host when on", async () => {
			const app = makeApp({
				publicOrigin: null,
				trustProxyHeaders: true,
			});
			const res = await app.request("http://localhost:8080/api/v1/workspaces", {
				method: "POST",
				headers: {
					origin: "https://workbench.example.com",
					"x-forwarded-proto": "https",
					"x-forwarded-host": "workbench.example.com",
				},
			});
			expect(res.status).toBe(200);
		});

		test("ignores X-Forwarded-* when off", async () => {
			const app = makeApp({
				publicOrigin: null,
				trustProxyHeaders: false,
			});
			// Without trustProxyHeaders, the effective origin is the
			// request's actual `Host` (localhost:8080), so a forwarded
			// claim of being workbench.example.com is ignored and the
			// foreign Origin is rejected.
			const res = await app.request("http://localhost:8080/api/v1/workspaces", {
				method: "POST",
				headers: {
					origin: "https://workbench.example.com",
					"x-forwarded-proto": "https",
					"x-forwarded-host": "workbench.example.com",
				},
			});
			expect(res.status).toBe(403);
		});
	});
});
