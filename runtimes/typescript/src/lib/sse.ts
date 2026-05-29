/**
 * Shared Server-Sent-Events primitives for the runtime's two SSE
 * surfaces — the job-events stream (`routes/api-v1/jobs.ts`) and the
 * agent chat stream (`routes/api-v1/agents.ts` →
 * `chat/agent-dispatch.ts`).
 *
 * Both surfaces previously hand-rolled the same three pieces:
 *
 *   1. a per-subscriber queue + listener + "wake the drain loop"
 *      promise dance (a slow consumer can't block a fast one),
 *   2. an abort hook wired to client disconnect, and
 *   3. a best-effort guarantee that exactly one *terminal* event lands
 *      on the wire even when the producer throws mid-stream or the
 *      client has already gone away.
 *
 * This module centralises (1) as {@link AsyncEventQueue} and (3) as
 * {@link SseEmitter}, plus the job-stream orchestration as
 * {@link runJobEventStream}. The wire event names/shapes are unchanged
 * — the only addition is an `id:` field carrying the job-record version
 * (its `updatedAt`) so a reconnecting client can present
 * `Last-Event-ID` and resume from the last snapshot it saw rather than
 * replaying from scratch. See {@link resumeFromLastEventId}.
 *
 * The chat stream does NOT get a resume `id:` — mid-turn tokens aren't
 * replayable, so the contract there is only "always emit exactly one
 * clean terminal event"; {@link SseEmitter} backs that guarantee.
 */

import type { JobStore } from "../jobs/store.js";
import type { JobRecord } from "../jobs/types.js";
import { isTerminal } from "../jobs/types.js";

/**
 * Minimal sink the helpers write through. Structurally satisfied by
 * Hono's `SSEStreamingApi` (`streamSSE`'s `stream` argument) so route
 * handlers pass it straight in, and trivially faked in tests.
 *
 * `id` carries the SSE event id (surfaces as `id: <value>` on the wire
 * and, per the EventSource spec, is echoed back as the `Last-Event-ID`
 * request header on the client's next reconnect).
 */
export interface SseSink {
	writeSSE(message: {
		readonly event: string;
		readonly data: string;
		readonly id?: string;
	}): Promise<void>;
}

/**
 * Single-terminal-event guarantee around an {@link SseSink}.
 *
 * Producers call {@link emit} for ordinary events and {@link emitTerminal}
 * for the closing event. `emitTerminal` is idempotent — only the first
 * call writes; later calls (e.g. a `finally` fallback after the producer
 * already terminated cleanly) are no-ops. Both methods swallow write
 * failures: once the client has disconnected there is nobody to tell,
 * and an SSE-write throw must never mask the producer's own outcome.
 *
 * This is the centralised version of the ad-hoc "best-effort terminal"
 * logic both surfaces carried (`jobs.ts`'s trailing `done`, the chat
 * dispatcher's `emitTerminalError`).
 */
export class SseEmitter {
	private terminalSent = false;

	constructor(private readonly sink: SseSink) {}

	/** Whether a terminal event has already been written. */
	get isTerminated(): boolean {
		return this.terminalSent;
	}

	/**
	 * Write a non-terminal event. Returns `true` if the write succeeded,
	 * `false` if it threw (client gone) — callers that want to stop
	 * producing on a dead connection can check the return.
	 *
	 * A no-op once a terminal event has been sent, so a late producer
	 * write can't append after the stream's logical end.
	 */
	async emit(message: {
		readonly event: string;
		readonly data: string;
		readonly id?: string;
	}): Promise<boolean> {
		if (this.terminalSent) return false;
		try {
			await this.sink.writeSSE(message);
			return true;
		} catch {
			return false;
		}
	}

	/**
	 * Write the one-and-only terminal event. Idempotent: the first call
	 * writes and latches; subsequent calls return `false` without
	 * writing. Swallows write failures (client may already be gone) and
	 * reports whether *this* call actually wrote.
	 */
	async emitTerminal(message: {
		readonly event: string;
		readonly data: string;
		readonly id?: string;
	}): Promise<boolean> {
		if (this.terminalSent) return false;
		this.terminalSent = true;
		try {
			await this.sink.writeSSE(message);
			return true;
		} catch {
			return false;
		}
	}
}

/**
 * Unbounded async FIFO with an explicit close signal.
 *
 * Producers `push()` (never blocks) and `close()` (idempotent). One
 * consumer drains via `for await`. Iteration ends after `close()` once
 * the backlog is exhausted, so an item enqueued just before close is
 * still delivered.
 *
 * Replaces the `queue: T[] + resolveNext + aborted` trio the jobs route
 * hand-rolled, with the same "a slow consumer can't block a fast
 * producer" property: the producer pushes into memory and returns
 * immediately while the consumer drains at its own pace.
 */
export class AsyncEventQueue<T> {
	private readonly items: T[] = [];
	private wake: (() => void) | null = null;
	private closed = false;

	/** Enqueue an item and wake the drain loop. No-op once closed. */
	push(item: T): void {
		if (this.closed) return;
		this.items.push(item);
		this.signal();
	}

