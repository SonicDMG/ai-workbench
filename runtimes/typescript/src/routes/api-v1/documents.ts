/**
 * `/api/v1/workspaces/{workspaceUid}/catalogs/{catalogUid}/documents`
 * and `.../ingest` — document metadata CRUD, catalog-scoped search,
 * and end-to-end ingest.
 *
 * Content changes flow through `POST .../ingest`: chunk the input,
 * embed each chunk, upsert into the catalog's bound vector store, and
 * create a Document row with `status: ready`. `PUT .../documents/{documentUid}`
 * continues to update metadata only.
 *
 * Both parent UIDs are enforced in every path; the store raises
 * `ControlPlaneNotFoundError("workspace" | "catalog", uid)` before the
 * document layer is consulted, which the global error mapper turns into
 * `workspace_not_found` / `catalog_not_found` 404s.
 *
 * Catalog-scoped search (`POST .../documents/search`) delegates to the
 * catalog's bound vector store. The catalog's UID is merged into the
 * caller's `filter` as `catalogUid`; a caller-supplied `catalogUid`
 * cannot override it — the catalog's own UID always wins so a search
 * can never escape its scope. Ingest is the writer that stamps that
 * key (plus `documentUid` and `chunkIndex`) on every chunk payload.
 */

import { createRoute, type OpenAPIHono, z } from "@hono/zod-openapi";
import { assertWorkspaceAccess } from "../../auth/authz.js";
import { ControlPlaneNotFoundError } from "../../control-plane/errors.js";
import type { ControlPlaneStore } from "../../control-plane/store.js";
import type { VectorStoreDriverRegistry } from "../../drivers/registry.js";
import type { EmbedderFactory } from "../../embeddings/factory.js";
import {
	CATALOG_SCOPE_KEY,
	CHUNK_INDEX_KEY,
	CHUNK_TEXT_KEY,
	DOCUMENT_SCOPE_KEY,
} from "../../ingest/payload-keys.js";
import { runIngest } from "../../ingest/pipeline.js";
import { runIngestJob } from "../../jobs/ingest-worker.js";
import type { JobStore } from "../../jobs/store.js";
import type { IngestInputSnapshot } from "../../jobs/types.js";
import { ApiError } from "../../lib/errors.js";
import { makeOpenApi } from "../../lib/openapi.js";
import { paginate } from "../../lib/pagination.js";
import type { AppEnv } from "../../lib/types.js";
import {
	AsyncIngestResponseSchema,
	CatalogUidParamSchema,
	CreateDocumentInputSchema,
	DocumentChunkSchema,
	DocumentPageSchema,
	DocumentRecordSchema,
	DocumentUidParamSchema,
	ErrorEnvelopeSchema,
	IngestRequestSchema,
	IngestResponseSchema,
	PaginationQuerySchema,
	SearchHitSchema,
	SearchRequestSchema,
	UpdateDocumentInputSchema,
	WorkspaceUidParamSchema,
} from "../../openapi/schemas.js";
import { dispatchSearch, toMutableHits } from "./search-dispatch.js";

export interface DocumentRouteDeps {
	readonly store: ControlPlaneStore;
	readonly drivers: VectorStoreDriverRegistry;
	readonly embedders: EmbedderFactory;
	/** Required — the async-ingest path persists progress through it. */
	readonly jobs: JobStore;
	/** Identifier this replica writes into job leases. Set by the
	 * runtime at boot from `runtime.replicaId` (or auto-generated
	 * `${HOSTNAME}-<short-uuid>` when null). */
	readonly replicaId: string;
}

// `CATALOG_SCOPE_KEY`, `DOCUMENT_SCOPE_KEY`, and `CHUNK_INDEX_KEY`
// moved to `src/ingest/payload-keys.ts`. Re-exported here so existing
// consumers (including the saved-queries route and downstream code)
// keep working without a file-by-file path update.
export {
	CATALOG_SCOPE_KEY,
	CHUNK_INDEX_KEY,
	DOCUMENT_SCOPE_KEY,
} from "../../ingest/payload-keys.js";

