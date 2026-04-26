/**
 * `/api/v1/workspaces/{workspaceUid}/catalogs` — catalog CRUD.
 *
 * Scoping is explicit in every path; the store enforces that the
 * workspace exists and raises `workspace_not_found` (404) if not.
 */

import { createRoute, type OpenAPIHono, z } from "@hono/zod-openapi";
import { assertWorkspaceAccess } from "../../auth/authz.js";
import { ControlPlaneNotFoundError } from "../../control-plane/errors.js";
import type { ControlPlaneStore } from "../../control-plane/store.js";
import { makeOpenApi } from "../../lib/openapi.js";
import { paginate } from "../../lib/pagination.js";
import type { AppEnv } from "../../lib/types.js";
import {
	CatalogPageSchema,
	CatalogRecordSchema,
	CatalogUidParamSchema,
	CreateCatalogInputSchema,
	ErrorEnvelopeSchema,
	PaginationQuerySchema,
	UpdateCatalogInputSchema,
	WorkspaceUidParamSchema,
} from "../../openapi/schemas.js";

export function catalogRoutes(store: ControlPlaneStore): OpenAPIHono<AppEnv> {
	const app = makeOpenApi();

	app.openapi(
		createRoute({
			method: "get",
			path: "/{workspaceUid}/catalogs",
			tags: ["catalogs"],
			summary: "List catalogs in a workspace",
			request: {
				params: z.object({ workspaceUid: WorkspaceUidParamSchema }),
				query: PaginationQuerySchema,
			},
			responses: {
				200: {
					content: {
						"application/json": { schema: CatalogPageSchema },
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
			const { workspaceUid } = c.req.valid("param");
			const query = c.req.valid("query");
			assertWorkspaceAccess(c, workspaceUid);
			const rows = await store.listCatalogs(workspaceUid);
			return c.json(paginate(rows, query), 200);
		},
	);

	app.openapi(
		createRoute({
			method: "post",
			path: "/{workspaceUid}/catalogs",
			tags: ["catalogs"],
			summary: "Create a catalog in a workspace",
			request: {
				params: z.object({ workspaceUid: WorkspaceUidParamSchema }),
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
			const { workspaceUid } = c.req.valid("param");
			assertWorkspaceAccess(c, workspaceUid);
			const body = c.req.valid("json");
			const record = await store.createCatalog(workspaceUid, body);
			return c.json(record, 201);
		},
	);

	app.openapi(
		createRoute({
			method: "get",
			path: "/{workspaceUid}/catalogs/{catalogUid}",
			tags: ["catalogs"],
			summary: "Get a catalog",
			request: {
				params: z.object({
					workspaceUid: WorkspaceUidParamSchema,
					catalogUid: CatalogUidParamSchema,
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
			const { workspaceUid, catalogUid } = c.req.valid("param");
			assertWorkspaceAccess(c, workspaceUid);
			const record = await store.getCatalog(workspaceUid, catalogUid);
			if (!record) throw new ControlPlaneNotFoundError("catalog", catalogUid);
			return c.json(record, 200);
		},
	);

	app.openapi(
		createRoute({
			method: "put",
			path: "/{workspaceUid}/catalogs/{catalogUid}",
			tags: ["catalogs"],
			summary: "Update a catalog",
			request: {
				params: z.object({
					workspaceUid: WorkspaceUidParamSchema,
					catalogUid: CatalogUidParamSchema,
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
			const { workspaceUid, catalogUid } = c.req.valid("param");
			assertWorkspaceAccess(c, workspaceUid);
			const body = c.req.valid("json");
			const record = await store.updateCatalog(workspaceUid, catalogUid, body);
			return c.json(record, 200);
		},
	);

	app.openapi(
		createRoute({
			method: "delete",
			path: "/{workspaceUid}/catalogs/{catalogUid}",
			tags: ["catalogs"],
			summary: "Delete a catalog (cascades to its documents)",
			request: {
				params: z.object({
					workspaceUid: WorkspaceUidParamSchema,
					catalogUid: CatalogUidParamSchema,
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
			const { workspaceUid, catalogUid } = c.req.valid("param");
			assertWorkspaceAccess(c, workspaceUid);
			const { deleted } = await store.deleteCatalog(workspaceUid, catalogUid);
			if (!deleted) throw new ControlPlaneNotFoundError("catalog", catalogUid);
			return c.body(null, 204);
		},
	);

	return app;
}
