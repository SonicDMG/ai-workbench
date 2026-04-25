/**
 * In-memory {@link JobStore} — the default backend for single-process
 * ephemeral deployments.
 *
 * Internal shape:
 *   - `jobs: Map<\`${workspace}:${jobId}\`, JobRecord>`
 *
 * Pub/sub sits in a shared {@link JobSubscriptions} helper so the
 * file + astra backends reuse it unchanged.
 *
 * Not durable — state is lost on process exit. Use the file or astra
 * backends for anything longer-lived than a single process invocation.
 */

import { randomUUID } from "node:crypto";
import { nowIso } from "../control-plane/defaults.js";
import { ControlPlaneNotFoundError } from "../control-plane/errors.js";
import type { JobListener, JobStore, Unsubscribe } from "./store.js";
import { JobSubscriptions } from "./subscriptions.js";
import type { CreateJobInput, JobRecord, UpdateJobInput } from "./types.js";

function key(workspace: string, jobId: string): string {
	return `${workspace}:${jobId}`;
}

export class MemoryJobStore implements JobStore {
	private readonly jobs = new Map<string, JobRecord>();
	private readonly subscriptions = new JobSubscriptions();

	async create(input: CreateJobInput): Promise<JobRecord> {
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
			leasedBy: null,
			leasedAt: null,
		};
		this.jobs.set(key(input.workspace, jobId), record);
		return record;
	}

	async get(workspace: string, jobId: string): Promise<JobRecord | null> {
		return this.jobs.get(key(workspace, jobId)) ?? null;
	}

	async update(
		workspace: string,
		jobId: string,
		patch: UpdateJobInput,
	): Promise<JobRecord> {
		const k = key(workspace, jobId);
		const existing = this.jobs.get(k);
		if (!existing) {
			throw new ControlPlaneNotFoundError("job", jobId);
		}
		const next: JobRecord = applyUpdate(existing, patch);
		this.jobs.set(k, next);
		this.subscriptions.fire(workspace, jobId, next);
		return next;
	}

	async subscribe(
		workspace: string,
		jobId: string,
		listener: JobListener,
	): Promise<Unsubscribe> {
		const unsub = this.subscriptions.add(workspace, jobId, listener);
		// Replay current state so callers don't race the first update.
		const current = this.jobs.get(key(workspace, jobId));
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
		const out: JobRecord[] = [];
		for (const r of this.jobs.values()) {
			if (r.status !== "running") continue;
			// Treat null leasedAt as stale-by-default (pre-lease-columns
			// records or running rows whose leaseholder never wrote).
			if (r.leasedAt === null || r.leasedAt < cutoffIso) {
				out.push(r);
			}
		}
		return out;
	}

	async claim(
		workspace: string,
		jobId: string,
		expectedHolder: string | null,
		newHolder: string,
	): Promise<JobRecord | null> {
		const k = key(workspace, jobId);
		const existing = this.jobs.get(k);
		if (!existing) return null;
		if (existing.leasedBy !== expectedHolder) return null;
		const now = nowIso();
		const next: JobRecord = {
			...existing,
			leasedBy: newHolder,
			leasedAt: now,
			updatedAt: now,
		};
		this.jobs.set(k, next);
		this.subscriptions.fire(workspace, jobId, next);
		return next;
	}
}

/** Shared patch-application helper — used by every {@link JobStore}
 * backend so update semantics don't drift between memory/file/astra. */
export function applyUpdate(
	existing: JobRecord,
	patch: UpdateJobInput,
): JobRecord {
	return {
		...existing,
		...(patch.status !== undefined && { status: patch.status }),
		...(patch.processed !== undefined && { processed: patch.processed }),
		...(patch.total !== undefined && { total: patch.total }),
		...(patch.result !== undefined && {
			result: patch.result ? { ...patch.result } : null,
		}),
		...(patch.errorMessage !== undefined && {
			errorMessage: patch.errorMessage,
		}),
		...(patch.leasedBy !== undefined && { leasedBy: patch.leasedBy }),
		...(patch.leasedAt !== undefined && { leasedAt: patch.leasedAt }),
		updatedAt: nowIso(),
	};
}
