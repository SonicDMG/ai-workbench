/**
 * Domain orchestration for KB ingest — owns the sync vs async fork.
 *
 * The route used to inline both paths: create the RAG document row,
 * then either run the pipeline synchronously or snapshot the input
 * into a job and fire-and-forget the worker. That orchestration moved
 * here so the route stays in the validate-and-delegate band, and so
 * Python/Java green-box parity has a clear porting target for the
 * one place this branching lives.
 */

import { createHash } from "node:crypto";
import type { z } from "@hono/zod-openapi";
import type { ControlPlaneStore } from "../control-plane/store.js";
import type {
	KnowledgeBaseRecord,
	RagDocumentRecord,
	VectorStoreRecord,
	WorkspaceRecord,
} from "../control-plane/types.js";
import type { VectorStoreDriverRegistry } from "../drivers/registry.js";
import type { EmbedderFactory } from "../embeddings/factory.js";
import { runKbIngest } from "../ingest/pipeline.js";
import { type IngestSemaphore, runBounded } from "../jobs/ingest-semaphore.js";
import { runKbIngestJob } from "../jobs/ingest-worker.js";
import type { JobStore } from "../jobs/store.js";
import type { IngestInputSnapshot, JobRecord } from "../jobs/types.js";
import type { KbIngestRequestSchema } from "../openapi/schemas.js";
import { resolveKb } from "../routes/api-v1/kb-descriptor.js";
import {
	type AstraInsertChunksSnapshot,
	type AstraQuerySnapshot,
	buildInsertChunksSnapshot,
} from "../snapshots/types.js";
import { cascadeDeleteRagDocument } from "./document-cascade.js";

export type KbIngestRequest = z.infer<typeof KbIngestRequestSchema>;

/**
 * Domain outcome of an ingest call. The route maps `queued` to 202
 * with a Location header, `completed` to 201, and `duplicate` /
 * `name_conflict` to 200; the service stays out of the HTTP shape
 * entirely.
 *
 * - `duplicate` fires when an existing document in this KB has the
 *   same SHA-256 of its content. The pipeline does NOT run again —
 *   the existing record is returned verbatim.
 * - `name_conflict` fires when an existing document in this KB
 *   has the same `sourceFilename` but a DIFFERENT content hash, and
 *   the request didn't set `overwriteOnNameConflict: true`. The
 *   client is expected to prompt the user (overwrite / skip) and
 *   re-issue the request with the flag set when they choose
 *   overwrite. The existing record is returned so the UI can show
 *   what's being replaced.
 *
 * When `overwriteOnNameConflict: true` is on the request, a
 * name-conflicted document is cascade-deleted (chunks + row) before
 * the new content is ingested in its place — `name_conflict` is NOT
 * returned in that path.
 */
export type IngestOutcome =
	| {
			readonly kind: "completed";
			readonly document: RagDocumentRecord;
			readonly chunks: number;
			readonly astraQueries: readonly AstraQuerySnapshot[];
	  }
	| {
			readonly kind: "queued";
			readonly document: RagDocumentRecord;
			readonly job: JobRecord;
			readonly astraQueries: readonly AstraQuerySnapshot[];
	  }
	| {
			readonly kind: "duplicate";
			readonly document: RagDocumentRecord;
	  }
	| {
			readonly kind: "name_conflict";
			readonly document: RagDocumentRecord;
	  };

/**
 * Compute the SHA-256 hex digest of the ingest text. The runtime is
 * the authoritative source for the hash so clients can't accidentally
 * (or deliberately) lie about what they uploaded — same input bytes
 * always produce the same digest, deterministically across hosts.
 */
function hashIngestText(text: string): string {
	return createHash("sha256").update(text, "utf8").digest("hex");
}

export interface IngestServiceDeps {
	readonly store: ControlPlaneStore;
	readonly drivers: VectorStoreDriverRegistry;
	readonly embedders: EmbedderFactory;
	readonly jobs: JobStore;
	readonly replicaId: string;
	/**
	 * Bounds in-flight async ingest workers. The async path always
	 * persists the job + ingest-input snapshot first, then queues the
	 * worker; if the cap is exhausted the caller's `void
	 * runKbIngestJob(...)` resolves a slot from the semaphore before
	 * starting work. Synchronous ingest is unaffected.
	 */
	readonly ingestSemaphore: IngestSemaphore;
}

export interface IngestService {
	ingest(
		workspaceId: string,
		knowledgeBaseId: string,
		input: KbIngestRequest,
		opts: { readonly async: boolean },
	): Promise<IngestOutcome>;
}

