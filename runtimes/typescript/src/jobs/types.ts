/**
 * Job types for the async-ingest pipeline.
 *
 * A `Job` is a server-side record of a long-running operation (today:
 * KB ingest; future: bulk export, reindex, delete). Clients
 * receive a `jobId` when they kick off the work, then poll
 * `GET /jobs/{jobId}` or subscribe via SSE to learn about progress.
 *
 * Memory, file, and Astra backends share the same
 * {@link ./store.JobStore} seam. File and Astra persist job records;
 * Astra also supports cross-replica subscription polling plus
 * lease/heartbeat metadata for orphan reclaim.
 */

/** Lifecycle state of a job. Terminal states: `succeeded`, `failed`. */
export type JobStatus = "pending" | "running" | "succeeded" | "failed";

/**
 * Kind discriminates the payload of `result` and selects the resume
 * callback the orphan sweeper consults. `"ingest"` is the only kind
 * with a producer today; more arrive as more async operations ship.
 *
 * Kept a closed literal union so the public wire schema (the OpenAPI
 * job response pins `kind`) stays exact. The durability machinery —
 * the {@link JobInputSnapshot} blob and the
 * {@link ./resume-registry.ResumeRegistry} — is structurally
 * kind-agnostic, so adding a resumable kind is: extend this union, add
 * a producer, register a resume callback.
 */
export type JobKind = "ingest";

/**
 * Kind-tagged resume snapshot persisted on a {@link JobRecord}.
 *
 * A JSON blob — the orphan sweeper hands it back to the resume
 * callback registered for the record's {@link JobRecord.kind}, which
 * knows how to interpret it. Stored alongside the job so the
 * cross-replica sweeper can replay the work after reclaiming an
 * abandoned lease, instead of marking the job failed and forcing the
 * user to retry.
 *
 * The shape is per-kind and opaque at this layer (same loose typing as
 * {@link JobRecord.result}, since it serializes through JSON on every
 * backend). For `ingest` jobs the blob is an {@link IngestInputSnapshot}.
 */
export type JobInputSnapshot = Readonly<Record<string, unknown>>;

/**
 * Persisted input snapshot for an `ingest` job — exactly what the
 * pipeline received (text, optional metadata, optional chunker
 * options). This is the `ingest` kind's concrete
 * {@link JobInputSnapshot}.
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
 * Canonical job record. Workspace-scoped so the app-level workspace
 * authz wrapper gates access; `knowledgeBaseId` + `documentId` are
 * attached for ingest jobs so the UI can link back without an extra
 * fetch.
 */
export interface JobRecord {
	readonly workspace: string;
	readonly jobId: string;
	readonly kind: JobKind;
	/** For ingest jobs — the knowledge base the document was ingested
	 * into. */
	readonly knowledgeBaseId: string | null;
	/** For ingest jobs — the document row that tracks status in parallel. */
	readonly documentId: string | null;
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
	 * on terminal. The orphan sweeper treats `status: "running"` records
	 * whose `leasedAt` is older than a grace window as abandoned and
	 * re-claims them.
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
	 * Kind-tagged resume snapshot — present on jobs created by an
	 * async path that wants to be resumable, so the orphan sweeper can
	 * replay them after reclaim. Interpreted by the resume callback
	 * registered for {@link kind}; for `ingest` it's an
	 * {@link IngestInputSnapshot}.
	 *
	 * `null` for jobs created before any snapshot was persisted
	 * (including pre-`ingest_input_json` rows — those are migrated in
	 * on read), for synchronous paths that don't allocate a job record,
	 * and for kinds that don't persist a snapshot.
	 */
	readonly inputSnapshot: JobInputSnapshot | null;
}

/**
 * On-disk / serialized shape of a job, as read back from a durable
 * backend (file JSON, SQLite `data` blob, Astra row converters).
 *
 * Differs from {@link JobRecord} only in that the lease + snapshot
 * fields are optional and the deprecated `ingestInput` field may still
 * be present on rows written before the rename. {@link hydrateJobRow}
 * folds these into a canonical {@link JobRecord}.
 */
export type PersistedJobRow = Partial<JobRecord> & {
	/** Legacy snapshot field, superseded by `inputSnapshot`. Read for
	 * back-compat on rows written before the rename. */
	readonly ingestInput?: JobInputSnapshot | null;
};

/**
 * Fold a {@link PersistedJobRow} into a canonical {@link JobRecord},
 * backfilling fields that pre-date the lease + resume-snapshot columns.
 *
 * The snapshot resolves from the kind-agnostic `inputSnapshot` when
 * present and falls back to the legacy `ingestInput` field, so jobs
 * persisted before the rename still resume. Shared by every durable
 * backend so back-compat handling can't drift between them.
 */
export function hydrateJobRow(row: PersistedJobRow): JobRecord {
	return {
		...(row as JobRecord),
		leasedBy: row.leasedBy ?? null,
		leasedAt: row.leasedAt ?? null,
		inputSnapshot: row.inputSnapshot ?? row.ingestInput ?? null,
	};
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
	readonly knowledgeBaseId?: string | null;
	readonly documentId?: string | null;
	/** Optional job id — generated if omitted. */
	readonly jobId?: string;
	readonly total?: number | null;
	/** Kind-tagged resume snapshot persisted on create. The orphan
	 * sweeper reads it back on reclaim and hands it to the kind's
	 * resume callback; paths that aren't resumable leave it `null`. */
	readonly inputSnapshot?: JobInputSnapshot | null;
	/**
	 * @deprecated Back-compat alias for {@link inputSnapshot}, kept so
	 * the ingest service can keep passing `ingestInput` while callers
	 * migrate to the kind-agnostic field. When both are supplied
	 * `inputSnapshot` wins. New code should set `inputSnapshot`.
	 */
	readonly ingestInput?: IngestInputSnapshot | null;
}

/**
 * Resolve the canonical input snapshot from a {@link CreateJobInput},
 * preferring the kind-agnostic `inputSnapshot` and falling back to the
 * deprecated `ingestInput` alias. Returns `null` when neither is set.
 *
 * Centralized here so all four backends derive the persisted snapshot
 * identically.
 */
export function resolveInputSnapshot(
	input: Pick<CreateJobInput, "inputSnapshot" | "ingestInput">,
): JobInputSnapshot | null {
	if (input.inputSnapshot != null) return input.inputSnapshot;
	// `IngestInputSnapshot` has named fields rather than an index
	// signature, so spread it into a fresh record to land on the
	// kind-agnostic `JobInputSnapshot` shape.
	if (input.ingestInput != null) return { ...input.ingestInput };
	return null;
}
