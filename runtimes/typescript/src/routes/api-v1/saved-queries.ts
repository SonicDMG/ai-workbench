/**
 * `/api/v1/workspaces/{workspaceId}/catalogs/{catalogId}/queries` —
 * saved search recipes scoped to a catalog, plus a `/run` endpoint
 * that replays a saved query through the catalog-scoped search path.
 *
 * Storage is a new control-plane table (`wb_saved_queries_by_catalog`
 * on astra); deleting a workspace or catalog cascades to its saved
 * queries.
 *
 * `/run` delegates to {@link ./search-dispatch.dispatchSearch} with the
 * same catalog-scope filter merging as
 * `POST /documents/search` — the search never escapes the catalog
 * regardless of what the saved `filter` carries.
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
	CreateSavedQueryInputSchema,
	ErrorEnvelopeSchema,
	SavedQueryIdParamSchema,
	SavedQueryRecordSchema,
	SearchHitSchema,
	UpdateSavedQueryInputSchema,
	WorkspaceIdParamSchema,
} from "../../openapi/schemas.js";
import { CATALOG_SCOPE_KEY } from "./documents.js";
import { dispatchSearch, toMutableHits } from "./search-dispatch.js";

export interface SavedQueryRouteDeps {
	readonly store: ControlPlaneStore;
	readonly drivers: VectorStoreDriverRegistry;
	readonly embedders: EmbedderFactory;
}

export function savedQueryRoutes(
	deps: SavedQueryRouteDeps,
): OpenAPIHono<AppEnv> {
	const { store, drivers, embedders } = deps;
	const app = makeOpenApi();

	app.openapi(
		createRoute({
			method: "get",
			path: "/{workspaceId}/catalogs/{catalogId}/queries",
			tags: ["saved-queries"],
			summary: "List saved queries in a catalog",
			request: {
				params: z.object({
					workspaceId: WorkspaceIdParamSchema,
					catalogId: CatalogIdParamSchema,
				}),
			},
			responses: {
				200: {
					content: {
						"application/json": { schema: z.array(SavedQueryRecordSchema) },
					},
					description: "All saved queries in the catalog",
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
			const rows = await store.listSavedQueries(workspaceId, catalogId);
			return c.json(
				rows.map((r) => ({
					...r,
					filter: r.filter ? { ...r.filter } : null,
				})),
				200,
			);
		},
	);

	app.openapi(
		createRoute({
			method: "post",
			path: "/{workspaceId}/catalogs/{catalogId}/queries",
			tags: ["saved-queries"],
			summary: "Create a saved query",
			request: {
				params: z.object({
					workspaceId: WorkspaceIdParamSchema,
					catalogId: CatalogIdParamSchema,
				}),
				body: {
					content: {
						"application/json": { schema: CreateSavedQueryInputSchema },
					},
				},
			},
			responses: {
				201: {
					content: { "application/json": { schema: SavedQueryRecordSchema } },
					description: "Saved query created",
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
			const record = await store.createSavedQuery(workspaceId, catalogId, body);
			return c.json(
				{ ...record, filter: record.filter ? { ...record.filter } : null },
				201,
			);
		},
	);

	app.openapi(
		createRoute({
			method: "get",
			path: "/{workspaceId}/catalogs/{catalogId}/queries/{queryId}",
			tags: ["saved-queries"],
			summary: "Get a saved query",
			request: {
				params: z.object({
					workspaceId: WorkspaceIdParamSchema,
					catalogId: CatalogIdParamSchema,
					queryId: SavedQueryIdParamSchema,
				}),
			},
			responses: {
				200: {
					content: { "application/json": { schema: SavedQueryRecordSchema } },
					description: "Saved query",
				},
				404: {
					content: { "application/json": { schema: ErrorEnvelopeSchema } },
					description: "Workspace, catalog, or saved query not found",
				},
			},
		}),
		async (c) => {
			const { workspaceId, catalogId, queryId } = c.req.valid("param");
			assertWorkspaceAccess(c, workspaceId);
			const record = await store.getSavedQuery(workspaceId, catalogId, queryId);
			if (!record) {
				throw new ControlPlaneNotFoundError("saved query", queryId);
			}
			return c.json(
				{ ...record, filter: record.filter ? { ...record.filter } : null },
				200,
			);
		},
	);

	app.openapi(
		createRoute({
			method: "put",
			path: "/{workspaceId}/catalogs/{catalogId}/queries/{queryId}",
			tags: ["saved-queries"],
			summary: "Update a saved query",
			request: {
				params: z.object({
					workspaceId: WorkspaceIdParamSchema,
					catalogId: CatalogIdParamSchema,
					queryId: SavedQueryIdParamSchema,
				}),
				body: {
					content: {
						"application/json": { schema: UpdateSavedQueryInputSchema },
					},
				},
			},
			responses: {
				200: {
					content: { "application/json": { schema: SavedQueryRecordSchema } },
					description: "Updated saved query",
				},
				404: {
					content: { "application/json": { schema: ErrorEnvelopeSchema } },
					description: "Workspace, catalog, or saved query not found",
				},
			},
		}),
		async (c) => {
			const { workspaceId, catalogId, queryId } = c.req.valid("param");
			assertWorkspaceAccess(c, workspaceId);
			const body = c.req.valid("json");
			const record = await store.updateSavedQuery(
				workspaceId,
				catalogId,
				queryId,
				body,
			);
			return c.json(
				{ ...record, filter: record.filter ? { ...record.filter } : null },
				200,
			);
		},
	);

	app.openapi(
		createRoute({
			method: "delete",
			path: "/{workspaceId}/catalogs/{catalogId}/queries/{queryId}",
			tags: ["saved-queries"],
			summary: "Delete a saved query",
			request: {
				params: z.object({
					workspaceId: WorkspaceIdParamSchema,
					catalogId: CatalogIdParamSchema,
					queryId: SavedQueryIdParamSchema,
				}),
			},
			responses: {
				204: { description: "Deleted" },
				404: {
					content: { "application/json": { schema: ErrorEnvelopeSchema } },
					description: "Workspace, catalog, or saved query not found",
				},
			},
		}),
		async (c) => {
			const { workspaceId, catalogId, queryId } = c.req.valid("param");
			assertWorkspaceAccess(c, workspaceId);
			const { deleted } = await store.deleteSavedQuery(
				workspaceId,
				catalogId,
				queryId,
			);
			if (!deleted) {
				throw new ControlPlaneNotFoundError("saved query", queryId);
			}
			return c.body(null, 204);
		},
	);

	app.openapi(
		createRoute({
			method: "post",
			path: "/{workspaceId}/catalogs/{catalogId}/queries/{queryId}/run",
			tags: ["saved-queries"],
			summary: "Run a saved query",
			description:
				"Replays the saved query through the catalog-scoped search path. The catalog's UID is still merged into the effective filter, so a search can never escape its catalog even if the saved `filter` tries to.",
			request: {
				params: z.object({
					workspaceId: WorkspaceIdParamSchema,
					catalogId: CatalogIdParamSchema,
					queryId: SavedQueryIdParamSchema,
				}),
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
					description:
						"Embedding failure (dimension mismatch, unavailable provider)",
				},
				404: {
					content: { "application/json": { schema: ErrorEnvelopeSchema } },
					description:
						"Workspace, catalog, saved query, or bound vector store not found",
				},
				409: {
					content: { "application/json": { schema: ErrorEnvelopeSchema } },
					description: "Catalog has no vector store binding",
				},
			},
		}),
		async (c) => {
			const { workspaceId, catalogId, queryId } = c.req.valid("param");
			assertWorkspaceAccess(c, workspaceId);

			const workspace = await store.getWorkspace(workspaceId);
			if (!workspace) {
				throw new ControlPlaneNotFoundError("workspace", workspaceId);
			}
			const catalog = await store.getCatalog(workspaceId, catalogId);
			if (!catalog) throw new ControlPlaneNotFoundError("catalog", catalogId);
			if (!catalog.vectorStore) {
				throw new ApiError(
					"catalog_not_bound_to_vector_store",
					`catalog '${catalogId}' has no vectorStore binding; bind one with PUT /catalogs/{id} before running saved queries`,
					409,
				);
			}
			const query = await store.getSavedQuery(workspaceId, catalogId, queryId);
			if (!query) {
				throw new ControlPlaneNotFoundError("saved query", queryId);
			}
			const descriptor = await store.getVectorStore(
				workspaceId,
				catalog.vectorStore,
			);
			if (!descriptor) {
				throw new ControlPlaneNotFoundError(
					"vector store",
					catalog.vectorStore,
				);
			}

			const driver = drivers.for(workspace);
			const scopedFilter = {
				...(query.filter ?? {}),
				[CATALOG_SCOPE_KEY]: catalog.uid,
			};
			const hits = await dispatchSearch({
				ctx: { workspace, descriptor },
				driver,
				embedders,
				body: {
					text: query.text,
					...(query.topK !== null && { topK: query.topK }),
					filter: scopedFilter,
				},
			});
			return c.json(toMutableHits(hits), 200);
		},
	);

	return app;
}
