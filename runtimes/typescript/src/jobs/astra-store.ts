/**
 * Astra-backed {@link JobStore}.
 *
 * Storage: `wb_jobs_by_workspace` — partition per workspace, sorted
 * by `job_id`. `result` round-trips through a serialized `result_json`
 * text column (same pattern as `filter_json` on saved queries).
 *
 * Cross-replica subscriber fan-out (Phase 2b follow-up — see
 * [`docs/cross-replica-jobs.md`](../../../../docs/cross-replica-jobs.md)):
 * `subscribe()` registers a local listener AND adds the
 * `(workspace, jobId)` key to a poll set. A single timer (default
 * 500ms) ticks while there's at least one subscriber and re-reads
 * each subscribed record from Astra; when `updated_at` advances past
 * the value the replica last saw, every local listener fires.
 *
 * Same-replica updates (the common case — async ingest runs in the
 * same process as its SSE subscriber) still fire **immediately**
 * through the in-process {@link JobSubscriptions} helper. The poller
 * only catches updates that originated on a *different* replica, so
 * the `update()` → listener latency for co-located callers stays
 * sub-millisecond.
 *
 * The poller tolerates the cross-tick race that lets a write land
 * locally and remotely at the same `updated_at` — `lastSeen` is
 * bumped on local fire too, so the upcoming poll sees a no-op
 * instead of a duplicate fire.
 */

import { randomUUID } from "node:crypto";
import type { JobRow } from "../astra-client/row-types.js";
import type { TablesBundle } from "../astra-client/tables.js";
import { nowIso } from "../control-plane/defaults.js";
import { ControlPlaneNotFoundError } from "../control-plane/errors.js";
import { applyUpdate } from "./memory-store.js";
import type { JobListener, JobStore, Unsubscribe } from "./store.js";
import { JobSubscriptions } from "./subscriptions.js";
import type {
	CreateJobInput,
	IngestInputSnapshot,
	JobKind,
	JobRecord,
	JobStatus,
	UpdateJobInput,
} from "./types.js";

/** Tunable poll interval and scheduler. Tests inject a manual
 * scheduler so they don't have to wait on real timers. */
export interface AstraJobStoreOptions {
	/** Cross-replica poll interval in milliseconds. Defaults to 500.
	 * Drop to 100ms for hot-path SSE; raise to 2000ms for cost-
	 * sensitive deployments where staleness up to two seconds is
	 * fine. The poller is a no-op when no one is subscribed. */
	readonly pollIntervalMs?: number;
	/** Replace `setInterval` / `clearInterval` for tests. The default
	 * uses `globalThis.setInterval`. */
	readonly scheduler?: PollScheduler;
}

export type PollCallback = () => void | Promise<void>;
export interface PollScheduler {
	start(callback: PollCallback, intervalMs: number): PollHandle;
}
export interface PollHandle {
	stop(): void;
}

const DEFAULT_POLL_MS = 500;

const defaultScheduler: PollScheduler = {
	start(cb, intervalMs) {
		// `unref` keeps the timer from holding the process open during
		// graceful shutdown; the runtime's own shutdown hook stops every
		// subscription anyway, but unref is belt-and-suspenders for
		// tooling that forgets.
		const handle = setInterval(cb, intervalMs);
		if (typeof handle === "object" && "unref" in handle) {
			(handle as { unref(): void }).unref();
		}
		return {
			stop() {
				clearInterval(handle);
			},
		};
	},
};

interface PollEntry {
	readonly listeners: Set<JobListener>;
	lastSeen: string | null;
}

export class AstraJobStore implements JobStore {
	private readonly subscriptions = new JobSubscriptions();
	private readonly pollEntries = new Map<string, PollEntry>();
	private readonly pollIntervalMs: number;
	private readonly scheduler: PollScheduler;
	private pollHandle: PollHandle | null = null;
	private polling = false;

	constructor(
		private readonly tables: TablesBundle,
		opts: AstraJobStoreOptions = {},
	) {
		this.pollIntervalMs = opts.pollIntervalMs ?? DEFAULT_POLL_MS;
		this.scheduler = opts.scheduler ?? defaultScheduler;
	}

