/**
 * Backend-agnostic {@link JobStore} contract.
 *
 * Today only the in-memory impl ships ({@link ./memory-store.MemoryJobStore}).
 * File / astra backends can slot in behind the same interface; the
 * pub/sub semantics of {@link subscribe} need extra thought for
 * multi-replica deployments (Redis pub/sub, etc.) so durable backends
 * arrive after we've shaken out the ingest model on a single node.
 */

import type { CreateJobInput, JobRecord, UpdateJobInput } from "./types.js";

/** Unsubscribe callback returned by {@link JobStore.subscribe}. */
export type Unsubscribe = () => void;

/** Called on every successful `update` for a subscribed job. */
export type JobListener = (record: JobRecord) => void;

export interface JobStore {
	/** Insert a pending job and return the fresh record. */
	create(input: CreateJobInput): Promise<JobRecord>;

	/** Lookup by workspace + jobId. Returns null if missing. */
	get(workspace: string, jobId: string): Promise<JobRecord | null>;

	/**
	 * Apply a patch. Throws if the job doesn't exist. Returns the
	 * post-update record. Fires every subscriber's listener with the
	 * new record before resolving.
	 */
	update(
		workspace: string,
		jobId: string,
		patch: UpdateJobInput,
	): Promise<JobRecord>;

	/**
	 * Subscribe to updates for one job. If the job already exists, the
	 * listener is invoked once immediately with the current record so
	 * callers don't race the first update.
	 *
	 * Returns an `Unsubscribe` — call it when the subscriber goes away
	 * (HTTP request closed, SSE client disconnected). Impls MUST tolerate
	 * an unsubscribe that fires after the job is already deleted.
	 */
	subscribe(
		workspace: string,
		jobId: string,
		listener: JobListener,
	): Promise<Unsubscribe>;
}
