/**
 * `/api/v1/workspaces/{workspaceId}/knowledge-bases/{knowledgeBaseId}/...`
 * document metadata CRUD, sync + async ingest, and chunk listing
 * (issue #98).
 *
 * Search is handled by `kb-data-plane.ts` (POST .../search).
 * Documents/ingest live here because they touch the
 * RAG-document control-plane tables in addition to the data
 * plane, and pulling them onto the data-plane router would
 * couple two concerns that shouldn't share code.
 */

import { createRoute, type OpenAPIHono, z } from "@hono/zod-openapi";
import { ControlPlaneNotFoundError } from "../../control-plane/errors.js";
import type { ControlPlaneStore } from "../../control-plane/store.js";
import type { VectorStoreDriverRegistry } from "../../drivers/registry.js";
import type { EmbedderFactory } from "../../embeddings/factory.js";
import type { ExtractorRegistry } from "../../ingest/extractors/index.js";
import { ExtractError } from "../../ingest/extractors/index.js";
import {
	CHUNK_INDEX_KEY,
	CHUNK_TEXT_KEY,
	DOCUMENT_SCOPE_KEY,
	KB_SCOPE_KEY,
} from "../../ingest/payload-keys.js";
import type { JobStore } from "../../jobs/store.js";
import { audit } from "../../lib/audit.js";
import { ApiError } from "../../lib/errors.js";
import { errorResponse, makeOpenApi } from "../../lib/openapi.js";
import { paginate } from "../../lib/pagination.js";
import type { AppEnv } from "../../lib/types.js";
import {
	CreateRagDocumentInputSchema,
	DocumentChunkSchema,
	DocumentIdParamSchema,
	KbAsyncIngestResponseSchema,
	KbIngestNonCreateResponseSchema,
	KbIngestRequestSchema,
	KbIngestResponseSchema,
	KnowledgeBaseIdParamSchema,
	PaginationQuerySchema,
	RagDocumentPageSchema,
	RagDocumentRecordSchema,
	UpdateRagDocumentInputSchema,
	WorkspaceIdParamSchema,
} from "../../openapi/schemas.js";
import { cascadeDeleteRagDocument } from "../../services/document-cascade.js";
import { createIngestService } from "../../services/ingest-service.js";
import { resolveKb } from "./kb-descriptor.js";
import { toWireJob } from "./serdes/index.js";

export interface KbDocumentRouteDeps {
	readonly store: ControlPlaneStore;
	readonly drivers: VectorStoreDriverRegistry;
	readonly embedders: EmbedderFactory;
	readonly jobs: JobStore;
	readonly replicaId: string;
	readonly ingestSemaphore: import("../../jobs/ingest-semaphore.js").IngestSemaphore;
	readonly extractors: ExtractorRegistry;
}

const AsyncIngestQuerySchema = z.object({
	async: z
		.enum(["true", "false"])
		.optional()
		.openapi({
			param: { name: "async", in: "query" },
			description:
				"When 'true', run the pipeline in the background and return 202 with a job pointer. Default is synchronous (201).",
		}),
});

const KbIngestFileFormSchema = z
	.object({
		file: z.string().openapi({
			type: "string",
			format: "binary",
			description:
				"Document bytes. Supported formats include PDF, DOCX, XLSX, and plain text.",
		}),
		parser: z.enum(["auto", "native", "docling"]).optional().openapi({
			description:
				"Extractor preference. `auto` uses runtime configuration to choose native or docling.",
		}),
		metadata: z.string().optional().openapi({
			description:
				"Optional JSON object encoded as a string; values must be strings.",
			example: '{"source":"upload"}',
		}),
		chunker: z.string().optional().openapi({
			description:
				"Optional JSON object encoded as a string; overrides chunking for this ingest.",
			example: '{"maxChunkSize":800}',
		}),
		overwriteOnNameConflict: z.enum(["true", "false"]).optional().openapi({
			description:
				"When `true`, replace an existing document with the same source filename.",
		}),
		documentId: z.string().uuid().optional().openapi({
			description: "Optional caller-supplied document id.",
		}),
		sourceDocId: z.string().optional().openapi({
			description: "Optional external source document id.",
		}),
	})
	.openapi("KbIngestFileForm");

