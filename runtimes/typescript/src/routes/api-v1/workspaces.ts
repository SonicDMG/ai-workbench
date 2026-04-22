/**
 * `/api/v1/workspaces` — workspace CRUD routes.
 *
 * Handlers are intentionally thin: validate via Zod (automatic via the
 * OpenAPIHono route definition), delegate to the {@link ControlPlaneStore},
 * return the response. ControlPlane* errors bubble to the top-level
 * `onError` handler which translates them to the canonical envelope.
 */

import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { ControlPlaneNotFoundError } from "../../control-plane/errors.js";
import type { ControlPlaneStore } from "../../control-plane/store.js";
import type { AppEnv } from "../../lib/types.js";
import {
	CreateWorkspaceInputSchema,
	ErrorEnvelopeSchema,
	UpdateWorkspaceInputSchema,
	WorkspaceIdParamSchema,
	WorkspaceRecordSchema,
} from "../../openapi/schemas.js";

export function workspaceRoutes(store: ControlPlaneStore): OpenAPIHono<AppEnv> {
	const app = new OpenAPIHono<AppEnv>();

	app.openapi(
		createRoute({
			method: "get",
			path: "/",
			tags: ["workspaces"],
			summary: "List workspaces",
			responses: {
				200: {
					content: {
						"application/json": { schema: z.array(WorkspaceRecordSchema) },
					},
					description: "All workspaces",
				},
			},
		}),
		async (c) => {
			const rows = await store.listWorkspaces();
			return c.json([...rows], 200);
		},
	);

	app.openapi(
		createRoute({
			method: "post",
			path: "/",
			tags: ["workspaces"],
			summary: "Create a workspace",
			request: {
				body: {
					content: {
						"application/json": { schema: CreateWorkspaceInputSchema },
					},
				},
			},
			responses: {
				201: {
					content: { "application/json": { schema: WorkspaceRecordSchema } },
					description: "Workspace created",
				},
				409: {
					content: { "application/json": { schema: ErrorEnvelopeSchema } },
					description: "Duplicate uid",
				},
			},
		}),
		async (c) => {
			const body = c.req.valid("json");
			const record = await store.createWorkspace(body);
			return c.json(record, 201);
		},
	);

	app.openapi(
		createRoute({
			method: "get",
			path: "/{workspaceId}",
			tags: ["workspaces"],
			summary: "Get a workspace",
			request: { params: z.object({ workspaceId: WorkspaceIdParamSchema }) },
			responses: {
				200: {
					content: { "application/json": { schema: WorkspaceRecordSchema } },
					description: "Workspace",
				},
				404: {
					content: { "application/json": { schema: ErrorEnvelopeSchema } },
					description: "Workspace not found",
				},
			},
		}),
		async (c) => {
			const { workspaceId } = c.req.valid("param");
			const record = await store.getWorkspace(workspaceId);
			if (!record)
				throw new ControlPlaneNotFoundError("workspace", workspaceId);
			return c.json(record, 200);
		},
	);

	app.openapi(
		createRoute({
			method: "put",
			path: "/{workspaceId}",
			tags: ["workspaces"],
			summary: "Update a workspace",
			request: {
				params: z.object({ workspaceId: WorkspaceIdParamSchema }),
				body: {
					content: {
						"application/json": { schema: UpdateWorkspaceInputSchema },
					},
				},
			},
			responses: {
				200: {
					content: { "application/json": { schema: WorkspaceRecordSchema } },
					description: "Updated workspace",
				},
				404: {
					content: { "application/json": { schema: ErrorEnvelopeSchema } },
					description: "Workspace not found",
				},
			},
		}),
		async (c) => {
			const { workspaceId } = c.req.valid("param");
			const body = c.req.valid("json");
			const record = await store.updateWorkspace(workspaceId, body);
			return c.json(record, 200);
		},
	);

	app.openapi(
		createRoute({
			method: "delete",
			path: "/{workspaceId}",
			tags: ["workspaces"],
			summary:
				"Delete a workspace (cascades to catalogs/vector stores/documents)",
			request: { params: z.object({ workspaceId: WorkspaceIdParamSchema }) },
			responses: {
				204: { description: "Deleted" },
				404: {
					content: { "application/json": { schema: ErrorEnvelopeSchema } },
					description: "Workspace not found",
				},
			},
		}),
		async (c) => {
			const { workspaceId } = c.req.valid("param");
			const { deleted } = await store.deleteWorkspace(workspaceId);
			if (!deleted)
				throw new ControlPlaneNotFoundError("workspace", workspaceId);
			return c.body(null, 204);
		},
	);

	return app;
}
