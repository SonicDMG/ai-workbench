/**
 * JSON-on-disk {@link JobStore} for single-node self-hosted
 * deployments.
 *
 * Layout: `<root>/jobs.json` holds a flat array of {@link JobRecord}.
 * Each mutation:
 *   1. Acquires the mutex.
 *   2. Reads the file (empty array if missing).
 *   3. Applies the change in memory.
 *   4. Writes to `<file>.tmp` + atomic rename.
 *
 * Listener pub/sub is the same in-process helper as
 * {@link MemoryJobStore} — the file backend isn't multi-process-safe
 * anyway, so cross-process fan-out is out of scope. Restart-safety is
 * what this backend buys: persisted jobs remain visible, and
 * deployments that enable `controlPlane.jobsResume` can let the
 * orphan sweeper reclaim stale ingest leases from the file.
 */

import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { nowIso } from "../control-plane/defaults.js";
import { ControlPlaneNotFoundError } from "../control-plane/errors.js";
import { Mutex } from "../control-plane/file/mutex.js";
import { applyUpdate } from "./memory-store.js";
import type { JobListener, JobStore, Unsubscribe } from "./store.js";
import { JobSubscriptions } from "./subscriptions.js";
import type { CreateJobInput, JobRecord, UpdateJobInput } from "./types.js";

export interface FileJobStoreOptions {
	readonly root: string;
}

const JOBS_FILE = "jobs.json";

export class FileJobStore implements JobStore {
	private readonly root: string;
	private readonly mutex = new Mutex();
	private readonly subscriptions = new JobSubscriptions();

	constructor(opts: FileJobStoreOptions) {
		this.root = opts.root;
	}

	async init(): Promise<void> {
		await mkdir(this.root, { recursive: true });
	}

	async create(input: CreateJobInput): Promise<JobRecord> {
		return this.mutate(async (rows) => {
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
			return { rows: [...rows, record], result: record };
		});
	}

	async get(workspace: string, jobId: string): Promise<JobRecord | null> {
		const rows = await this.readAll();
		return (
			rows.find((r) => r.workspace === workspace && r.jobId === jobId) ?? null
		);
	}

	async update(
		workspace: string,
		jobId: string,
		patch: UpdateJobInput,
	): Promise<JobRecord> {
		const next = await this.mutate(async (rows) => {
			const idx = rows.findIndex(
				(r) => r.workspace === workspace && r.jobId === jobId,
			);
			if (idx < 0) {
				throw new ControlPlaneNotFoundError("job", jobId);
			}
			const updated = applyUpdate(rows[idx] as JobRecord, patch);
			const nextRows = [...rows];
			nextRows[idx] = updated;
			return { rows: nextRows, result: updated };
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
		const current = await this.get(workspace, jobId);
		if (current) {
			try {
				listener(current);
			} catch {
				// ignore
			}
		}
		return unsub;
	}

	async findStaleRunning(cutoffIso: string): Promise<readonly JobRecord[]> {
		const rows = await this.readAll();
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
		const claimed = await this.mutate(async (rows) => {
			const idx = rows.findIndex(
				(r) => r.workspace === workspace && r.jobId === jobId,
			);
			if (idx < 0) return { rows, result: null };
			const existing = rows[idx] as JobRecord;
			if (existing.leasedBy !== expectedHolder) {
				return { rows, result: null };
			}
			const now = nowIso();
			const next: JobRecord = {
				...existing,
				leasedBy: newHolder,
				leasedAt: now,
				updatedAt: now,
			};
			const nextRows = [...rows];
			nextRows[idx] = next;
			return { rows: nextRows, result: next };
		});
		if (claimed) {
			this.subscriptions.fire(workspace, jobId, claimed);
		}
		return claimed;
	}

	private async readAll(): Promise<JobRecord[]> {
		const path = join(this.root, JOBS_FILE);
		try {
			const raw = await readFile(path, "utf8");
			const parsed = JSON.parse(raw);
			if (!Array.isArray(parsed)) {
				throw new Error(`jobs file '${path}' is not a JSON array`);
			}
			// Backfill lease + ingestInput on rows persisted before they
			// were part of the schema. Old workflow: missing fields →
			// null. Sweeper picks them up as unclaimed, and skips
			// resume (no input → fall back to mark-failed).
			return (parsed as Partial<JobRecord>[]).map(
				(r): JobRecord => ({
					...(r as JobRecord),
					leasedBy: r.leasedBy ?? null,
					leasedAt: r.leasedAt ?? null,
					ingestInput: r.ingestInput ?? null,
				}),
			);
		} catch (err) {
			if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
			throw err;
		}
	}

	private async writeAll(rows: readonly JobRecord[]): Promise<void> {
		await mkdir(this.root, { recursive: true });
		const finalPath = join(this.root, JOBS_FILE);
		const tmpPath = `${finalPath}.${randomUUID()}.tmp`;
		await writeFile(tmpPath, JSON.stringify(rows, null, 2), "utf8");
		await rename(tmpPath, finalPath);
	}

	private async mutate<R>(
		fn: (rows: readonly JobRecord[]) => Promise<{
			rows: readonly JobRecord[];
			result: R;
		}>,
	): Promise<R> {
		return this.mutex.run(async () => {
			const rows = await this.readAll();
			const { rows: nextRows, result } = await fn(rows);
			await this.writeAll(nextRows);
			return result;
		});
	}
}