export function createIngestService(deps: IngestServiceDeps): IngestService {
	const { store, drivers, embedders, jobs, replicaId, ingestSemaphore } = deps;

	return {
		async ingest(workspaceId, knowledgeBaseId, input, opts) {
			const resolved = await resolveKb(store, workspaceId, knowledgeBaseId);

			// Authoritative content hash. Trust the request's hash only as
			// a hint — recompute server-side so the dedup index can't be
			// fooled by clients sending a fake digest.
			const contentHash = hashIngestText(input.text);

			// Dedup pre-check. If a document with the same content hash
			// already exists in this KB, short-circuit the create + chunk
			// + embed pipeline and return the existing record. The
			// pipeline is idempotent on chunkId (deterministic from the
			// document id), but re-running it for byte-identical content
			// is wasted work + redundant audit noise.
			const existing = await store.findRagDocumentByContentHash(
				workspaceId,
				knowledgeBaseId,
				contentHash,
			);
			if (existing) {
				return { kind: "duplicate", document: existing };
			}

			// Name-collision pre-check. If another doc in this KB has the
			// same `sourceFilename`, two paths:
			//   1. The client opted in to overwrite (`overwriteOnNameConflict
			//      = true`) → cascade-delete the old row + its vector chunks,
			//      then fall through to the normal create + ingest below.
			//   2. The client did not opt in → return `name_conflict` with
			//      the existing record so the UI can prompt the user. The
			//      pipeline does NOT run; a follow-up call with the flag
			//      set is expected.
			//
			// Skipped when `sourceFilename` is null/empty because there's
			// nothing to collide on — programmatic ingests without a name
			// always fall through to the create path.
			if (input.sourceFilename) {
				const nameMatch = await store.findRagDocumentBySourceFilename(
					workspaceId,
					knowledgeBaseId,
					input.sourceFilename,
				);
				if (nameMatch && nameMatch.contentHash !== contentHash) {
					if (input.overwriteOnNameConflict !== true) {
						return { kind: "name_conflict", document: nameMatch };
					}
					await cascadeDeleteRagDocument({
						store,
						drivers,
						workspace: resolved.workspace,
						knowledgeBase: resolved.knowledgeBase,
						descriptor: resolved.descriptor,
						documentId: nameMatch.documentId,
					});
				}
			}

			const document = await store.createRagDocument(
				workspaceId,
				knowledgeBaseId,
				{
					uid: input.documentId,
					sourceDocId: input.sourceDocId,
					sourceFilename: input.sourceFilename,
					fileType: input.fileType,
					fileSize: input.fileSize,
					contentHash,
					status: "writing",
					metadata: input.metadata,
				},
			);

			// Build the representative `insert_chunks` snapshot eagerly,
			// independent of sync vs. async — describes the call the
			// ingest pipeline will make against the data plane. Empty
			// for non-Astra workspaces.
			const astraQueries = maybeInsertChunksSnapshots({
				workspace: resolved.workspace,
				knowledgeBase: resolved.knowledgeBase,
				descriptor: resolved.descriptor,
				documentId: document.documentId,
			});

			if (opts.async) {
				const ingestSnapshot: IngestInputSnapshot = {
					text: input.text,
					...(input.metadata !== undefined && { metadata: input.metadata }),
					...(input.chunker !== undefined && {
						chunker: input.chunker as Readonly<Record<string, unknown>>,
					}),
				};
				const job = await jobs.create({
					workspace: workspaceId,
					kind: "ingest",
					knowledgeBaseId,
					documentId: document.documentId,
					ingestInput: ingestSnapshot,
				});
				void runBounded(ingestSemaphore, () =>
					runKbIngestJob({
						deps: { store, drivers, embedders, jobs },
						workspaceId,
						jobId: job.jobId,
						replicaId,
						input,
					}),
				);
				return { kind: "queued", document, job, astraQueries };
			}

			const result = await runKbIngest(
				{ store, drivers, embedders },
				{
					workspace: resolved.workspace,
					knowledgeBase: resolved.knowledgeBase,
					descriptor: resolved.descriptor,
					documentId: document.documentId,
				},
				input,
			);
			// Refetch — the pipeline patches the row to `ready` (or `failed`)
			// after upsert. Returning the post-pipeline row avoids surfacing
			// the transient `writing` state.
			const ready = await store.getRagDocument(
				workspaceId,
				knowledgeBaseId,
				document.documentId,
			);
			return {
				kind: "completed",
				document: ready ?? document,
				chunks: result.chunks,
				astraQueries,
			};
		},
	};
}

/**
 * Representative batch size for the captured `insertMany` call. The
 * actual pipeline runs `coll.insertMany` once per chunk batch (the
 * driver internally chooses the batch shape); this is the number the
 * snippet shows as a comment so users understand the call repeats.
 *
 * 50 mirrors the order of magnitude astrapy / astra-db-ts use in
 * their own examples for vectorize-on-insert. It's documentation, not
 * a runtime invariant — bumping it just changes the displayed number
 * in the generated snippet.
 */
const REPRESENTATIVE_INSERT_BATCH_SIZE = 50;

/**
 * Build a one-element `insert_chunks` snapshot list for Astra/HCD
 * workspaces, or `[]` for mock/file backends. Returned as a list (not
 * a singleton) so the caller's response shape matches the
 * `astraQueries: AstraQuerySnapshot[]` envelope every other surface
 * uses — and so future variants can append additional snapshots
 * (e.g. a pre-ingest `delete_by_document` when overwriting) without
 * changing the field's type.
 *
 * Exported only for unit testing.
 */
export function maybeInsertChunksSnapshots(args: {
	readonly workspace: WorkspaceRecord;
	readonly knowledgeBase: KnowledgeBaseRecord;
	readonly descriptor: VectorStoreRecord;
	readonly documentId: string;
}): AstraInsertChunksSnapshot[] {
	const { workspace, knowledgeBase, descriptor, documentId } = args;
	if (workspace.kind !== "astra" && workspace.kind !== "hcd") return [];
	return [
		buildInsertChunksSnapshot({
			envelope: {
				knowledgeBaseId: knowledgeBase.knowledgeBaseId,
				kbName: knowledgeBase.name,
				collection: descriptor.name,
				keyspace: workspace.keyspace,
			},
			documentId,
			batchSize: REPRESENTATIVE_INSERT_BATCH_SIZE,
		}),
	];
}
