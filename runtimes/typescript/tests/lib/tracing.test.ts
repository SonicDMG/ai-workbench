/**
 * Manual server-span tests for the `requestTracing` middleware.
 *
 * Approach: register a tiny in-memory tracer provider, run the
 * middleware in a Hono app, assert the recorded spans.
 *
 * Without an SDK registered, `@opentelemetry/api` returns no-op spans
 * (already covered by the no-op-by-default behavior — exercised by
 * every other test in this repo since the middleware is mounted in
 * `app.ts` and existing app tests pass with no SDK).
 */

import {
	type ReadableSpan,
	SimpleSpanProcessor,
	type SpanExporter,
} from "@opentelemetry/sdk-trace-base";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import { Hono } from "hono";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { ApiError } from "../../src/lib/errors.js";
import { requestId } from "../../src/lib/request-id.js";
import { requestTracing } from "../../src/lib/tracing.js";
import type { AppEnv } from "../../src/lib/types.js";

class CollectingExporter implements SpanExporter {
	readonly spans: ReadableSpan[] = [];
	export(
		spans: ReadableSpan[],
		resultCallback: (result: { code: number }) => void,
	): void {
		this.spans.push(...spans);
		resultCallback({ code: 0 });
	}
	async shutdown(): Promise<void> {
		this.spans.length = 0;
	}
}

const exporter = new CollectingExporter();
const provider = new NodeTracerProvider({
	spanProcessors: [new SimpleSpanProcessor(exporter)],
});

beforeAll(() => {
	provider.register();
});

afterAll(async () => {
	await provider.shutdown();
});

function makeApp(): Hono<AppEnv> {
	const app = new Hono<AppEnv>();
	app.use("*", requestId());
	app.use("*", requestTracing());
	app.get("/api/v1/workspaces/:wid", (c) => c.json({ ok: true }));
	app.get("/boom", () => {
		throw new ApiError("boom_code", "kaboom", 500);
	});
	app.onError((err, c) => {
		if (err instanceof ApiError) {
			return c.json({ error: { code: err.code } }, err.status);
		}
		return c.json({ error: { code: "internal_error" } }, 500);
	});
	return app;
}

describe("requestTracing", () => {
	test("creates a SERVER span with method + path attributes", async () => {
		exporter.spans.length = 0;
		const app = makeApp();
		const res = await app.request("/api/v1/workspaces/abc");
		expect(res.status).toBe(200);

		const [span] = exporter.spans;
		if (!span) throw new Error("exporter did not capture a span");
		expect(span.name).toBe("GET /api/v1/workspaces/abc");
		expect(span.attributes["http.request.method"]).toBe("GET");
		expect(span.attributes["url.path"]).toBe("/api/v1/workspaces/abc");
		expect(span.attributes["http.response.status_code"]).toBe(200);
		// `http.route` is the matched pattern (low cardinality).
		expect(span.attributes["http.route"]).toBe("/api/v1/workspaces/:wid");
		// Request id is attached as a span attribute.
		expect(typeof span.attributes["wb.request_id"]).toBe("string");
	});

	test("records errors and sets status ERROR on 5xx", async () => {
		exporter.spans.length = 0;
		const app = makeApp();
		const res = await app.request("/boom");
		expect(res.status).toBe(500);

		const [span] = exporter.spans;
		if (!span) throw new Error("exporter did not capture a span");
		// SpanStatusCode.ERROR === 2
		expect(span.status.code).toBe(2);
		// At least one exception event captured.
		const events = span.events.map((e) => e.name);
		expect(events).toContain("exception");
	});

	test("links to inbound traceparent context", async () => {
		exporter.spans.length = 0;
		const app = makeApp();
		// Valid W3C traceparent: version-traceId-parentId-flags
		const traceId = "0af7651916cd43dd8448eb211c80319c";
		const parentId = "b7ad6b7169203331";
		const traceparent = `00-${traceId}-${parentId}-01`;
		const res = await app.request("/api/v1/workspaces/x", {
			headers: { traceparent },
		});
		expect(res.status).toBe(200);

		const [span] = exporter.spans;
		if (!span) throw new Error("exporter did not capture a span");
		// New span shares the inbound trace id.
		expect(span.spanContext().traceId).toBe(traceId);
		// Parent of this span is the inbound parent-id.
		expect(span.parentSpanContext?.spanId).toBe(parentId);
	});
});
