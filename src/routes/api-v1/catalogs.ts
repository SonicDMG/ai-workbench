/**
 * `/api/v1/workspaces/{workspaceId}/catalogs` — catalog CRUD.
 *
 * Scoping is explicit in every path; the store enforces that the
 * workspace exists and raises `workspace_not_found` (404) if not.
 */

import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { ControlPlaneNotFoundError } from "../../control-plane/errors.js";
import type { ControlPlaneStore } from "../../control-plane/store.js";
import type { AppEnv } from "../../lib/types.js";
import {
	CatalogIdParamSchema,
	CatalogRecordSchema,
	CreateCatalogInputSchema,
	ErrorEnvelopeSchema,
	UpdateCatalogInputSchema,
	WorkspaceIdParamSchema,
} from "../../openapi/schemas.js";

export function catalogRoutes(store: ControlPlaneStore): OpenAPIHono<AppEnv> {
	const app = new OpenAPIHono<AppEnv>();

	app.openapi(
		createRoute({
			method: "get",
			path: "/{workspaceId}/catalogs",
			tags: ["catalogs"],
			summary: "List catalogs in a workspace",
			request: { params: z.object({ workspaceId: WorkspaceIdParamSchema }) },
			responses: {
				200: {
					content: {
						"application/json": { schema: z.array(CatalogRecordSchema) },
					},
					description: "All catalogs in the workspace",
				},
				404: {
					content: { "application/json": { schema: ErrorEnvelopeSchema } },
					description: "Workspace not found",
				},
			},
		}),
		async (c) => {
			const { workspaceId } = c.req.valid("param");
			const rows = await store.listCatalogs(workspaceId);
			return c.json([...rows], 200);
		},
	);

	app.openapi(
		createRoute({
			method: "post",
			path: "/{workspaceId}/catalogs",
			tags: ["catalogs"],
			summary: "Create a catalog in a workspace",
			request: {
				params: z.object({ workspaceId: WorkspaceIdParamSchema }),
				body: {
					content: {
						"application/json": { schema: CreateCatalogInputSchema },
					},
				},
			},
			responses: {
				201: {
					content: { "application/json": { schema: CatalogRecordSchema } },
					description: "Catalog created",
				},
				404: {
					content: { "application/json": { schema: ErrorEnvelopeSchema } },
					description: "Workspace not found",
				},
				409: {
					content: { "application/json": { schema: ErrorEnvelopeSchema } },
					description: "Duplicate uid",
				},
			},
		}),
		async (c) => {
			const { workspaceId } = c.req.valid("param");
			const body = c.req.valid("json");
			const record = await store.createCatalog(workspaceId, body);
			return c.json(record, 201);
		},
	);

	app.openapi(
		createRoute({
			method: "get",
			path: "/{workspaceId}/catalogs/{catalogId}",
			tags: ["catalogs"],
			summary: "Get a catalog",
			request: {
				params: z.object({
					workspaceId: WorkspaceIdParamSchema,
					catalogId: CatalogIdParamSchema,
				}),
			},
			responses: {
				200: {
					content: { "application/json": { schema: CatalogRecordSchema } },
					description: "Catalog",
				},
				404: {
					content: { "application/json": { schema: ErrorEnvelopeSchema } },
					description: "Workspace or catalog not found",
				},
			},
		}),
		async (c) => {
			const { workspaceId, catalogId } = c.req.valid("param");
			const record = await store.getCatalog(workspaceId, catalogId);
			if (!record) throw new ControlPlaneNotFoundError("catalog", catalogId);
			return c.json(record, 200);
		},
	);

	app.openapi(
		createRoute({
			method: "put",
			path: "/{workspaceId}/catalogs/{catalogId}",
			tags: ["catalogs"],
			summary: "Update a catalog",
			request: {
				params: z.object({
					workspaceId: WorkspaceIdParamSchema,
					catalogId: CatalogIdParamSchema,
				}),
				body: {
					content: {
						"application/json": { schema: UpdateCatalogInputSchema },
					},
				},
			},
			responses: {
				200: {
					content: { "application/json": { schema: CatalogRecordSchema } },
					description: "Updated catalog",
				},
				404: {
					content: { "application/json": { schema: ErrorEnvelopeSchema } },
					description: "Workspace or catalog not found",
				},
			},
		}),
		async (c) => {
			const { workspaceId, catalogId } = c.req.valid("param");
			const body = c.req.valid("json");
			const record = await store.updateCatalog(workspaceId, catalogId, body);
			return c.json(record, 200);
		},
	);

	app.openapi(
		createRoute({
			method: "delete",
			path: "/{workspaceId}/catalogs/{catalogId}",
			tags: ["catalogs"],
			summary: "Delete a catalog (cascades to its documents)",
			request: {
				params: z.object({
					workspaceId: WorkspaceIdParamSchema,
					catalogId: CatalogIdParamSchema,
				}),
			},
			responses: {
				204: { description: "Deleted" },
				404: {
					content: { "application/json": { schema: ErrorEnvelopeSchema } },
					description: "Workspace or catalog not found",
				},
			},
		}),
		async (c) => {
			const { workspaceId, catalogId } = c.req.valid("param");
			const { deleted } = await store.deleteCatalog(workspaceId, catalogId);
			if (!deleted) throw new ControlPlaneNotFoundError("catalog", catalogId);
			return c.body(null, 204);
		},
	);

	return app;
}
