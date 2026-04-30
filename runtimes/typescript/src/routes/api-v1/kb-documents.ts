/**
 * `/api/v1/workspaces/{workspaceId}/knowledge-bases/{knowledgeBaseId}/...`
 * document metadata CRUD, sync + async ingest, and chunk listing
 * (issue #98).
 *
 * Mirrors the legacy `/catalogs/{c}/documents` surface — the old
 * routes stay alive during phase 1c so the UI can migrate
 * incrementally; phase 1c.4 retires them.
 *
 * Search is handled by `kb-data-plane.ts` (POST .../search).
 * Documents/ingest live here because they touch the
 * RAG-document control-plane tables in addition to the data
 * plane, and pulling them onto the data-plane router would
 * couple two concerns that shouldn't share code.
 */

import { createRoute, type OpenAPIHono, z } from "@hono/zod-openapi";
import { assertWorkspaceAccess } from "../../auth/authz.js";
import { ControlPlaneNotFoundError } from "../../control-plane/errors.js";
import type { ControlPlaneStore } from "../../control-plane/store.js";
import type { VectorStoreDriverRegistry } from "../../drivers/registry.js";
import type { EmbedderFactory } from "../../embeddings/factory.js";
import {
	CHUNK_INDEX_KEY,
	CHUNK_TEXT_KEY,
	DOCUMENT_SCOPE_KEY,
	KB_SCOPE_KEY,
} from "../../ingest/payload-keys.js";
import { runKbIngest } from "../../ingest/pipeline.js";
import { runKbIngestJob } from "../../jobs/ingest-worker.js";
import type { JobStore } from "../../jobs/store.js";
import type { IngestInputSnapshot } from "../../jobs/types.js";
import { ApiError } from "../../lib/errors.js";
import { makeOpenApi } from "../../lib/openapi.js";
import { paginate } from "../../lib/pagination.js";
import type { AppEnv } from "../../lib/types.js";
import {
	CreateRagDocumentInputSchema,
	DocumentChunkSchema,
	DocumentIdParamSchema,
	ErrorEnvelopeSchema,
	KbAsyncIngestResponseSchema,
	KbIngestRequestSchema,
	KbIngestResponseSchema,
	KnowledgeBaseIdParamSchema,
	PaginationQuerySchema,
	RagDocumentPageSchema,
	RagDocumentRecordSchema,
	UpdateRagDocumentInputSchema,
	WorkspaceIdParamSchema,
} from "../../openapi/schemas.js";
import { toWireJob } from "./job-wire.js";
import { resolveKb } from "./kb-descriptor.js";

export interface KbDocumentRouteDeps {
	readonly store: ControlPlaneStore;
	readonly drivers: VectorStoreDriverRegistry;
	readonly embedders: EmbedderFactory;
	readonly jobs: JobStore;
	readonly replicaId: string;
}

