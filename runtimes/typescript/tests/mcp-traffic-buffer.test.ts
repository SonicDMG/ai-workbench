/**
 * Unit coverage for the in-memory MCP traffic buffer. The audit
 * integration is exercised via `connect-route.test.ts`; this file
 * pins the ring-buffer semantics in isolation (cap, eviction,
 * per-workspace partitioning, summary math).
 */

import { describe, expect, test } from "vitest";
import { McpTrafficBuffer } from "../src/lib/mcp-traffic-buffer.js";

function record(
	buffer: McpTrafficBuffer,
	overrides: Partial<{
		workspaceId: string;
		toolName: string;
		outcome: "success" | "failure" | "denied";
	}> = {},
): void {
	buffer.record({
		workspaceId: overrides.workspaceId ?? "ws-1",
		action: "mcp.invoke",
		outcome: overrides.outcome ?? "success",
		toolName: overrides.toolName ?? "search_kb",
		subjectType: "anonymous",
		subjectLabel: null,
		reason: null,
	});
}

describe("McpTrafficBuffer", () => {
	test("records entries and returns them newest-first", () => {
		const buf = new McpTrafficBuffer();
		record(buf, { toolName: "search_kb" });
		record(buf, { toolName: "list_documents" });
		record(buf, { toolName: "ingest_text" });
		const entries = buf.recent("ws-1");
		expect(entries.map((e) => e.toolName)).toEqual([
			"ingest_text",
			"list_documents",
			"search_kb",
		]);
	});

	test("partitions per workspace", () => {
		const buf = new McpTrafficBuffer();
		record(buf, { workspaceId: "ws-1", toolName: "a" });
		record(buf, { workspaceId: "ws-2", toolName: "b" });
		record(buf, { workspaceId: "ws-1", toolName: "c" });
		expect(buf.recent("ws-1").map((e) => e.toolName)).toEqual(["c", "a"]);
		expect(buf.recent("ws-2").map((e) => e.toolName)).toEqual(["b"]);
	});

	test("caps the per-workspace ring at maxPerWorkspace", () => {
		const buf = new McpTrafficBuffer({ maxPerWorkspace: 3 });
		for (let i = 0; i < 5; i += 1) {
			record(buf, { toolName: `tool-${i}` });
		}
		const entries = buf.recent("ws-1");
		// Newest 3 survive; the oldest 2 are evicted by the
		// front-trim on overflow.
		expect(entries.map((e) => e.toolName)).toEqual([
			"tool-4",
			"tool-3",
			"tool-2",
		]);
	});

	test("honours the limit option on read", () => {
		const buf = new McpTrafficBuffer();
		for (let i = 0; i < 10; i += 1) {
			record(buf, { toolName: `t${i}` });
		}
		const top = buf.recent("ws-1", { limit: 3 });
		expect(top).toHaveLength(3);
		expect(top[0]?.toolName).toBe("t9");
	});

	test("evicts entries older than retentionMs on read", () => {
		// Drive the clock manually so the retention sweep is
		// deterministic. Start at t=0, then move past the retention
		// window on the read.
		let now = new Date("2026-01-01T00:00:00Z");
		const buf = new McpTrafficBuffer({
			retentionMs: 1000,
			now: () => now,
		});
		record(buf, { toolName: "early" });
		now = new Date("2026-01-01T00:00:00.500Z");
		record(buf, { toolName: "middle" });
		now = new Date("2026-01-01T00:00:02.000Z");
		record(buf, { toolName: "late" });
		// At t=2.0s with a 1s retention, only `late` is within the
		// window (it's now exactly at t=2.0; `early` and `middle`
		// are both > 1s old). `late` is at the head when ordered
		// newest-first.
		const entries = buf.recent("ws-1");
		expect(entries.map((e) => e.toolName)).toEqual(["late"]);
	});

	test("summary counts successes vs failures inside the retention window", () => {
		const buf = new McpTrafficBuffer();
		record(buf, { outcome: "success" });
		record(buf, { outcome: "success" });
		record(buf, { outcome: "failure" });
		record(buf, { outcome: "denied" });
		const summary = buf.summary("ws-1");
		// total = 4, successes = 2, the other two (failure + denied)
		// both count as failures from the UI's perspective.
		expect(summary).toEqual({ total: 4, successes: 2, failures: 2 });
	});

	test("returns empty list and zero summary for an unknown workspace", () => {
		const buf = new McpTrafficBuffer();
		expect(buf.recent("ghost")).toEqual([]);
		expect(buf.summary("ghost")).toEqual({
			total: 0,
			successes: 0,
			failures: 0,
		});
	});
});
