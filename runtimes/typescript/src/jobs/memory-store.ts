/**
 * In-memory {@link JobStore} — the default backend for single-process
 * deployments.
 *
 * Internal shape:
 *   - `jobs: Map<\`${workspace}:${jobId}\`, JobRecord>`
 *   - `listeners: Map<\`${workspace}:${jobId}\`, Set<JobListener>>`
 *
 * Single-process means `subscribe()` is a pure in-memory map; the
 * producer (`update()`) and consumer (SSE handler) share the same
 * listener set. Cross-process pub/sub is a concern for persistent
 * backends.
 *
 * `listeners` is never cleaned up — terminal jobs stick around with
 * their listener set empty after all subscribers unsubscribe. That's
 * fine at this slice's scale (jobs are per-request); a later slice
 * should add GC on terminal + no-subscribers.
 */

import { randomUUID } from "node:crypto";
import { nowIso } from "../control-plane/defaults.js";
import { ControlPlaneNotFoundError } from "../control-plane/errors.js";
import type { JobListener, JobStore, Unsubscribe } from "./store.js";
import type { CreateJobInput, JobRecord, UpdateJobInput } from "./types.js";

function key(workspace: string, jobId: string): string {
	return `${workspace}:${jobId}`;
}

export class MemoryJobStore implements JobStore {
	private readonly jobs = new Map<string, JobRecord>();
	private readonly listeners = new Map<string, Set<JobListener>>();

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
		const next: JobRecord = {
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
			updatedAt: nowIso(),
		};
		this.jobs.set(k, next);

		// Fire listeners AFTER the store is consistent — a listener
		// observing the update can immediately fetch and see the same
		// state via `get()`.
		const listeners = this.listeners.get(k);
		if (listeners) {
			for (const listener of listeners) {
				// Defensive: never let one listener's error block others
				// or reject this Promise.
				try {
					listener(next);
				} catch {
					// Swallow — listener is responsible for its own errors.
				}
			}
		}
		return next;
	}

	async subscribe(
		workspace: string,
		jobId: string,
		listener: JobListener,
	): Promise<Unsubscribe> {
		const k = key(workspace, jobId);
		let set = this.listeners.get(k);
		if (!set) {
			set = new Set();
			this.listeners.set(k, set);
		}
		set.add(listener);

		// Replay current state so subscribers don't race the first
		// update.
		const current = this.jobs.get(k);
		if (current) {
			try {
				listener(current);
			} catch {
				// Swallow — same policy as update().
			}
		}

		return () => {
			set?.delete(listener);
		};
	}
}
