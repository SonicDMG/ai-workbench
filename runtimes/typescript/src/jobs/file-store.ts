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
 * what this backend buys: a job created before a restart is still
 * visible (and still marked `running` / `pending` — resume is a
 * separate concern).
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
				catalogUid: input.catalogUid ?? null,
				documentUid: input.documentUid ?? null,
				status: "pending",
				processed: 0,
				total: input.total ?? null,
				result: null,
				errorMessage: null,
				createdAt: now,
				updatedAt: now,
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

	private async readAll(): Promise<JobRecord[]> {
		const path = join(this.root, JOBS_FILE);
		try {
			const raw = await readFile(path, "utf8");
			const parsed = JSON.parse(raw);
			if (!Array.isArray(parsed)) {
				throw new Error(`jobs file '${path}' is not a JSON array`);
			}
			return parsed as JobRecord[];
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
