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

import type { z } from "@hono/zod-openapi";
import type { ControlPlaneStore } from "../control-plane/store.js";
import type { RagDocumentRecord } from "../control-plane/types.js";
import type { VectorStoreDriverRegistry } from "../drivers/registry.js";
import type { EmbedderFactory } from "../embeddings/factory.js";
import { runKbIngest } from "../ingest/pipeline.js";
import { runKbIngestJob } from "../jobs/ingest-worker.js";
import type { JobStore } from "../jobs/store.js";
import type { IngestInputSnapshot, JobRecord } from "../jobs/types.js";
import type { KbIngestRequestSchema } from "../openapi/schemas.js";
import { resolveKb } from "../routes/api-v1/kb-descriptor.js";

export type KbIngestRequest = z.infer<typeof KbIngestRequestSchema>;

/**
 * Domain outcome of an ingest call. The route maps `queued` to 202
 * with a Location header and `completed` to 201; the service stays
 * out of the HTTP shape entirely.
 */
export type IngestOutcome =
	| {
			readonly kind: "completed";
			readonly document: RagDocumentRecord;
			readonly chunks: number;
	  }
	| {
			readonly kind: "queued";
			readonly document: RagDocumentRecord;
			readonly job: JobRecord;
	  };

export interface IngestServiceDeps {
	readonly store: ControlPlaneStore;
	readonly drivers: VectorStoreDriverRegistry;
	readonly embedders: EmbedderFactory;
	readonly jobs: JobStore;
	readonly replicaId: string;
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
	const { store, drivers, embedders, jobs, replicaId } = deps;

	return {
		async ingest(workspaceId, knowledgeBaseId, input, opts) {
			const resolved = await resolveKb(store, workspaceId, knowledgeBaseId);

			const document = await store.createRagDocument(
				workspaceId,
				knowledgeBaseId,
				{
					uid: input.documentId,
					sourceDocId: input.sourceDocId,
					sourceFilename: input.sourceFilename,
					fileType: input.fileType,
					fileSize: input.fileSize,
					contentHash: input.contentHash,
					status: "writing",
					metadata: input.metadata,
				},
			);

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
				void runKbIngestJob({
					deps: { store, drivers, embedders, jobs },
					workspaceId,
					jobId: job.jobId,
					replicaId,
					input,
				});
				return { kind: "queued", document, job };
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
			};
		},
	};
}