export function kbDocumentRoutes(
	deps: KbDocumentRouteDeps,
): OpenAPIHono<AppEnv> {
	const { store, drivers, embedders, jobs, replicaId } = deps;
	const app = makeOpenApi();

	app.openapi(
		createRoute({
			method: "get",
			path: "/{workspaceId}/knowledge-bases/{knowledgeBaseId}/documents",
			tags: ["knowledge-bases"],
			summary: "List documents in a knowledge base",
			request: {
				params: z.object({
					workspaceId: WorkspaceIdParamSchema,
					knowledgeBaseId: KnowledgeBaseIdParamSchema,
				}),
				query: PaginationQuerySchema,
			},
			responses: {
				200: {
					content: { "application/json": { schema: RagDocumentPageSchema } },
					description: "All documents in the knowledge base",
				},
				404: {
					content: { "application/json": { schema: ErrorEnvelopeSchema } },
					description: "Workspace or knowledge base not found",
				},
			},
		}),
		async (c) => {
			const { workspaceId, knowledgeBaseId } = c.req.valid("param");
			const query = c.req.valid("query");
			assertWorkspaceAccess(c, workspaceId);
			const rows = await store.listRagDocuments(workspaceId, knowledgeBaseId);
			return c.json(paginate(rows, query), 200);
		},
	);

	app.openapi(
		createRoute({
			method: "post",
			path: "/{workspaceId}/knowledge-bases/{knowledgeBaseId}/documents",
			tags: ["knowledge-bases"],
			summary: "Register a document in a knowledge base",
			request: {
				params: z.object({
					workspaceId: WorkspaceIdParamSchema,
					knowledgeBaseId: KnowledgeBaseIdParamSchema,
				}),
				body: {
					content: {
						"application/json": { schema: CreateRagDocumentInputSchema },
					},
				},
			},
			responses: {
				201: {
					content: {
						"application/json": { schema: RagDocumentRecordSchema },
					},
					description: "Document created",
				},
				404: {
					content: { "application/json": { schema: ErrorEnvelopeSchema } },
					description: "Workspace or knowledge base not found",
				},
				409: {
					content: { "application/json": { schema: ErrorEnvelopeSchema } },
					description: "Duplicate documentId within the knowledge base",
				},
			},
		}),
		async (c) => {
			const { workspaceId, knowledgeBaseId } = c.req.valid("param");
			assertWorkspaceAccess(c, workspaceId);
			const body = c.req.valid("json");
			const record = await store.createRagDocument(
				workspaceId,
				knowledgeBaseId,
				{ ...body, uid: body.documentId },
			);
			return c.json(record, 201);
		},
	);

	app.openapi(
		createRoute({
			method: "post",
			path: "/{workspaceId}/knowledge-bases/{knowledgeBaseId}/ingest",
			tags: ["knowledge-bases"],
			summary: "Ingest a document into a knowledge base",
			description:
				"Chunks `text`, embeds each chunk via the KB's bound embedding service (server-side `$vectorize` when supported, otherwise client-side), and upserts into the KB's auto-provisioned vector collection. Creates a RAG-document metadata row; failures mark it `status: failed` with `errorMessage`. With `?async=true` the request returns 202 with a job pointer instead — the pipeline runs in the background and the document status plus the job's `processed`/`total`/`status` fields track progress.",
			request: {
				params: z.object({
					workspaceId: WorkspaceIdParamSchema,
					knowledgeBaseId: KnowledgeBaseIdParamSchema,
				}),
				query: z.object({
					async: z
						.enum(["true", "false"])
						.optional()
						.openapi({
							param: { name: "async", in: "query" },
							description:
								"When 'true', run the pipeline in the background and return 202 with a job pointer. Default is synchronous (201).",
						}),
				}),
				body: {
					content: { "application/json": { schema: KbIngestRequestSchema } },
				},
			},
			responses: {
				201: {
					content: { "application/json": { schema: KbIngestResponseSchema } },
					description: "Document created and chunks upserted (sync path)",
				},
				202: {
					content: {
						"application/json": { schema: KbAsyncIngestResponseSchema },
					},
					description: "Ingest queued; poll the job for progress",
				},
				400: {
					content: { "application/json": { schema: ErrorEnvelopeSchema } },
					description: "Validation, chunker config, or dimension mismatch",
				},
				404: {
					content: { "application/json": { schema: ErrorEnvelopeSchema } },
					description: "Workspace or knowledge base not found",
				},
			},
		}),
		async (c) => {
			const { workspaceId, knowledgeBaseId } = c.req.valid("param");
			const { async: asyncMode } = c.req.valid("query");
			assertWorkspaceAccess(c, workspaceId);
			const body = c.req.valid("json");

			const resolved = await resolveKb(store, workspaceId, knowledgeBaseId);

			const document = await store.createRagDocument(
				workspaceId,
				knowledgeBaseId,
				{
					uid: body.documentId,
					sourceDocId: body.sourceDocId,
					sourceFilename: body.sourceFilename,
					fileType: body.fileType,
					fileSize: body.fileSize,
					contentHash: body.contentHash,
					status: "writing",
					metadata: body.metadata,
				},
			);

			const ingestCtx = {
				workspace: resolved.workspace,
				knowledgeBase: resolved.knowledgeBase,
				descriptor: resolved.descriptor,
				documentId: document.documentId,
			};

			if (asyncMode === "true") {
				const ingestSnapshot: IngestInputSnapshot = {
					text: body.text,
					...(body.metadata !== undefined && { metadata: body.metadata }),
					...(body.chunker !== undefined && {
						chunker: body.chunker as Readonly<Record<string, unknown>>,
					}),
				};
				const job = await jobs.create({
					workspace: workspaceId,
					kind: "ingest",
					knowledgeBaseId: knowledgeBaseId,
					documentId: document.documentId,
					ingestInput: ingestSnapshot,
				});
				void runKbIngestJob({
					deps: { store, drivers, embedders, jobs },
					workspaceId: workspaceId,
					jobId: job.jobId,
					replicaId,
					input: body,
				});
				c.header(
					"Location",
					`/api/v1/workspaces/${workspaceId}/jobs/${job.jobId}`,
				);
				return c.json({ job: toWireJob(job), document }, 202);
			}

			const result = await runKbIngest(
				{ store, drivers, embedders },
				ingestCtx,
				body,
			);
			const ready = await store.getRagDocument(
				workspaceId,
				knowledgeBaseId,
				document.documentId,
			);
			return c.json(
				{
					document: ready ?? document,
					chunks: result.chunks,
				},
				201,
			);
		},
	);

	app.openapi(
		createRoute({
			method: "get",
			path: "/{workspaceId}/knowledge-bases/{knowledgeBaseId}/documents/{documentId}/chunks",
			tags: ["knowledge-bases"],
			summary: "List the chunks under a KB document",
			description:
				"Reads raw records out of the KB's vector collection filtered to this document, sorted by `chunkIndex`. Text comes from the reserved `chunkText` payload key the ingest pipeline stamps. Drivers without `listRecords` return 501.",
			request: {
				params: z.object({
					workspaceId: WorkspaceIdParamSchema,
					knowledgeBaseId: KnowledgeBaseIdParamSchema,
					documentId: DocumentIdParamSchema,
				}),
				query: z.object({
					limit: z.coerce.number().int().min(1).max(1000).optional(),
				}),
			},
			responses: {
				200: {
					content: {
						"application/json": { schema: z.array(DocumentChunkSchema) },
					},
					description: "Chunks under the document",
				},
				404: {
					content: { "application/json": { schema: ErrorEnvelopeSchema } },
					description: "Workspace, knowledge base, or document not found",
				},
				501: {
					content: { "application/json": { schema: ErrorEnvelopeSchema } },
					description: "Driver doesn't support listRecords",
				},
			},
		}),
		async (c) => {
			const { workspaceId, knowledgeBaseId, documentId } = c.req.valid("param");
			const { limit } = c.req.valid("query");
			assertWorkspaceAccess(c, workspaceId);

			const doc = await store.getRagDocument(
				workspaceId,
				knowledgeBaseId,
				documentId,
			);
			if (!doc) throw new ControlPlaneNotFoundError("document", documentId);

			const resolved = await resolveKb(store, workspaceId, knowledgeBaseId);
			const driver = drivers.for(resolved.workspace);
			if (typeof driver.listRecords !== "function") {
				throw new ApiError(
					"list_records_not_supported",
					`driver for workspace kind '${resolved.workspace.kind}' doesn't support listRecords`,
					501,
				);
			}

			const records = await driver.listRecords(
				{ workspace: resolved.workspace, descriptor: resolved.descriptor },
				{
					filter: {
						[KB_SCOPE_KEY]: knowledgeBaseId,
						[DOCUMENT_SCOPE_KEY]: documentId,
					},
					limit: limit ?? 1000,
				},
			);

			const chunks = records
				.map((r) => {
					const idx = r.payload[CHUNK_INDEX_KEY];
					const txt = r.payload[CHUNK_TEXT_KEY];
					return {
						id: r.id,
						chunkIndex: typeof idx === "number" ? idx : null,
						text: typeof txt === "string" ? txt : null,
						payload: r.payload,
					};
				})
				.sort((a, b) => {
					if (a.chunkIndex === null) return 1;
					if (b.chunkIndex === null) return -1;
					return a.chunkIndex - b.chunkIndex;
				});

			return c.json(chunks, 200);
		},
	);

	app.openapi(
		createRoute({
			method: "get",
			path: "/{workspaceId}/knowledge-bases/{knowledgeBaseId}/documents/{documentId}",
			tags: ["knowledge-bases"],
			summary: "Get a KB document",
			request: {
				params: z.object({
					workspaceId: WorkspaceIdParamSchema,
					knowledgeBaseId: KnowledgeBaseIdParamSchema,
					documentId: DocumentIdParamSchema,
				}),
			},
			responses: {
				200: {
					content: {
						"application/json": { schema: RagDocumentRecordSchema },
					},
					description: "Document",
				},
				404: {
					content: { "application/json": { schema: ErrorEnvelopeSchema } },
					description: "Workspace, knowledge base, or document not found",
				},
			},
		}),
		async (c) => {
			const { workspaceId, knowledgeBaseId, documentId } = c.req.valid("param");
			assertWorkspaceAccess(c, workspaceId);
			const record = await store.getRagDocument(
				workspaceId,
				knowledgeBaseId,
				documentId,
			);
			if (!record) throw new ControlPlaneNotFoundError("document", documentId);
			return c.json(record, 200);
		},
	);

	app.openapi(
		createRoute({
			method: "patch",
			path: "/{workspaceId}/knowledge-bases/{knowledgeBaseId}/documents/{documentId}",
			tags: ["knowledge-bases"],
			summary: "Update KB document metadata",
			request: {
				params: z.object({
					workspaceId: WorkspaceIdParamSchema,
					knowledgeBaseId: KnowledgeBaseIdParamSchema,
					documentId: DocumentIdParamSchema,
				}),
				body: {
					content: {
						"application/json": { schema: UpdateRagDocumentInputSchema },
					},
				},
			},
			responses: {
				200: {
					content: {
						"application/json": { schema: RagDocumentRecordSchema },
					},
					description: "Updated document",
				},
				404: {
					content: { "application/json": { schema: ErrorEnvelopeSchema } },
					description: "Workspace, knowledge base, or document not found",
				},
			},
		}),
		async (c) => {
			const { workspaceId, knowledgeBaseId, documentId } = c.req.valid("param");
			assertWorkspaceAccess(c, workspaceId);
			const body = c.req.valid("json");
			const record = await store.updateRagDocument(
				workspaceId,
				knowledgeBaseId,
				documentId,
				body,
			);
			return c.json(record, 200);
		},
	);

	app.openapi(
		createRoute({
			method: "delete",
			path: "/{workspaceId}/knowledge-bases/{knowledgeBaseId}/documents/{documentId}",
			tags: ["knowledge-bases"],
			summary: "Delete a KB document (cascades chunks)",
			request: {
				params: z.object({
					workspaceId: WorkspaceIdParamSchema,
					knowledgeBaseId: KnowledgeBaseIdParamSchema,
					documentId: DocumentIdParamSchema,
				}),
			},
			responses: {
				204: { description: "Deleted" },
				404: {
					content: { "application/json": { schema: ErrorEnvelopeSchema } },
					description: "Workspace, knowledge base, or document not found",
				},
			},
		}),
		async (c) => {
			const { workspaceId, knowledgeBaseId, documentId } = c.req.valid("param");
			assertWorkspaceAccess(c, workspaceId);

			const existing = await store.getRagDocument(
				workspaceId,
				knowledgeBaseId,
				documentId,
			);
			if (!existing) {
				throw new ControlPlaneNotFoundError("document", documentId);
			}

			// Cascade: drop chunk records out of the KB's vector collection
			// before the doc row goes away. Otherwise orphan chunks linger
			// and surface in KB-scoped search.
			const resolved = await resolveKb(store, workspaceId, knowledgeBaseId);
			const driver = drivers.for(resolved.workspace);
			const filter = {
				[KB_SCOPE_KEY]: knowledgeBaseId,
				[DOCUMENT_SCOPE_KEY]: documentId,
			};
			if (typeof driver.deleteRecords === "function") {
				await driver.deleteRecords(
					{ workspace: resolved.workspace, descriptor: resolved.descriptor },
					filter,
				);
			} else if (typeof driver.listRecords === "function") {
				const rows = await driver.listRecords(
					{ workspace: resolved.workspace, descriptor: resolved.descriptor },
					{ filter, limit: 1000 },
				);
				for (const r of rows) {
					await driver.deleteRecord(
						{ workspace: resolved.workspace, descriptor: resolved.descriptor },
						r.id,
					);
				}
			}

			const { deleted } = await store.deleteRagDocument(
				workspaceId,
				knowledgeBaseId,
				documentId,
			);
			if (!deleted) {
				throw new ControlPlaneNotFoundError("document", documentId);
			}
			return c.body(null, 204);
		},
	);

	return app;
}