	async create(input: CreateJobInput): Promise<JobRecord> {
		const jobId = input.jobId ?? randomUUID();
		const now = nowIso();
		const record: JobRecord = {
			workspace: input.workspace,
			jobId,
			kind: input.kind,
			knowledgeBaseId: input.knowledgeBaseId ?? null,
			documentId: input.documentId ?? null,
			status: "pending",
			processed: 0,
			total: input.total ?? null,
			result: null,
			errorMessage: null,
			createdAt: now,
			updatedAt: now,
			leasedBy: null,
			leasedAt: null,
			ingestInput: input.ingestInput ?? null,
		};
		await this.tables.jobs.insertOne(jobToRow(record));
		return record;
	}

	async get(workspace: string, jobId: string): Promise<JobRecord | null> {
		const row = await this.tables.jobs.findOne({
			workspace,
			job_id: jobId,
		});
		return row ? jobFromRow(row) : null;
	}

	async update(
		workspace: string,
		jobId: string,
		patch: UpdateJobInput,
	): Promise<JobRecord> {
		const existing = await this.tables.jobs.findOne({
			workspace,
			job_id: jobId,
		});
		if (!existing) {
			throw new ControlPlaneNotFoundError("job", jobId);
		}
		const next = applyUpdate(jobFromRow(existing), patch);
		const nextRow = jobToRow(next);
		const { workspace: _w, job_id: _j, ...fields } = nextRow;
		await this.tables.jobs.updateOne(
			{ workspace, job_id: jobId },
			{ $set: fields },
		);
		// Same-replica fan-out: fire locally immediately, and bump
		// `lastSeen` so the upcoming poll tick doesn't re-fire on the
		// same `updated_at`.
		this.subscriptions.fire(workspace, jobId, next);
		const entry = this.pollEntries.get(keyOf(workspace, jobId));
		if (entry) entry.lastSeen = next.updatedAt;
		return next;
	}

	async subscribe(
		workspace: string,
		jobId: string,
		listener: JobListener,
	): Promise<Unsubscribe> {
		const localUnsub = this.subscriptions.add(workspace, jobId, listener);
		this.trackForPolling(workspace, jobId, listener);
		this.ensurePolling();

		const current = await this.get(workspace, jobId);
		if (current) {
			// Seed `lastSeen` so the first tick after subscribe doesn't
			// emit a duplicate of what the listener just received.
			const entry = this.pollEntries.get(keyOf(workspace, jobId));
			if (entry) entry.lastSeen = current.updatedAt;
			try {
				listener(current);
			} catch {
				// ignore — listener's problem
			}
		}

		return () => {
			localUnsub();
			this.untrackForPolling(workspace, jobId, listener);
			this.maybeStopPolling();
		};
	}

	async findStaleRunning(cutoffIso: string): Promise<readonly JobRecord[]> {
		// Astra Data API doesn't have a clean range filter on the
		// `leased_at` text column from this client without a secondary
		// index. In-flight jobs are bounded per workspace (a handful at
		// any moment), so we filter on `status: "running"` and let the
		// runtime cull by `leasedAt` client-side. If a deployment ever
		// scales past tens of thousands of in-flight jobs we'll add a
		// `leased_at` index and bound the read here.
		const cursor = this.tables.jobs.find({ status: "running" });
		const rows = await cursor.toArray();
		const records = rows.map((r) => jobFromRow(r));
		return records.filter((r) => r.leasedAt === null || r.leasedAt < cutoffIso);
	}

	async claim(
		workspace: string,
		jobId: string,
		expectedHolder: string | null,
		newHolder: string,
	): Promise<JobRecord | null> {
		// CAS via filter-aware updateOne: the update fires only when
		// `leased_by === expectedHolder`. Astra's updateOne returns
		// metadata, not the post-update row, so we re-read after and
		// compare back to detect a lost race (no rows matched, or
		// another replica re-claimed in the microsecond gap).
		const now = new Date().toISOString();
		await this.tables.jobs.updateOne(
			{ workspace, job_id: jobId, leased_by: expectedHolder },
			{ $set: { leased_by: newHolder, leased_at: now, updated_at: now } },
		);
		const after = await this.get(workspace, jobId);
		if (!after) return null;
		if (after.leasedBy !== newHolder || after.leasedAt !== now) {
			// Filter didn't match (different leaseholder, or row gone)
			// or someone re-claimed before our re-read.
			return null;
		}
		this.subscriptions.fire(workspace, jobId, after);
		return after;
	}

