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
import { getRequestPrincipal } from "../../auth/principal-resolver.js";
import { ControlPlaneNotFoundError } from "../../control-plane/errors.js";
import type { ControlPlaneStore } from "../../control-plane/store.js";
import type { RagDocumentRecord } from "../../control-plane/types.js";
import type { VectorStoreDriverRegistry } from "../../drivers/registry.js";
import type { EmbedderFactory } from "../../embeddings/factory.js";
import type { ExtractorRegistry } from "../../ingest/extractors/index.js";
import {
	CHUNK_INDEX_KEY,
	CHUNK_TEXT_KEY,
	DOCUMENT_SCOPE_KEY,
	KB_SCOPE_KEY,
} from "../../ingest/payload-keys.js";
import type { JobStore } from "../../jobs/store.js";
import { audit } from "../../lib/audit.js";
import { applyDataApiFilterInMemory } from "../../lib/data-api-filter.js";
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
import {
	assertPolicyAllowsMutation,
	buildPolicyContext,
	PolicyDeniedError,
} from "../../policy/enforcer.js";
import { cascadeDeleteRagDocument } from "../../services/document-cascade.js";
import { createIngestService } from "../../services/ingest-service.js";
import { parseIngestFileForm } from "./ingest-file-form.js";
import { resolveKb } from "./kb-descriptor.js";
import { resolveRlacDefaults } from "./rlac-defaults.js";
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
		visibleTo: z.string().optional().openapi({
			description:
				'RLAC: JSON-encoded array of principal ids (or `"*"`) authorized to read this document. Defaults to `[caller_principal]` when policy is enabled on the KB and the field is omitted.',
			example: '["alice","bob"]',
		}),
		ownerPrincipalId: z.string().optional().openapi({
			description:
				"RLAC: provenance only. Defaults to the caller's principal id.",
		}),
	})
	.openapi("KbIngestFileForm");

/**
 * RLAC: apply the compiled filter returned by the enforcer to an
 * in-memory list of rag documents. Delegates to the shared Data API
 * filter interpreter ({@link applyDataApiFilterInMemory}) so this path
 * filters identically to the mock vector driver and to Astra's
 * server-side evaluation — one interpreter, no drift.
 *
 * The compiler emits snake_case column names (`visible_to`,
 * `owner_principal_id`); control-plane rows are camelCase, so each row is
 * projected across the two before matching. A null `visibleTo` (hidden,
 * admin-only) projects to an empty set — invisible to non-admins, while
 * the admin-bypass MATCH_ALL filter still returns every row.
 */