export function kbDocumentRoutes(
	deps: KbDocumentRouteDeps,
): OpenAPIHono<AppEnv> {
	const { store, drivers, extractors } = deps;
	const ingestService = createIngestService(deps);
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
				...errorResponse(404, "Workspace or knowledge base not found"),
			},
		}),
		async (c) => {
			const { workspaceId, knowledgeBaseId } = c.req.valid("param");
			const query = c.req.valid("query");
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
				...errorResponse(404, "Workspace or knowledge base not found"),
				...errorResponse(409, "Duplicate documentId within the knowledge base"),
			},
		}),
		async (c) => {
			const { workspaceId, knowledgeBaseId } = c.req.valid("param");
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
				query: AsyncIngestQuerySchema,
				body: {
					content: { "application/json": { schema: KbIngestRequestSchema } },
				},
			},
			responses: {
				200: {
					content: {
						"application/json": { schema: KbIngestNonCreateResponseSchema },
					},
					description:
						"Pipeline did not run; the existing document is returned. Discriminated by `outcome`: `duplicate` when content matches an existing document by SHA-256 hash, `name_conflict` when `sourceFilename` matches but content differs and `overwriteOnNameConflict` was not set. Both sync and async requests collapse to this shape when either condition hits.",
				},
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
				...errorResponse(
					400,
					"Validation, chunker config, or dimension mismatch",
				),
				...errorResponse(404, "Workspace or knowledge base not found"),
			},
		}),
		async (c) => {
			const { workspaceId, knowledgeBaseId } = c.req.valid("param");
			const { async: asyncMode } = c.req.valid("query");
			const body = c.req.valid("json");

			const outcome = await ingestService.ingest(
				workspaceId,
				knowledgeBaseId,
				body,
				{ async: asyncMode === "true" },
			);

			if (outcome.kind === "duplicate") {
				return c.json(
					{ document: outcome.document, outcome: "duplicate" as const },
					200,
				);
			}
			if (outcome.kind === "name_conflict") {
				return c.json(
					{ document: outcome.document, outcome: "name_conflict" as const },
					200,
				);
			}
			if (outcome.kind === "queued") {
				c.header(
					"Location",
					`/api/v1/workspaces/${workspaceId}/jobs/${outcome.job.jobId}`,
				);
				return c.json(
					{
						job: toWireJob(outcome.job),
						document: outcome.document,
						astraQueries: [...outcome.astraQueries],
					},
					202,
				);
			}
			return c.json(
				{
					document: outcome.document,
					chunks: outcome.chunks,
					astraQueries: [...outcome.astraQueries],
				},
				201,
			);
		},
	);

	const ingestFileRoute = createRoute({
		method: "post",
		path: "/{workspaceId}/knowledge-bases/{knowledgeBaseId}/ingest/file",
		tags: ["knowledge-bases"],
		summary: "Ingest a file into a knowledge base",
		description:
			"Accepts a multipart file upload, extracts plain text with the native or docling parser, and feeds the result into the same ingest pipeline as the JSON text route. Response shapes match the JSON ingest endpoint, including duplicate/name-conflict outcomes and async job responses.",
		request: {
			params: z.object({
				workspaceId: WorkspaceIdParamSchema,
				knowledgeBaseId: KnowledgeBaseIdParamSchema,
			}),
			query: AsyncIngestQuerySchema,
			body: {
				required: true,
				content: {
					"multipart/form-data": { schema: KbIngestFileFormSchema },
				},
			},
		},
		responses: {
			200: {
				content: {
					"application/json": { schema: KbIngestNonCreateResponseSchema },
				},
				description:
					"Pipeline did not run; the existing document is returned. Discriminated by `outcome`: `duplicate` when content matches an existing document by SHA-256 hash, `name_conflict` when `sourceFilename` matches but content differs and `overwriteOnNameConflict` was not set.",
			},
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
			...errorResponse(400, "Malformed multipart body or invalid form field"),
			...errorResponse(404, "Workspace or knowledge base not found"),
			...errorResponse(415, "Unsupported file type"),
			...errorResponse(422, "File parsed but could not be extracted"),
			...errorResponse(503, "Configured docling extractor is unavailable"),
		},
	});

	// Register the multipart route in the OpenAPI document while
	// keeping the manual parser below. The validator stack does not
	// model browser `File` fields well enough to preserve our specific
	// multipart error codes, so docs and runtime parsing are separated.
	app.openAPIRegistry.registerPath(ingestFileRoute);
	app.post(
		"/:workspaceId/knowledge-bases/:knowledgeBaseId/ingest/file",
		async (c) => {
			const workspaceId = c.req.param("workspaceId") as string;
			const knowledgeBaseId = c.req.param("knowledgeBaseId") as string;
			const asyncMode = c.req.query("async") === "true";

			let form: FormData;
			try {
				form = await c.req.formData();
			} catch (err) {
				throw new ApiError(
					"invalid_multipart",
					`request body is not a valid multipart/form-data envelope: ${
						err instanceof Error ? err.message : String(err)
					}`,
					400,
				);
			}

			const fileEntry = form.get("file");
			if (!(fileEntry instanceof File)) {
				throw new ApiError(
					"missing_file",
					"multipart request must include a `file` field with the document bytes",
					400,
				);
			}
			if (fileEntry.size === 0) {
				throw new ApiError("empty_file", "uploaded file is empty", 400);
			}

			const parserField = (form.get("parser") as string | null) ?? "auto";
			if (
				parserField !== "auto" &&
				parserField !== "native" &&
				parserField !== "docling"
			) {
				throw new ApiError(
					"invalid_parser",
					`parser must be "auto", "native", or "docling"; got "${parserField}"`,
					400,
				);
			}

			const bytes = new Uint8Array(await fileEntry.arrayBuffer());

			let extracted: Awaited<ReturnType<ExtractorRegistry["extract"]>>;
			try {
				extracted = await extractors.extract(
					{
						bytes,
						filename: fileEntry.name,
						mimeType: (fileEntry.type ?? "").toLowerCase(),
					},
					{ parser: parserField },
				);
			} catch (err) {
				if (err instanceof ExtractError) {
					const status =
						err.code === "unsupported_file_type"
							? 415
							: err.code === "docling_unavailable"
								? 503
								: 422;
					throw new ApiError(err.code, err.message, status);
				}
				throw err;
			}

			const metadataField = form.get("metadata") as string | null;
			let metadata: Record<string, string> | undefined;
			if (metadataField) {
				try {
					const parsed = JSON.parse(metadataField);
					if (
						parsed === null ||
						typeof parsed !== "object" ||
						Array.isArray(parsed)
					) {
						throw new Error("metadata must be a JSON object of strings");
					}
					metadata = {} as Record<string, string>;
					for (const [k, v] of Object.entries(
						parsed as Record<string, unknown>,
					)) {
						if (typeof v !== "string") {
							throw new Error(`metadata field "${k}" must be a string`);
						}
						metadata[k] = v;
					}
				} catch (err) {
					throw new ApiError(
						"invalid_metadata",
						`metadata field is not valid JSON: ${
							err instanceof Error ? err.message : String(err)
						}`,
						400,
					);
				}
			}
			// Stamp the parser provenance into metadata so the UI / audit
			// trail can tell native uploads from docling ones without
			// re-running the dispatcher. Caller-supplied metadata wins
			// only when they didn't reuse the reserved keys.
			metadata = {
				...(metadata ?? {}),
				ingestParser: extracted.parser,
				...(extracted.parserVersion
					? { ingestParserVersion: extracted.parserVersion }
					: {}),
			};

			const chunkerField = form.get("chunker") as string | null;
			let chunker: Record<string, unknown> | undefined;
			if (chunkerField) {
				try {
					const parsed = JSON.parse(chunkerField);
					if (
						parsed === null ||
						typeof parsed !== "object" ||
						Array.isArray(parsed)
					) {
						throw new Error("chunker must be a JSON object");
					}
					chunker = parsed as Record<string, unknown>;
				} catch (err) {
					throw new ApiError(
						"invalid_chunker",
						`chunker field is not valid JSON: ${
							err instanceof Error ? err.message : String(err)
						}`,
						400,
					);
				}
			}

			const overwrite =
				(form.get("overwriteOnNameConflict") as string | null) === "true";
			const documentId = (form.get("documentId") as string | null) ?? undefined;
			const sourceDocId =
				(form.get("sourceDocId") as string | null) ?? undefined;

			const outcome = await ingestService.ingest(
				workspaceId,
				knowledgeBaseId,
				{
					text: extracted.text,
					sourceFilename: fileEntry.name,
					fileType: fileEntry.type || null,
					fileSize: fileEntry.size,
					...(documentId !== undefined && { documentId }),
					...(sourceDocId !== undefined && { sourceDocId }),
					metadata,
					...(chunker !== undefined && { chunker }),
					overwriteOnNameConflict: overwrite,
				},
				{ async: asyncMode },
			);

			if (outcome.kind === "duplicate") {
				return c.json(
					{ document: outcome.document, outcome: "duplicate" as const },
					200,
				);
			}
			if (outcome.kind === "name_conflict") {
				return c.json(
					{ document: outcome.document, outcome: "name_conflict" as const },
					200,
				);
			}
			if (outcome.kind === "queued") {
				c.header(
					"Location",
					`/api/v1/workspaces/${workspaceId}/jobs/${outcome.job.jobId}`,
				);
				return c.json(
					{
						job: toWireJob(outcome.job),
						document: outcome.document,
						astraQueries: [...outcome.astraQueries],
					},
					202,
				);
			}
			return c.json(
				{
					document: outcome.document,
					chunks: outcome.chunks,
					astraQueries: [...outcome.astraQueries],
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
				...errorResponse(
					404,
					"Workspace, knowledge base, or document not found",
				),
				...errorResponse(501, "Driver doesn't support listRecords"),
			},
		}),
		async (c) => {
			const { workspaceId, knowledgeBaseId, documentId } = c.req.valid("param");
			const { limit } = c.req.valid("query");

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
				...errorResponse(
					404,
					"Workspace, knowledge base, or document not found",
				),
			},
		}),
		async (c) => {
			const { workspaceId, knowledgeBaseId, documentId } = c.req.valid("param");
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
				...errorResponse(
					404,
					"Workspace, knowledge base, or document not found",
				),
			},
		}),
		async (c) => {
			const { workspaceId, knowledgeBaseId, documentId } = c.req.valid("param");
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
				...errorResponse(
					404,
					"Workspace, knowledge base, or document not found",
				),
			},
		}),
		async (c) => {
			const { workspaceId, knowledgeBaseId, documentId } = c.req.valid("param");

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
			// and surface in KB-scoped search. Shared with the ingest
			// service's overwrite-on-name-conflict path so both call
			// sites stay in lockstep.
			const resolved = await resolveKb(store, workspaceId, knowledgeBaseId);
			const { deleted } = await cascadeDeleteRagDocument({
				store,
				drivers,
				workspace: resolved.workspace,
				knowledgeBase: resolved.knowledgeBase,
				descriptor: resolved.descriptor,
				documentId,
			});
			if (!deleted) {
				throw new ControlPlaneNotFoundError("document", documentId);
			}
			audit(c, {
				action: "document.delete",
				outcome: "success",
				workspaceId,
				details: { knowledgeBaseId, documentId },
			});
			return c.body(null, 204);
		},
	);

	return app;
}
