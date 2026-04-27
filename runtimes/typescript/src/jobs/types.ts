/**
 * Job types for the async-ingest pipeline.
 *
 * A `Job` is a server-side record of a long-running operation (today:
 * catalog ingest; future: bulk export, reindex, delete). Clients
 * receive a `jobId` when they kick off the work, then poll
 * `GET /jobs/{jobId}` or subscribe via SSE to learn about progress.
 *
 * This slice ships an **in-memory** job store: entries live for the
 * lifetime of the runtime process and are lost on restart. Persistent
 * backends (file, astra) can follow later using the same
 * {@link ./store.JobStore} seam. Recovering in-flight jobs across
 * restart is a separate problem (requires durability + retry) and is
 * explicitly out of scope here.
 */

/** Lifecycle state of a job. Terminal states: `succeeded`, `failed`. */
export type JobStatus = "pending" | "running" | "succeeded" | "failed";

/** Kind discriminates the payload of `result`. More kinds arrive as
 * more async operations ship. */
export type JobKind = "ingest";

/**
 * Persisted input snapshot for an `ingest` job — exactly what the
 * pipeline received (text, optional metadata, optional chunker
 * options). Stored alongside the job record so the cross-replica
 * orphan sweeper can replay the pipeline after reclaiming an
 * abandoned lease, instead of marking the job failed and forcing
 * the user to retry.
 *
 * Mirrors `IngestInput` in `src/ingest/pipeline.ts`. Kept as a
 * dedicated job-types declaration so the jobs layer doesn't take a
 * compile-time dependency on the ingest pipeline.
 */
export interface IngestInputSnapshot {
	readonly text: string;
	readonly metadata?: Readonly<Record<string, string>>;
	readonly chunker?: Readonly<Record<string, unknown>>;
}

/** Terminal-state check helper. */
export function isTerminal(status: JobStatus): boolean {
	return status === "succeeded" || status === "failed";
}

/**
 * Canonical job record. Workspace-scoped so authorization reuses the
 * existing `assertWorkspaceAccess`; `knowledgeBaseUid` + `documentUid`
 * are attached for ingest jobs so the UI can link back without an
 * extra fetch.
 */
export interface JobRecord {
	readonly workspace: string;
	readonly jobId: string;
	readonly kind: JobKind;
	/** For ingest jobs — the knowledge base the document was ingested
	 * into. */
	readonly knowledgeBaseUid: string | null;
	/** For ingest jobs — the document row that tracks status in parallel. */
	readonly documentUid: string | null;
	readonly status: JobStatus;
	/** Number of units processed so far. Unit is job-kind specific:
	 * for ingest, "chunks embedded + upserted". */
	readonly processed: number;
	/** Total units expected, or `null` if unknown at enqueue time. */
	readonly total: number | null;
	/** Arbitrary kind-specific summary written on success. Typed
	 * loosely at this layer because it's serialized through JSON on
	 * every backend. */
	readonly result: Readonly<Record<string, unknown>> | null;
	readonly errorMessage: string | null;
	readonly createdAt: string;
	readonly updatedAt: string;
	/**
	 * Identifier of the replica currently driving the pipeline, or
	 * `null` when the job is unclaimed (just-created `pending`,
	 * already-terminal `succeeded` / `failed`, or freshly released
	 * after a graceful shutdown).
	 *
	 * The async-ingest worker stamps this on lease-claim and clears it
	 * on terminal. Phase 2b's orphan-sweeper (next slice) treats
	 * `status: "running"` records whose `leasedAt` is older than a
	 * grace window as abandoned and re-claims them.
	 */
	readonly leasedBy: string | null;
	/**
	 * Last heartbeat timestamp for the lease holder. Bumped on every
	 * progress `update()` call by the active worker. Sweeper looks at
	 * `leasedAt` rather than `updatedAt` so unrelated patches (e.g.
	 * an operator manually setting `errorMessage`) don't reset the
	 * lease clock.
	 */
	readonly leasedAt: string | null;
	/**
	 * Persisted ingest input — present on `ingest` jobs created by
	 * the async path so the orphan sweeper can replay them after
	 * reclaim. `null` for jobs created before this column shipped or
	 * for synchronous (sync-path) ingests that don't allocate a job
	 * record at all.
	 */
	readonly ingestInput: IngestInputSnapshot | null;
}

/** Patch shape for job updates. Only progress-relevant fields appear
 * here — the workspace/kind/ids are frozen at create time. */
export interface UpdateJobInput {
	readonly status?: JobStatus;
	readonly processed?: number;
	readonly total?: number | null;
	readonly result?: Readonly<Record<string, unknown>> | null;
	readonly errorMessage?: string | null;
	/** Set to a replica id to claim the lease, or `null` to release.
	 * The store does not enforce CAS here — that comes via the
	 * dedicated `claim()` primitive in the orphan-sweeper slice. */
	readonly leasedBy?: string | null;
	/** Heartbeat timestamp. Workers bump this on every progress update
	 * to keep the lease fresh; the sweeper uses it to find orphans. */
	readonly leasedAt?: string | null;
}

export interface CreateJobInput {
	readonly workspace: string;
	readonly kind: JobKind;
	readonly knowledgeBaseUid?: string | null;
	readonly documentUid?: string | null;
	/** Optional job id — generated if omitted. */
	readonly jobId?: string;
	readonly total?: number | null;
	/** Persisted on create for `ingest` jobs created via the async
	 * path. The orphan sweeper reads this back on reclaim to drive a
	 * resume; sync ingests and non-ingest jobs leave it `null`. */
	readonly ingestInput?: IngestInputSnapshot | null;
}
