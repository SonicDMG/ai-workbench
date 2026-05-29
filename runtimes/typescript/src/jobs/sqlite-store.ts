/**
 * SQLite-backed {@link JobStore} for chat-heavy / durable single-node
 * deployments — the jobs counterpart to
 * {@link ../control-plane/sqlite/store.SqliteControlPlaneStore}.
 *
 * Same durability story as {@link ./file-store.FileJobStore} (persisted
 * job records survive a restart; `controlPlane.jobsResume` can let the
 * orphan sweeper reclaim stale leases) but with row-level
 * INSERT/UPDATE/DELETE instead of rewriting a whole `jobs.json` per
 * mutation. Job throughput is far lower than chat-message throughput, so
 * this is less about hot-path performance than about keeping the jobs
 * store on the same engine as the control plane when the operator picks
 * `driver: "sqlite"`.
 *
 * Listener pub/sub reuses the same in-process {@link JobSubscriptions}
 * helper as the memory + file backends; like the file backend this is
 * single-node, so cross-process fan-out is out of scope. Update
 * semantics reuse {@link applyUpdate} so behavior can't drift from the
 * other backends.
 */

import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import { nowIso } from "../control-plane/defaults.js";
import { ControlPlaneNotFoundError } from "../control-plane/errors.js";
import { applyUpdate } from "./memory-store.js";
import type { JobListener, JobStore, Unsubscribe } from "./store.js";
import { JobSubscriptions } from "./subscriptions.js";
import type { CreateJobInput, JobRecord, UpdateJobInput } from "./types.js";

export interface SqliteJobStoreOptions {
	/** Path to the SQLite database file, or `":memory:"`. */
	readonly path: string;
}

export class SqliteJobStore implements JobStore {
	private readonly db: Database.Database;
	private readonly subscriptions = new JobSubscriptions();

	constructor(opts: SqliteJobStoreOptions) {
		this.db = new Database(opts.path);
		this.db.pragma("journal_mode = WAL");
		this.db.pragma("synchronous = NORMAL");
		this.db.pragma("busy_timeout = 5000");
		this.db.exec(
			`CREATE TABLE IF NOT EXISTS jobs (
				workspace TEXT NOT NULL,
				job_id TEXT NOT NULL,
				data TEXT NOT NULL,
				PRIMARY KEY (workspace, job_id)
			)`,
		);
	}

	/**
	 * Schema is created in the constructor; kept for symmetry with
	 * {@link FileJobStore.init} so the factory can `await store.init()`
	 * uniformly.
	 */
	async init(): Promise<void> {
		// no-op — schema already created synchronously at construction.
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
		this.db
			.prepare(`INSERT INTO jobs (workspace, job_id, data) VALUES (?, ?, ?)`)
			.run(record.workspace, jobId, JSON.stringify(record));
		return record;
	}

	async get(workspace: string, jobId: string): Promise<JobRecord | null> {
		return this.read(workspace, jobId);
	}

	async update(
		workspace: string,
		jobId: string,
		patch: UpdateJobInput,
	): Promise<JobRecord> {
		const next = this.tx((): JobRecord => {
			const existing = this.read(workspace, jobId);
			if (!existing) {
				throw new ControlPlaneNotFoundError("job", jobId);
			}
			const updated = applyUpdate(existing, patch);
			this.write(updated);
			return updated;
		});
		this.subscriptions.fire(workspace, jobId, next);
		return next;
	}

	async subscribe(
		workspace: string,
		jobId: string,
		listener: JobListener,
	): Promise<Unsubscribe> {
		const unsub = this.subscriptions.add(workspace, jobId, listener);
		const current = this.read(workspace, jobId);
		if (current) {
			try {
				listener(current);
			} catch {
				// ignore — same policy as subscriptions.fire
			}
		}
		return unsub;
	}

	async findStaleRunning(cutoffIso: string): Promise<readonly JobRecord[]> {
		const rows = this.readAll();
		return rows.filter(
			(r) =>
				r.status === "running" &&
				(r.leasedAt === null || r.leasedAt < cutoffIso),
		);
	}

	async claim(
		workspace: string,
		jobId: string,
		expectedHolder: string | null,
		newHolder: string,
	): Promise<JobRecord | null> {
		const claimed = this.tx((): JobRecord | null => {
			const existing = this.read(workspace, jobId);
			if (!existing) return null;
			if (existing.leasedBy !== expectedHolder) return null;
			const now = nowIso();
			const next: JobRecord = {
				...existing,
				leasedBy: newHolder,
				leasedAt: now,
				updatedAt: now,
			};
			this.write(next);
			return next;
		});
		if (claimed) {
			this.subscriptions.fire(workspace, jobId, claimed);
		}
		return claimed;
	}

	/** Close the underlying connection (idempotent). */
	stop(): void {
		if (this.db.open) this.db.close();
	}

	/* ---------------- private helpers ---------------- */

	private read(workspace: string, jobId: string): JobRecord | null {
		const row = this.db
			.prepare(`SELECT data FROM jobs WHERE workspace = ? AND job_id = ?`)
			.get(workspace, jobId) as { data: string } | undefined;
		return row ? this.hydrate(row.data) : null;
	}

	private readAll(): JobRecord[] {
		const rows = this.db.prepare(`SELECT data FROM jobs`).all() as {
			data: string;
		}[];
		return rows.map((r) => this.hydrate(r.data));
	}

	/**
	 * Parse a stored row, backfilling lease + ingestInput columns on
	 * records persisted before those fields existed — identical
	 * back-compat handling to {@link FileJobStore.readAll}.
	 */
	private hydrate(data: string): JobRecord {
		const r = JSON.parse(data) as Partial<JobRecord>;
		return {
			...(r as JobRecord),
			leasedBy: r.leasedBy ?? null,
			leasedAt: r.leasedAt ?? null,
			ingestInput: r.ingestInput ?? null,
		};
	}

	private write(record: JobRecord): void {
		this.db
			.prepare(`UPDATE jobs SET data = ? WHERE workspace = ? AND job_id = ?`)
			.run(JSON.stringify(record), record.workspace, record.jobId);
	}

	private tx<R>(fn: () => R): R {
		return this.db.transaction(fn)();
	}
}