export function documentRoutes(deps: DocumentRouteDeps): OpenAPIHono<AppEnv> {
	const { store, drivers, embedders, jobs, replicaId } = deps;
	const app = makeOpenApi();

	app.openapi(
		createRoute({
			method: "get",
			path: "/{workspaceUid}/catalogs/{catalogUid}/documents",
			tags: ["documents"],
			summary: "List documents in a catalog",
			request: {
				params: z.object({
					workspaceUid: WorkspaceUidParamSchema,
					catalogUid: CatalogUidParamSchema,
				}),
				query: PaginationQuerySchema,
			},
			responses: {
				200: {
					content: {
						"application/json": { schema: DocumentPageSchema },
					},
					description: "All documents in the catalog",
				},
				404: {
					content: { "application/json": { schema: ErrorEnvelopeSchema } },
					description: "Workspace or catalog not found",
				},
			},
		}),
		async (c) => {
			const { workspaceUid, catalogUid } = c.req.valid("param");
			const query = c.req.valid("query");
			assertWorkspaceAccess(c, workspaceUid);
			const rows = await store.listDocuments(workspaceUid, catalogUid);
			return c.json(paginate(rows, query), 200);
		},
	);

	app.openapi(
		createRoute({
			method: "post",
			path: "/{workspaceUid}/catalogs/{catalogUid}/documents",
			tags: ["documents"],
			summary: "Register a document in a catalog",
			request: {
				params: z.object({
					workspaceUid: WorkspaceUidParamSchema,
					catalogUid: CatalogUidParamSchema,
				}),
				body: {
					content: {
						"application/json": { schema: CreateDocumentInputSchema },
					},
				},
			},
			responses: {
				201: {
					content: { "application/json": { schema: DocumentRecordSchema } },
					description: "Document created",
				},
				404: {
					content: { "application/json": { schema: ErrorEnvelopeSchema } },
					description: "Workspace or catalog not found",
				},
				409: {
					content: { "application/json": { schema: ErrorEnvelopeSchema } },
					description: "Duplicate uid within the catalog",
				},
			},
		}),
		async (c) => {
			const { workspaceUid, catalogUid } = c.req.valid("param");
			assertWorkspaceAccess(c, workspaceUid);
			const body = c.req.valid("json");
			const record = await store.createDocument(workspaceUid, catalogUid, body);
			return c.json(record, 201);
		},
	);

	app.openapi(
		createRoute({
			method: "post",
			path: "/{workspaceUid}/catalogs/{catalogUid}/ingest",
			tags: ["documents"],
			summary: "Ingest a document: chunk, embed, upsert",
			description:
				"Chunks `text`, embeds each chunk (server-side via `$vectorize` when the bound store supports it, otherwise client-side), and upserts into the catalog's bound vector store. Creates a Document metadata row; failures mark it `status: failed` with `errorMessage`. With `?async=true` the request returns 202 with a `job` pointer instead — the pipeline runs in the background and the document status plus the job's `processed`/`total`/`status` fields track progress. Clients poll `GET /jobs/{jobId}` or stream `GET /jobs/{jobId}/events`.",
			request: {
				params: z.object({
					workspaceUid: WorkspaceUidParamSchema,
					catalogUid: CatalogUidParamSchema,
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
					content: { "application/json": { schema: IngestRequestSchema } },
				},
			},
			responses: {
				201: {
					content: { "application/json": { schema: IngestResponseSchema } },
					description: "Document created and chunks upserted (sync path)",
				},
				202: {
					content: {
						"application/json": { schema: AsyncIngestResponseSchema },
					},
					description: "Ingest queued; poll the job for progress",
				},
				400: {
					content: { "application/json": { schema: ErrorEnvelopeSchema } },
					description:
						"Validation, chunker config, or embedding dimension mismatch",
				},
				404: {
					content: { "application/json": { schema: ErrorEnvelopeSchema } },
					description: "Workspace, catalog, or bound vector store not found",
				},
				409: {
					content: { "application/json": { schema: ErrorEnvelopeSchema } },
					description: "Catalog has no vector store binding",
				},
			},
		}),
		async (c) => {
			const { workspaceUid, catalogUid } = c.req.valid("param");
			const { async: asyncMode } = c.req.valid("query");
			assertWorkspaceAccess(c, workspaceUid);
			const body = c.req.valid("json");

			const workspace = await store.getWorkspace(workspaceUid);
			if (!workspace) {
				throw new ControlPlaneNotFoundError("workspace", workspaceUid);
			}
			const catalog = await store.getCatalog(workspaceUid, catalogUid);
			if (!catalog) throw new ControlPlaneNotFoundError("catalog", catalogUid);
			if (!catalog.vectorStore) {
				throw new ApiError(
					"catalog_not_bound_to_vector_store",
					`catalog '${catalogUid}' has no vectorStore binding; bind one with PUT /catalogs/{catalogUid} before ingesting`,
					409,
				);
			}
			const descriptor = await store.getVectorStore(
				workspaceUid,
				catalog.vectorStore,
			);
			if (!descriptor) {
				throw new ControlPlaneNotFoundError(
					"vector store",
					catalog.vectorStore,
				);
			}

			// Document row goes in first regardless of async mode — both
			// paths need a durable anchor for status tracking.
			const document = await store.createDocument(workspaceUid, catalogUid, {
				uid: body.uid,
				sourceDocId: body.sourceDocId,
				sourceFilename: body.sourceFilename,
				fileType: body.fileType,
				fileSize: body.fileSize,
				md5Hash: body.md5Hash,
				status: "writing",
				metadata: body.metadata,
			});

			const ingestCtx = {
				workspace,
				catalog,
				descriptor,
				documentUid: document.documentUid,
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
					workspace: workspaceUid,
					kind: "ingest",
					catalogUid: catalogUid,
					documentUid: document.documentUid,
					ingestInput: ingestSnapshot,
				});
				// Detached execution — route returns immediately with 202.
				// Errors are captured into the job record; no thrown
				// promise escapes the runtime. Same shared worker the
				// orphan-sweeper uses on resume.
				void runIngestJob({
					deps: { store, drivers, embedders, jobs },
					workspaceUid,
					jobId: job.jobId,
					replicaId,
					input: body,
				});
				return c.json({ job, document }, 202);
			}

			// Sync path.
			const result = await runIngest(
				{ store, drivers, embedders },
				ingestCtx,
				body,
			);
			const ready = await store.getDocument(
				workspaceUid,
				catalogUid,
				document.documentUid,
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
			method: "post",
			path: "/{workspaceUid}/catalogs/{catalogUid}/documents/search",
			tags: ["documents"],
			summary: "Search documents in a catalog",
			description:
				"Delegates to the catalog's bound vector store, merging the catalog UID into the search filter as `catalogUid`. Records without a matching `catalogUid` in their payload are invisible. Caller-supplied `catalogUid` in `filter` is ignored — the path's catalog always wins. `409 catalog_not_bound_to_vector_store` if the catalog has no `vectorStore` binding.",
			request: {
				params: z.object({
					workspaceUid: WorkspaceUidParamSchema,
					catalogUid: CatalogUidParamSchema,
				}),
				body: {
					content: { "application/json": { schema: SearchRequestSchema } },
				},
			},
			responses: {
				200: {
					content: {
						"application/json": { schema: z.array(SearchHitSchema) },
					},
					description: "Matching hits, highest score first",
				},
				400: {
					content: { "application/json": { schema: ErrorEnvelopeSchema } },
					description: "Dimension mismatch or malformed request",
				},
				404: {
					content: { "application/json": { schema: ErrorEnvelopeSchema } },
					description: "Workspace, catalog, or bound vector store not found",
				},
				409: {
					content: { "application/json": { schema: ErrorEnvelopeSchema } },
					description: "Catalog has no vector store binding",
				},
			},
		}),
		async (c) => {
			const { workspaceUid, catalogUid } = c.req.valid("param");
			assertWorkspaceAccess(c, workspaceUid);
			const body = c.req.valid("json");

			const workspace = await store.getWorkspace(workspaceUid);
			if (!workspace) {
				throw new ControlPlaneNotFoundError("workspace", workspaceUid);
			}
			const catalog = await store.getCatalog(workspaceUid, catalogUid);
			if (!catalog) throw new ControlPlaneNotFoundError("catalog", catalogUid);
			if (!catalog.vectorStore) {
				throw new ApiError(
					"catalog_not_bound_to_vector_store",
					`catalog '${catalogUid}' has no vectorStore binding; bind one with PUT /catalogs/{catalogUid} before searching`,
					409,
				);
			}
			const descriptor = await store.getVectorStore(
				workspaceUid,
				catalog.vectorStore,
			);
			if (!descriptor) {
				// The catalog points at a vector store that no longer
				// exists. `assertVectorStoreNotReferenced` in the
				// vector-store delete path should have blocked this, but
				// some backends still allow a racy window. Surface as 404
				// so the caller knows the binding is stale.
				throw new ControlPlaneNotFoundError(
					"vector store",
					catalog.vectorStore,
				);
			}

			const driver = drivers.for(workspace);
			const ctx = { workspace, descriptor };
			const scopedFilter = {
				...(body.filter ?? {}),
				[CATALOG_SCOPE_KEY]: catalog.uid,
			};
			const hits = await dispatchSearch({
				ctx,
				driver,
				embedders,
				body: { ...body, filter: scopedFilter },
			});
			return c.json(toMutableHits(hits), 200);
		},
	);

	app.openapi(
		createRoute({
			method: "get",
			path: "/{workspaceUid}/catalogs/{catalogUid}/documents/{documentUid}/chunks",
			tags: ["documents"],
			summary: "List the chunks under a document",
			description:
				"Reads raw records out of the catalog's bound vector store filtered to this document, returns them sorted by `chunkIndex`. Text comes from the reserved `chunkText` payload key the ingest pipeline stamps. Drivers without `listRecords` (none today, but the contract is optional) return 501.",
			request: {
				params: z.object({
					workspaceUid: WorkspaceUidParamSchema,
					catalogUid: CatalogUidParamSchema,
					documentUid: DocumentUidParamSchema,
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
					description:
						"Workspace, catalog, document, or bound vector store not found",
				},
				409: {
					content: { "application/json": { schema: ErrorEnvelopeSchema } },
					description: "Catalog has no vector store binding",
				},
				501: {
					content: { "application/json": { schema: ErrorEnvelopeSchema } },
					description: "Driver doesn't support listRecords",
				},
			},
		}),
		async (c) => {
			const { workspaceUid, catalogUid, documentUid } = c.req.valid("param");
			const { limit } = c.req.valid("query");
			assertWorkspaceAccess(c, workspaceUid);

			const workspace = await store.getWorkspace(workspaceUid);
			if (!workspace) {
				throw new ControlPlaneNotFoundError("workspace", workspaceUid);
			}
			const catalog = await store.getCatalog(workspaceUid, catalogUid);
			if (!catalog) throw new ControlPlaneNotFoundError("catalog", catalogUid);
			const doc = await store.getDocument(
				workspaceUid,
				catalogUid,
				documentUid,
			);
			if (!doc) throw new ControlPlaneNotFoundError("document", documentUid);
			if (!catalog.vectorStore) {
				throw new ApiError(
					"catalog_not_bound_to_vector_store",
					`catalog '${catalogUid}' has no vectorStore binding`,
					409,
				);
			}
			const descriptor = await store.getVectorStore(
				workspaceUid,
				catalog.vectorStore,
			);
			if (!descriptor) {
				throw new ControlPlaneNotFoundError(
					"vector store",
					catalog.vectorStore,
				);
			}

			const driver = drivers.for(workspace);
			if (typeof driver.listRecords !== "function") {
				throw new ApiError(
					"list_records_not_supported",
					`driver for workspace kind '${workspace.kind}' doesn't support listRecords`,
					501,
				);
			}

			const records = await driver.listRecords(
				{ workspace, descriptor },
				{
					filter: {
						[CATALOG_SCOPE_KEY]: catalog.uid,
						[DOCUMENT_SCOPE_KEY]: doc.documentUid,
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
					// Null indexes sink to the end so they don't shuffle the
					// known-ordered chunks. Stable across equal indexes.
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
			path: "/{workspaceUid}/catalogs/{catalogUid}/documents/{documentUid}",
			tags: ["documents"],
			summary: "Get a document",
			request: {
				params: z.object({
					workspaceUid: WorkspaceUidParamSchema,
					catalogUid: CatalogUidParamSchema,
					documentUid: DocumentUidParamSchema,
				}),
			},
			responses: {
				200: {
					content: { "application/json": { schema: DocumentRecordSchema } },
					description: "Document",
				},
				404: {
					content: { "application/json": { schema: ErrorEnvelopeSchema } },
					description: "Workspace, catalog, or document not found",
				},
			},
		}),
		async (c) => {
			const { workspaceUid, catalogUid, documentUid } = c.req.valid("param");
			assertWorkspaceAccess(c, workspaceUid);
			const record = await store.getDocument(
				workspaceUid,
				catalogUid,
				documentUid,
			);
			if (!record) throw new ControlPlaneNotFoundError("document", documentUid);
			return c.json(record, 200);
		},
	);

	app.openapi(
		createRoute({
			method: "put",
			path: "/{workspaceUid}/catalogs/{catalogUid}/documents/{documentUid}",
			tags: ["documents"],
			summary: "Update document metadata",
			request: {
				params: z.object({
					workspaceUid: WorkspaceUidParamSchema,
					catalogUid: CatalogUidParamSchema,
					documentUid: DocumentUidParamSchema,
				}),
				body: {
					content: {
						"application/json": { schema: UpdateDocumentInputSchema },
					},
				},
			},
			responses: {
				200: {
					content: { "application/json": { schema: DocumentRecordSchema } },
					description: "Updated document",
				},
				404: {
					content: { "application/json": { schema: ErrorEnvelopeSchema } },
					description: "Workspace, catalog, or document not found",
				},
			},
		}),
		async (c) => {
			const { workspaceUid, catalogUid, documentUid } = c.req.valid("param");
			assertWorkspaceAccess(c, workspaceUid);
			const body = c.req.valid("json");
			const record = await store.updateDocument(
				workspaceUid,
				catalogUid,
				documentUid,
				body,
			);
			return c.json(record, 200);
		},
	);

	app.openapi(
		createRoute({
			method: "delete",
			path: "/{workspaceUid}/catalogs/{catalogUid}/documents/{documentUid}",
			tags: ["documents"],
			summary: "Delete a document",
			request: {
				params: z.object({
					workspaceUid: WorkspaceUidParamSchema,
					catalogUid: CatalogUidParamSchema,
					documentUid: DocumentUidParamSchema,
				}),
			},
			responses: {
				204: { description: "Deleted" },
				404: {
					content: { "application/json": { schema: ErrorEnvelopeSchema } },
					description: "Workspace, catalog, or document not found",
				},
			},
		}),
		async (c) => {
			const { workspaceUid, catalogUid, documentUid } = c.req.valid("param");
			assertWorkspaceAccess(c, workspaceUid);

			// Cascade chunks first — the bound vector store still
			// indexes the document's chunks even after we drop the
			// Document row, so without this they'd orphan and surface
			// in catalog-scoped search forever. Chunk delete failures
			// abort the document delete so the user can retry without
			// half-state. Drivers without `deleteRecords` fall back to
			// a `listRecords` + per-id loop. Catalogs with no
			// vector-store binding skip the cascade entirely.
			const workspace = await store.getWorkspace(workspaceUid);
			if (!workspace) {
				throw new ControlPlaneNotFoundError("workspace", workspaceUid);
			}
			const catalog = await store.getCatalog(workspaceUid, catalogUid);
			if (!catalog) throw new ControlPlaneNotFoundError("catalog", catalogUid);
			const existing = await store.getDocument(
				workspaceUid,
				catalogUid,
				documentUid,
			);
			if (!existing) {
				throw new ControlPlaneNotFoundError("document", documentUid);
			}
			if (catalog.vectorStore) {
				const descriptor = await store.getVectorStore(
					workspaceUid,
					catalog.vectorStore,
				);
				if (descriptor) {
					const driver = drivers.for(workspace);
					const filter = {
						[CATALOG_SCOPE_KEY]: catalog.uid,
						[DOCUMENT_SCOPE_KEY]: existing.documentUid,
					};
					if (typeof driver.deleteRecords === "function") {
						await driver.deleteRecords({ workspace, descriptor }, filter);
					} else if (typeof driver.listRecords === "function") {
						const rows = await driver.listRecords(
							{ workspace, descriptor },
							{ filter, limit: 1000 },
						);
						for (const r of rows) {
							await driver.deleteRecord({ workspace, descriptor }, r.id);
						}
					}
					// Drivers exposing neither leave chunks behind. The
					// next catalog-delete cleans them up; we don't block
					// the user on that here.
				}
			}

			const { deleted } = await store.deleteDocument(
				workspaceUid,
				catalogUid,
				documentUid,
			);
			if (!deleted)
				throw new ControlPlaneNotFoundError("document", documentUid);
			return c.body(null, 204);
		},
	);

	return app;
}
