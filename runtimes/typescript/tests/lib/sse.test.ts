/**
 * Unit coverage for the shared SSE primitives in `src/lib/sse.ts`.
 *
 * These pin the three contracts both SSE surfaces depend on:
 *   - {@link SseEmitter}: exactly one terminal event, idempotent, and
 *     write failures (client gone) are swallowed rather than thrown.
 *   - {@link AsyncEventQueue}: a slow consumer can't drop a fast
 *     producer's items, and a close drains the backlog before ending.
 *   - {@link shouldEmitOnResume}: the `Last-Event-ID` resume decision
 *     table for the job-events stream.
 */

import { describe, expect, test } from "vitest";
import type { JobRecord, JobStatus } from "../../src/jobs/types.js";
import {
	AsyncEventQueue,
	SseEmitter,
	type SseSink,
	shouldEmitOnResume,
} from "../../src/lib/sse.js";

interface Recorded {
	readonly event: string;
	readonly data: string;
	readonly id?: string;
}

/** Sink that records every write. */
function recordingSink(): { sink: SseSink; writes: Recorded[] } {
	const writes: Recorded[] = [];
	return {
		writes,
		sink: {
			writeSSE: async (m) => {
				writes.push(m);
			},
		},
	};
}

/** Sink whose writes always throw — models a disconnected client. */
function throwingSink(): SseSink {
	return {
		writeSSE: async () => {
			throw new Error("client disconnected");
		},
	};
}

describe("SseEmitter", () => {
	test("emits non-terminal then a single terminal event", async () => {
		const { sink, writes } = recordingSink();
		const e = new SseEmitter(sink);

		expect(e.isTerminated).toBe(false);
		expect(await e.emit({ event: "token", data: "a" })).toBe(true);
		expect(await e.emit({ event: "token", data: "b" })).toBe(true);
		expect(await e.emitTerminal({ event: "done", data: "{}" })).toBe(true);
		expect(e.isTerminated).toBe(true);

		expect(writes.map((w) => w.event)).toEqual(["token", "token", "done"]);
	});

	test("emitTerminal is idempotent — only the first call writes", async () => {
		const { sink, writes } = recordingSink();
		const e = new SseEmitter(sink);

		expect(await e.emitTerminal({ event: "done", data: "first" })).toBe(true);
		expect(await e.emitTerminal({ event: "error", data: "second" })).toBe(
			false,
		);
		expect(await e.emitTerminal({ event: "done", data: "third" })).toBe(false);

		expect(writes).toHaveLength(1);
		expect(writes[0]).toMatchObject({ event: "done", data: "first" });
	});

	test("non-terminal emit after terminal is a no-op (no append past stream end)", async () => {
		const { sink, writes } = recordingSink();
		const e = new SseEmitter(sink);

		await e.emitTerminal({ event: "done", data: "{}" });
		expect(await e.emit({ event: "token", data: "late" })).toBe(false);

		expect(writes.map((w) => w.event)).toEqual(["done"]);
	});

	test("swallows write failures (client gone) and reports them via the return value", async () => {
		const e = new SseEmitter(throwingSink());

		// Neither call throws; both report `false` (nothing landed).
		await expect(e.emit({ event: "token", data: "x" })).resolves.toBe(false);
		await expect(e.emitTerminal({ event: "done", data: "{}" })).resolves.toBe(
			false,
		);
		// The terminal latch still flips so a retry can't double-fire.
		expect(e.isTerminated).toBe(true);
	});

	test("carries the optional id field through to the sink", async () => {
		const { sink, writes } = recordingSink();
		const e = new SseEmitter(sink);
		await e.emit({ event: "job", data: "{}", id: "v1" });
		await e.emitTerminal({ event: "done", data: "{}", id: "v2" });
		expect(writes.map((w) => w.id)).toEqual(["v1", "v2"]);
	});
});

describe("AsyncEventQueue", () => {
	test("delivers items pushed before draining starts (slow consumer)", async () => {
		const q = new AsyncEventQueue<number>();
		// Producer races ahead while nobody is draining yet.
		q.push(1);
		q.push(2);
		q.push(3);
		q.close();

		const seen: number[] = [];
		for await (const n of q.drain()) seen.push(n);
		expect(seen).toEqual([1, 2, 3]);
	});

	test("delivers a backlog item enqueued just before close", async () => {
		const q = new AsyncEventQueue<string>();
		const seen: string[] = [];

		const consumer = (async () => {
			for await (const s of q.drain()) seen.push(s);
		})();

		// Let the consumer block on the empty queue, then push + close in
		// the same tick.
		await Promise.resolve();
		q.push("only");
		q.close();

		await consumer;
		expect(seen).toEqual(["only"]);
	});

	test("interleaves producer and consumer without dropping items", async () => {
		const q = new AsyncEventQueue<number>();
		const seen: number[] = [];

		const consumer = (async () => {
			for await (const n of q.drain()) {
				seen.push(n);
				// Simulate a slow write so the producer outruns us.
				await new Promise((r) => setTimeout(r, 1));
			}
		})();

		for (let i = 0; i < 5; i++) q.push(i);
		q.close();

		await consumer;
		expect(seen).toEqual([0, 1, 2, 3, 4]);
	});

	test("push after close is dropped", async () => {
		const q = new AsyncEventQueue<number>();
		q.close();
		q.push(99); // ignored

		const seen: number[] = [];
		for await (const n of q.drain()) seen.push(n);
		expect(seen).toEqual([]);
	});
});

function jobRecord(status: JobStatus, updatedAt: string): JobRecord {
	return {
		workspace: "w",
		jobId: "j",
		kind: "ingest",
		knowledgeBaseId: null,
		documentId: null,
		status,
		processed: 0,
		total: null,
		result: null,
		errorMessage: null,
		createdAt: "2026-01-01T00:00:00.000Z",
		updatedAt,
		leasedBy: null,
		leasedAt: null,
		inputSnapshot: null,
	};
}

describe("shouldEmitOnResume", () => {
	test("fresh connection (no Last-Event-ID) always emits", () => {
		const r = jobRecord("running", "2026-01-01T00:00:05.000Z");
		expect(shouldEmitOnResume(r, null)).toBe(true);
		expect(shouldEmitOnResume(r, "")).toBe(true);
	});

	test("emits a snapshot strictly newer than Last-Event-ID", () => {
		const r = jobRecord("running", "2026-01-01T00:00:05.000Z");
		expect(shouldEmitOnResume(r, "2026-01-01T00:00:04.000Z")).toBe(true);
	});

	test("skips a stale non-terminal snapshot the client already saw", () => {
		const r = jobRecord("running", "2026-01-01T00:00:05.000Z");
		// Same version → already delivered.
		expect(shouldEmitOnResume(r, "2026-01-01T00:00:05.000Z")).toBe(false);
		// Older version (clock-skew / out-of-order) → still skip.
		expect(shouldEmitOnResume(r, "2026-01-01T00:00:06.000Z")).toBe(false);
	});

	test("always re-emits a terminal snapshot even at/below Last-Event-ID", () => {
		const succeeded = jobRecord("succeeded", "2026-01-01T00:00:05.000Z");
		const failed = jobRecord("failed", "2026-01-01T00:00:05.000Z");
		// Client may have reconnected precisely because it missed the
		// terminal frame — it must always reach them so the stream closes.
		expect(shouldEmitOnResume(succeeded, "2026-01-01T00:00:05.000Z")).toBe(
			true,
		);
		expect(shouldEmitOnResume(failed, "2026-01-01T00:00:09.000Z")).toBe(true);
	});
});
