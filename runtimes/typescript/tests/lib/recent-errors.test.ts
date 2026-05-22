import { describe, expect, test } from "vitest";
import { createRecentErrorBuffer } from "../../src/lib/recent-errors.js";

describe("recent-errors ring buffer", () => {
	test("returns empty snapshot when nothing has been recorded", () => {
		const buf = createRecentErrorBuffer(8);
		expect(buf.snapshot()).toEqual([]);
		expect(buf.capacity).toBe(8);
	});

	test("rejects non-positive capacity", () => {
		expect(() => createRecentErrorBuffer(0)).toThrow();
		expect(() => createRecentErrorBuffer(-1)).toThrow();
		expect(() => createRecentErrorBuffer(1.5)).toThrow();
	});

	test("snapshot returns newest entry first", () => {
		const buf = createRecentErrorBuffer(8);
		buf.record({
			code: "workspace_not_found",
			status: 404,
			method: "GET",
			routePattern: "/api/v1/workspaces/:workspaceId",
			requestId: "req-1",
		});
		buf.record({
			code: "validation_error",
			status: 400,
			method: "POST",
			routePattern: "/api/v1/workspaces",
			requestId: "req-2",
		});
		const snap = buf.snapshot();
		expect(snap[0]?.requestId).toBe("req-2");
		expect(snap[1]?.requestId).toBe("req-1");
	});

	test("overwrites oldest entries when capacity is exceeded", () => {
		const buf = createRecentErrorBuffer(3);
		for (let i = 0; i < 5; i += 1) {
			buf.record({
				code: "rate_limited",
				status: 429,
				method: "GET",
				routePattern: "/api/v1/workspaces",
				requestId: `req-${i}`,
			});
		}
		const snap = buf.snapshot();
		expect(snap).toHaveLength(3);
		expect(snap.map((e) => e.requestId)).toEqual(["req-4", "req-3", "req-2"]);
	});

	test("clear() empties the buffer", () => {
		const buf = createRecentErrorBuffer(2);
		buf.record({
			code: "x",
			status: 500,
			method: "GET",
			routePattern: "/",
			requestId: "r",
		});
		buf.clear();
		expect(buf.snapshot()).toEqual([]);
	});

	test("entries carry an ISO-8601 timestamp", () => {
		const buf = createRecentErrorBuffer(1);
		buf.record({
			code: "x",
			status: 500,
			method: "GET",
			routePattern: "/",
			requestId: "r",
		});
		const ts = buf.snapshot()[0]?.ts ?? "";
		expect(ts).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
		expect(Number.isNaN(Date.parse(ts))).toBe(false);
	});
});
