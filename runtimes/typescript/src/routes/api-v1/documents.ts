/**
 * `/api/v1/workspaces/{workspaceId}/catalogs/{catalogId}/documents`
 * — document metadata CRUD + catalog-scoped search.
 *
 * `PUT` updates metadata only. Content changes (re-chunk, re-embed) flow
 * through the Phase 2b ingest pipeline once it lands.
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
 * can never escape its scope.
 */

import { createRoute, type OpenAPIHono, z } from "@hono/zod-openapi";
import { assertWorkspaceAccess } from "../../auth/authz.js";
import { ControlPlaneNotFoundError } from "../../control-plane/errors.js";
import type { ControlPlaneStore } from "../../control-plane/store.js";
import type { VectorStoreDriverRegistry } from "../../drivers/registry.js";
import type { EmbedderFactory } from "../../embeddings/factory.js";
import { ApiError } from "../../lib/errors.js";
import { makeOpenApi } from "../../lib/openapi.js";
import type { AppEnv } from "../../lib/types.js";
import {
	CatalogIdParamSchema,
	CreateDocumentInputSchema,
	DocumentIdParamSchema,
	DocumentRecordSchema,
	ErrorEnvelopeSchema,
	SearchHitSchema,
	SearchRequestSchema,
	UpdateDocumentInputSchema,
	WorkspaceIdParamSchema,
} from "../../openapi/schemas.js";
import { dispatchSearch, toMutableHits } from "./search-dispatch.js";

export interface DocumentRouteDeps {
	readonly store: ControlPlaneStore;
	readonly drivers: VectorStoreDriverRegistry;
	readonly embedders: EmbedderFactory;
}

/**
 * Payload key that carries the catalog UID on every record written by
 * the ingest pipeline. The search route merges `{ [CATALOG_SCOPE_KEY]:
 * catalog.uid }` into the caller's filter so results stay within the
 * catalog. Keep the value in sync with the ingest writer when 2b
 * lands — the contract is one reserved key per shipped route.
 */
export const CATALOG_SCOPE_KEY = "catalogUid";

export function documentRoutes(deps: DocumentRouteDeps): OpenAPIHono<AppEnv> {
	const { store, drivers, embedders } = deps;
	const app = makeOpenApi();

	app.openapi(
		createRoute({
			method: "get",
			path: "/{workspaceId}/catalogs/{catalogId}/documents",
			tags: ["documents"],
			summary: "List documents in a catalog",
			request: {
				params: z.object({
					workspaceId: WorkspaceIdParamSchema,
					catalogId: CatalogIdParamSchema,
				}),
			},
			responses: {
				200: {
					content: {
						"application/json": { schema: z.array(DocumentRecordSchema) },
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
			const { workspaceId, catalogId } = c.req.valid("param");
			assertWorkspaceAccess(c, workspaceId);
			const rows = await store.listDocuments(workspaceId, catalogId);
			return c.json([...rows], 200);
		},
	);

	app.openapi(
		createRoute({
			method: "post",
			path: "/{workspaceId}/catalogs/{catalogId}/documents",
			tags: ["documents"],
			summary: "Register a document in a catalog",
			request: {
				params: z.object({
					workspaceId: WorkspaceIdParamSchema,
					catalogId: CatalogIdParamSchema,
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
			const { workspaceId, catalogId } = c.req.valid("param");
			assertWorkspaceAccess(c, workspaceId);
			const body = c.req.valid("json");
			const record = await store.createDocument(workspaceId, catalogId, body);
			return c.json(record, 201);
		},
	);

	app.openapi(
		createRoute({
			method: "post",
			path: "/{workspaceId}/catalogs/{catalogId}/documents/search",
			tags: ["documents"],
			summary: "Search documents in a catalog",
			description:
				"Delegates to the catalog's bound vector store, merging the catalog UID into the search filter as `catalogUid`. Records without a matching `catalogUid` in their payload are invisible. Caller-supplied `catalogUid` in `filter` is ignored — the path's catalog always wins. `409 catalog_not_bound_to_vector_store` if the catalog has no `vectorStore` binding.",
			request: {
				params: z.object({
					workspaceId: WorkspaceIdParamSchema,
					catalogId: CatalogIdParamSchema,
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
			const { workspaceId, catalogId } = c.req.valid("param");
			assertWorkspaceAccess(c, workspaceId);
			const body = c.req.valid("json");

			const workspace = await store.getWorkspace(workspaceId);
			if (!workspace) {
				throw new ControlPlaneNotFoundError("workspace", workspaceId);
			}
			const catalog = await store.getCatalog(workspaceId, catalogId);
			if (!catalog) throw new ControlPlaneNotFoundError("catalog", catalogId);
			if (!catalog.vectorStore) {
				throw new ApiError(
					"catalog_not_bound_to_vector_store",
					`catalog '${catalogId}' has no vectorStore binding; bind one with PUT /catalogs/{id} before searching`,
					409,
				);
			}
			const descriptor = await store.getVectorStore(
				workspaceId,
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
			path: "/{workspaceId}/catalogs/{catalogId}/documents/{documentId}",
			tags: ["documents"],
			summary: "Get a document",
			request: {
				params: z.object({
					workspaceId: WorkspaceIdParamSchema,
					catalogId: CatalogIdParamSchema,
					documentId: DocumentIdParamSchema,
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
			const { workspaceId, catalogId, documentId } = c.req.valid("param");
			assertWorkspaceAccess(c, workspaceId);
			const record = await store.getDocument(
				workspaceId,
				catalogId,
				documentId,
			);
			if (!record) throw new ControlPlaneNotFoundError("document", documentId);
			return c.json(record, 200);
		},
	);

	app.openapi(
		createRoute({
			method: "put",
			path: "/{workspaceId}/catalogs/{catalogId}/documents/{documentId}",
			tags: ["documents"],
			summary: "Update document metadata",
			request: {
				params: z.object({
					workspaceId: WorkspaceIdParamSchema,
					catalogId: CatalogIdParamSchema,
					documentId: DocumentIdParamSchema,
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
			const { workspaceId, catalogId, documentId } = c.req.valid("param");
			assertWorkspaceAccess(c, workspaceId);
			const body = c.req.valid("json");
			const record = await store.updateDocument(
				workspaceId,
				catalogId,
				documentId,
				body,
			);
			return c.json(record, 200);
		},
	);

	app.openapi(
		createRoute({
			method: "delete",
			path: "/{workspaceId}/catalogs/{catalogId}/documents/{documentId}",
			tags: ["documents"],
			summary: "Delete a document",
			request: {
				params: z.object({
					workspaceId: WorkspaceIdParamSchema,
					catalogId: CatalogIdParamSchema,
					documentId: DocumentIdParamSchema,
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
			const { workspaceId, catalogId, documentId } = c.req.valid("param");
			assertWorkspaceAccess(c, workspaceId);
			const { deleted } = await store.deleteDocument(
				workspaceId,
				catalogId,
				documentId,
			);
			if (!deleted) throw new ControlPlaneNotFoundError("document", documentId);
			return c.body(null, 204);
		},
	);

	return app;
}
