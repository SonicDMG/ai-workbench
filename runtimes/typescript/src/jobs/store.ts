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

	/**
	 * List `running` jobs whose lease is stale — `leasedAt` is older
	 * than `cutoffIso`, OR `leasedAt` is null (records that pre-date
	 * the lease columns). The orphan-sweeper scans this list and
	 * tries to claim each entry. Implementations may scan
	 * cross-workspace; the sweeper handles per-workspace fan-out
	 * internally.
	 */
	findStaleRunning(cutoffIso: string): Promise<readonly JobRecord[]>;

	/**
	 * CAS-claim a lease. Sets `leasedBy = newHolder` + `leasedAt = now`
	 * **only if** the row's current `leasedBy === expectedHolder`.
	 * Returns the new record on success, null on lost race (another
	 * replica claimed first or the row's lease changed).
	 *
	 * Pass `expectedHolder = null` to claim an unleased record. The
	 * sweeper passes the *previous* leaseholder it observed so two
	 * replicas can't both fail-and-then-claim the same orphan.
	 */
	claim(
		workspace: string,
		jobId: string,
		expectedHolder: string | null,
		newHolder: string,
	): Promise<JobRecord | null>;
}