function applyVisibleToFilter(
	docs: readonly RagDocumentRecord[],
	filter: Readonly<Record<string, unknown>> | null,
): readonly RagDocumentRecord[] {
	return applyDataApiFilterInMemory(docs, filter, (d) => ({
		visible_to: d.visibleTo ?? [],
		owner_principal_id: d.ownerPrincipalId ?? null,
	}));
}

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
			// RLAC: apply the KB's policy filter when enabled. The
			// enforcer also writes the audit record and returns the
			// compiled filter for in-memory application.
			const kb = await store.getKnowledgeBase(workspaceId, knowledgeBaseId);
			if (!kb)
				throw new ControlPlaneNotFoundError("knowledge base", knowledgeBaseId);
			const ws = await store.getWorkspace(workspaceId);
			let filtered: readonly RagDocumentRecord[];
			try {
				const decision = await buildPolicyContext({
					workspace: workspaceId,
					workspaceRlacEnabled: ws?.rlacEnabled ?? false,
					knowledgeBase: kb,
					principal: getRequestPrincipal(c),
					action: "list",
					resourceId: "*",
					audit: store,
				});
				filtered = applyVisibleToFilter(rows, decision.filter);
			} catch (err) {
				if (err instanceof PolicyDeniedError) {
					throw new ApiError("policy_principal_required", err.reason, 401);
				}
				throw err;
			}
			return c.json(paginate(filtered, query), 200);
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
			// RLAC: when the workspace toggle is on and the caller didn't
			// supply `visibleTo`, default to the caller's principal so
			// the doc is visible to them (and only them) by default. When
			// the workspace toggle is off, leave the column untouched —
			// legacy behavior.
			const kb = await store.getKnowledgeBase(workspaceId, knowledgeBaseId);
			if (!kb)
				throw new ControlPlaneNotFoundError("knowledge base", knowledgeBaseId);
			const ws = await store.getWorkspace(workspaceId);
			const principal = getRequestPrincipal(c);
			const defaults = resolveRlacDefaults(
				ws?.rlacEnabled ?? false,
				principal,
				{
					visibleTo: body.visibleTo,
					ownerPrincipalId: body.ownerPrincipalId,
				},
			);
			const record = await store.createRagDocument(
				workspaceId,
				knowledgeBaseId,
				{
					...body,
					...(defaults.visibleTo != null && {
						visibleTo: [...defaults.visibleTo],
					}),
					...(defaults.ownerPrincipalId !== undefined && {
						ownerPrincipalId: defaults.ownerPrincipalId,
					}),
					uid: body.documentId,
				},
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

			// RLAC: when the workspace toggle is on and the caller didn't
			// supply visibleTo, default to `[principalId]` so the newly
			// ingested doc is visible to its creator. Same defaulting
			// rule as the create-stub-document route just above; kept
			// here too so the live ingest path matches.
			const kb = await store.getKnowledgeBase(workspaceId, knowledgeBaseId);
			if (!kb)
				throw new ControlPlaneNotFoundError("knowledge base", knowledgeBaseId);
			const ws = await store.getWorkspace(workspaceId);
			const principal = getRequestPrincipal(c);
			const defaults = resolveRlacDefaults(
				ws?.rlacEnabled ?? false,
				principal,
				{
					visibleTo: body.visibleTo,
					ownerPrincipalId: body.ownerPrincipalId,
				},
			);

			const outcome = await ingestService.ingest(
				workspaceId,
				knowledgeBaseId,
				{
					...body,
					...(defaults.visibleTo != null && {
						visibleTo: [...defaults.visibleTo],
					}),
					...(defaults.ownerPrincipalId !== undefined && {
						ownerPrincipalId: defaults.ownerPrincipalId,
					}),
				},
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

			const parsed = await parseIngestFileForm(form, extractors);

			// RLAC defaulting: match the kb-documents text-ingest route.
			const kbForRlac = await store.getKnowledgeBase(
				workspaceId,
				knowledgeBaseId,
			);
			if (!kbForRlac)
				throw new ControlPlaneNotFoundError("knowledge base", knowledgeBaseId);
			const wsForRlac = await store.getWorkspace(workspaceId);
			const principal = getRequestPrincipal(c);
			const defaults = resolveRlacDefaults(
				wsForRlac?.rlacEnabled ?? false,
				principal,
				{
					visibleTo: parsed.callerVisibleTo,
					ownerPrincipalId: parsed.ownerPrincipalId,
				},
			);

			const outcome = await ingestService.ingest(
				workspaceId,
				knowledgeBaseId,
				{
					text: parsed.text,
					sourceFilename: parsed.sourceFilename,
					fileType: parsed.fileType,
					fileSize: parsed.fileSize,
					...(parsed.documentId !== undefined && {
						documentId: parsed.documentId,
					}),
					...(parsed.sourceDocId !== undefined && {
						sourceDocId: parsed.sourceDocId,
					}),
					metadata: parsed.metadata,
					...(parsed.chunker !== undefined && { chunker: parsed.chunker }),
					overwriteOnNameConflict: parsed.overwriteOnNameConflict,
					...(defaults.visibleTo != null && {
						visibleTo: [...defaults.visibleTo],
					}),
					...(defaults.ownerPrincipalId !== undefined && {
						ownerPrincipalId: defaults.ownerPrincipalId,
					}),
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
			// RLAC: a caller who can't see the parent document can't read
			// its chunks either. 404 to match the document-get path (the
			// row "doesn't exist" to them); emits an audit record either way.
			try {
				const decision = await buildPolicyContext({
					workspace: workspaceId,
					workspaceRlacEnabled: resolved.workspace.rlacEnabled,
					knowledgeBase: resolved.knowledgeBase,
					principal: getRequestPrincipal(c),
					action: "get",
					resourceId: documentId,
					audit: store,
				});
				if (applyVisibleToFilter([doc], decision.filter).length === 0) {
					throw new ControlPlaneNotFoundError("document", documentId);
				}
			} catch (err) {
				if (err instanceof PolicyDeniedError) {
					throw new ApiError("policy_principal_required", err.reason, 401);
				}
				throw err;
			}
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
			// RLAC: 404 the document when the principal cannot see it
			// (Postgres-style semantics — the row "doesn't exist" to the
			// caller). Emits an audit record either way.
			const kb = await store.getKnowledgeBase(workspaceId, knowledgeBaseId);
			if (!kb)
				throw new ControlPlaneNotFoundError("knowledge base", knowledgeBaseId);
			const ws = await store.getWorkspace(workspaceId);
			try {
				const decision = await buildPolicyContext({
					workspace: workspaceId,
					workspaceRlacEnabled: ws?.rlacEnabled ?? false,
					knowledgeBase: kb,
					principal: getRequestPrincipal(c),
					action: "get",
					resourceId: documentId,
					audit: store,
				});
				const visible = applyVisibleToFilter([record], decision.filter);
				if (visible.length === 0) {
					throw new ControlPlaneNotFoundError("document", documentId);
				}
			} catch (err) {
				if (err instanceof PolicyDeniedError) {
					throw new ApiError("policy_principal_required", err.reason, 401);
				}
				throw err;
			}
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
			const existing = await store.getRagDocument(
				workspaceId,
				knowledgeBaseId,
				documentId,
			);
			if (!existing)
				throw new ControlPlaneNotFoundError("document", documentId);
			// RLAC: only let the caller patch a doc they can see.
			const kbForPatch = await store.getKnowledgeBase(
				workspaceId,
				knowledgeBaseId,
			);
			if (!kbForPatch)
				throw new ControlPlaneNotFoundError("knowledge base", knowledgeBaseId);
			const wsForPatch = await store.getWorkspace(workspaceId);
			try {
				await assertPolicyAllowsMutation({
					workspace: workspaceId,
					workspaceRlacEnabled: wsForPatch?.rlacEnabled ?? false,
					knowledgeBase: kbForPatch,
					principal: getRequestPrincipal(c),
					action: "update",
					document: existing,
					audit: store,
				});
			} catch (err) {
				if (err instanceof PolicyDeniedError) {
					throw new ApiError("policy_denied", err.reason, 403);
				}
				throw err;
			}
			const record = await store.updateRagDocument(
				workspaceId,
				knowledgeBaseId,
				documentId,
				body,
			);
			// RLAC: when the caller changed `visibleTo`, re-stamp the
			// document's chunks so the data plane stays in sync with the
			// row (the pushed-down policy filter matches on chunk
			// `visible_to`). Skipped when the driver can't bulk-update.
			if (body.visibleTo !== undefined) {
				const resolved = await resolveKb(store, workspaceId, knowledgeBaseId);
				const driver = drivers.for(resolved.workspace);
				if (typeof driver.setRecordsVisibility === "function") {
					await driver.setRecordsVisibility(
						{ workspace: resolved.workspace, descriptor: resolved.descriptor },
						{
							[KB_SCOPE_KEY]: knowledgeBaseId,
							[DOCUMENT_SCOPE_KEY]: documentId,
						},
						record.visibleTo,
					);
				}
			}
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

			// RLAC: deny the delete if the caller's principal can't see
			// the row. Mirrors the read-path 404 — write-path is louder
			// (403) because the caller has a documentId in hand.
			const kbForDelete = await store.getKnowledgeBase(
				workspaceId,
				knowledgeBaseId,
			);
			if (!kbForDelete)
				throw new ControlPlaneNotFoundError("knowledge base", knowledgeBaseId);
			const wsForDelete = await store.getWorkspace(workspaceId);
			try {
				await assertPolicyAllowsMutation({
					workspace: workspaceId,
					workspaceRlacEnabled: wsForDelete?.rlacEnabled ?? false,
					knowledgeBase: kbForDelete,
					principal: getRequestPrincipal(c),
					action: "delete",
					document: existing,
					audit: store,
				});
			} catch (err) {
				if (err instanceof PolicyDeniedError) {
					throw new ApiError("policy_denied", err.reason, 403);
				}
				throw err;
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