	/** Signal end-of-stream. The drain loop finishes its backlog, then ends. */
	close(): void {
		if (this.closed) return;
		this.closed = true;
		this.signal();
	}

	private signal(): void {
		const w = this.wake;
		this.wake = null;
		w?.();
	}

	async *drain(): AsyncIterableIterator<T> {
		while (true) {
			while (this.items.length > 0) {
				// Non-null: guarded by length check, single consumer.
				yield this.items.shift() as T;
			}
			if (this.closed) return;
			await new Promise<void>((resolve) => {
				this.wake = resolve;
			});
		}
	}
}

/* ------------------------------------------------------------------ */
/* Job-events stream                                                  */
/* ------------------------------------------------------------------ */

/**
 * The job-record version used as the SSE event `id:`. Job records carry
 * an ISO-8601 `updatedAt` bumped on every mutation, which is monotonic
 * per record (the store stamps it via `nowIso()` and the message layer
 * uses `strictlyAfter` semantics for chat, but jobs only ever advance
 * forward in wall-clock). We use it verbatim so a reconnecting client's
 * `Last-Event-ID` is directly comparable.
 */
function jobVersion(record: JobRecord): string {
	return record.updatedAt;
}

/**
 * Decide whether a freshly-observed job snapshot should be (re-)emitted
 * to a client that reconnected with `lastEventId`.
 *
 * `lastEventId` is the `updatedAt` of the last frame the client saw.
 * Job records are idempotent snapshots, so re-emitting the latest state
 * is always *safe*; this just avoids replaying a snapshot the client
 * already has. Rules:
 *
 *   - No `Last-Event-ID` (fresh connection) → always emit.
 *   - Snapshot strictly newer than `lastEventId` → emit (genuine update).
 *   - Snapshot not newer BUT terminal → emit (the client may have
 *     reconnected precisely because it missed the terminal frame; a
 *     terminal snapshot must always reach it so the stream can close
 *     cleanly).
 *   - Snapshot not newer and non-terminal → skip (stale replay).
 *
 * Exported for direct unit coverage of the resume decision table.
 */
export function shouldEmitOnResume(
	record: JobRecord,
	lastEventId: string | null,
): boolean {
	if (lastEventId === null || lastEventId === "") return true;
	if (jobVersion(record) > lastEventId) return true;
	return isTerminal(record.status);
}

/** Inputs the job-events SSE loop needs, decoupled from the route. */
export interface JobEventStreamOptions {
	readonly jobs: JobStore;
	readonly workspaceId: string;
	readonly jobId: string;
	/** Raw `Last-Event-ID` request header, if the client sent one. */
	readonly lastEventId: string | null;
	/** Serialize a job record to the `job` event's `data` payload. */
	readonly serialize: (record: JobRecord) => string;
	/** Register a one-shot client-disconnect hook (Hono `stream.onAbort`). */
	readonly onAbort: (handler: () => void) => void;
}

/**
 * Drive the `/jobs/{jobId}/events` SSE loop.
 *
 * Subscribes to the job, drains snapshots through an
 * {@link AsyncEventQueue}, and writes one `job` event per update (each
 * carrying `id: <updatedAt>` for resume) followed by a single terminal
 * `done` once the job reaches a terminal state. Honours
 * `Last-Event-ID`: on reconnect the immediate replay frame is suppressed
 * when it's a stale snapshot the client already saw (see
 * {@link shouldEmitOnResume}), but a terminal snapshot always lands so
 * the reconnecting client can close cleanly.
 *
 * The {@link SseEmitter} guarantees the terminal `done` is written at
 * most once even if the loop and the abort path race.
 */
export async function runJobEventStream(
	sink: SseSink,
	options: JobEventStreamOptions,
): Promise<void> {
	const { jobs, workspaceId, jobId, lastEventId, serialize, onAbort } = options;
	const emitter = new SseEmitter(sink);
	const queue = new AsyncEventQueue<JobRecord>();

	// The listener just pushes; the drain loop does all the I/O so a slow
	// SSE write can't reorder or drop updates.
	const unsub = await jobs.subscribe(workspaceId, jobId, (record) => {
		queue.push(record);
	});

	// Client disconnect: stop the subscription and let the drain loop end.
	onAbort(() => {
		unsub();
		queue.close();
	});

	try {
		for await (const record of queue.drain()) {
			if (!shouldEmitOnResume(record, lastEventId)) continue;
			const wrote = await emitter.emit({
				event: "job",
				data: serialize(record),
				id: jobVersion(record),
			});
			// Client vanished mid-write — nothing more to do.
			if (!wrote) break;
			if (isTerminal(record.status)) {
				// One unambiguous terminator even for clients that don't
				// parse `data`. Carries the same `id:` so a client that
				// reconnects after this still resumes consistently.
				await emitter.emitTerminal({
					event: "done",
					data: JSON.stringify({ status: record.status }),
					id: jobVersion(record),
				});
				break;
			}
		}
	} finally {
		unsub();
		queue.close();
	}
}