	/** Stop the cross-replica polling timer. Called by the runtime's
	 * shutdown hook so the process can exit cleanly. Safe to call
	 * multiple times; safe to call before any subscribe. */
	stop(): void {
		this.pollHandle?.stop();
		this.pollHandle = null;
	}

	/* ----- Polling internals ----------------------------------- */

	private trackForPolling(
		workspace: string,
		jobId: string,
		listener: JobListener,
	): void {
		const k = keyOf(workspace, jobId);
		let entry = this.pollEntries.get(k);
		if (!entry) {
			entry = { listeners: new Set(), lastSeen: null };
			this.pollEntries.set(k, entry);
		}
		entry.listeners.add(listener);
	}

	private untrackForPolling(
		workspace: string,
		jobId: string,
		listener: JobListener,
	): void {
		const k = keyOf(workspace, jobId);
		const entry = this.pollEntries.get(k);
		if (!entry) return;
		entry.listeners.delete(listener);
		if (entry.listeners.size === 0) this.pollEntries.delete(k);
	}

	private ensurePolling(): void {
		if (this.pollHandle) return;
		this.pollHandle = this.scheduler.start(
			() => this.tick(),
			this.pollIntervalMs,
		);
	}

	private maybeStopPolling(): void {
		if (this.pollEntries.size === 0) this.stop();
	}

	private async tick(): Promise<void> {
		// Single-flight: if a previous tick is still running (slow
		// network, large fan-out) the next interval bump is a no-op.
		// The runtime falls behind gracefully; subscribers see merged
		// state on the next successful tick.
		if (this.polling) return;
		this.polling = true;
		try {
			// Snapshot keys; concurrent unsubscribes mid-tick are safe
			// because we re-check entries before firing.
			const keys = [...this.pollEntries.keys()];
			await Promise.all(keys.map((k) => this.tickOne(k)));
		} finally {
			this.polling = false;
		}
	}

	private async tickOne(k: string): Promise<void> {
		const entry = this.pollEntries.get(k);
		if (!entry) return;
		const [workspace, jobId] = parseKey(k);
		const row = await this.tables.jobs.findOne({
			workspace,
			job_id: jobId,
		});
		if (!row) return;
		const updatedAt = row.updated_at;
		if (entry.lastSeen !== null && updatedAt <= entry.lastSeen) return;
		entry.lastSeen = updatedAt;
		this.subscriptions.fire(workspace, jobId, jobFromRow(row));
	}
}

function keyOf(workspace: string, jobId: string): string {
	return `${workspace} ${jobId}`;
}

function parseKey(k: string): [string, string] {
	const [workspace, jobId] = k.split(" ");
	return [workspace as string, jobId as string];
}

/* ----- Row <-> Record conversion ---------------------------------- */

function jobToRow(r: JobRecord): JobRow {
	return {
		workspace: r.workspace,
		job_id: r.jobId,
		kind: r.kind,
		knowledge_base_id: r.knowledgeBaseId,
		document_id: r.documentId,
		status: r.status,
		processed: r.processed,
		total: r.total,
		result_json: r.result ? JSON.stringify(r.result) : null,
		error_message: r.errorMessage,
		created_at: r.createdAt,
		updated_at: r.updatedAt,
		leased_by: r.leasedBy,
		leased_at: r.leasedAt,
		ingest_input_json: r.ingestInput ? JSON.stringify(r.ingestInput) : null,
	};
}

function jobFromRow(row: JobRow): JobRecord {
	return {
		workspace: row.workspace,
		jobId: row.job_id,
		kind: row.kind as JobKind,
		knowledgeBaseId: row.knowledge_base_id ?? null,
		documentId: row.document_id,
		status: row.status as JobStatus,
		processed: row.processed,
		total: row.total,
		result: row.result_json
			? (JSON.parse(row.result_json) as Record<string, unknown>)
			: null,
		errorMessage: row.error_message,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
		// Backfill for rows persisted before the lease + ingestInput
		// columns existed (and for tests that hand-craft rows without
		// them).
		leasedBy: row.leased_by ?? null,
		leasedAt: row.leased_at ?? null,
		ingestInput: row.ingest_input_json
			? (JSON.parse(row.ingest_input_json) as IngestInputSnapshot)
			: null,
	};
}
