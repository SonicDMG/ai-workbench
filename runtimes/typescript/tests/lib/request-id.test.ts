/**
 * `requestId` middleware tests — covers W3C trace-context parsing
 * (`traceparent`) alongside the legacy `X-Request-Id` behavior.
 */

import { Hono } from "hono";
import { describe, expect, test } from "vitest";
import { requestId } from "../../src/lib/request-id.js";
import type { AppEnv } from "../../src/lib/types.js";

function makeApp() {
	const app = new Hono<AppEnv>();
	app.use("*", requestId());
	app.get("/x", (c) => c.json({ id: c.get("requestId") }));
	return app;
}

describe("requestId middleware", () => {
	test("generates a fresh ULID when no incoming header is present", async () => {
		const app = makeApp();
		const res = await app.request("/x");
		const body = (await res.json()) as { id: string };
		expect(body.id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
		expect(res.headers.get("X-Request-Id")).toBe(body.id);
	});

	test("honors an incoming X-Request-Id header verbatim", async () => {
		const app = makeApp();
		const res = await app.request("/x", {
			headers: { "x-request-id": "client-supplied-id" },
		});
		const body = (await res.json()) as { id: string };
		expect(body.id).toBe("client-supplied-id");
		expect(res.headers.get("X-Request-Id")).toBe("client-supplied-id");
	});

	test("extracts the trace-id from a valid `traceparent` header and uses it as the request id", async () => {
		const app = makeApp();
		const traceId = "0af7651916cd43dd8448eb211c80319c";
		const tp = `00-${traceId}-b7ad6b7169203331-01`;
		const res = await app.request("/x", { headers: { traceparent: tp } });
		const body = (await res.json()) as { id: string };
		expect(body.id).toBe(traceId);
		expect(res.headers.get("X-Request-Id")).toBe(traceId);
		// The original traceparent should also be echoed so the
		// downstream consumer can keep correlating.
		expect(res.headers.get("traceparent")).toBe(tp);
	});

	test("ignores a malformed `traceparent` and falls back to ULID generation", async () => {
		const app = makeApp();
		const res = await app.request("/x", {
			headers: { traceparent: "not-a-valid-traceparent" },
		});
		const body = (await res.json()) as { id: string };
		expect(body.id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
	});

	test("emits a synthesized `traceparent` on every response", async () => {
		const app = makeApp();
		const res = await app.request("/x");
		const tp = res.headers.get("traceparent");
		expect(tp).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-0[01]$/);
	});

	test("X-Request-Id wins when BOTH it and traceparent are present (operator override)", async () => {
		const app = makeApp();
		const tp = "00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01";
		const res = await app.request("/x", {
			headers: { "x-request-id": "override", traceparent: tp },
		});
		const body = (await res.json()) as { id: string };
		expect(body.id).toBe("override");
	});
});
