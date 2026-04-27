/**
 * `/api/v1/workspaces/{workspaceUid}/chunking-services` — chunking
 * service CRUD (issue #98).
 *
 * Service rows describe **how** to call a chunking engine — endpoint,
 * auth, model parameters. They don't store data and don't own
 * collections. Knowledge bases reference one by id.
 */

import { createRoute, type OpenAPIHono, z } from "@hono/zod-openapi";
import { assertWorkspaceAccess } from "../../auth/authz.js";
import { ControlPlaneNotFoundError } from "../../control-plane/errors.js";
import type { ControlPlaneStore } from "../../control-plane/store.js";
import { makeOpenApi } from "../../lib/openapi.js";
import { paginate } from "../../lib/pagination.js";
import type { AppEnv } from "../../lib/types.js";
import {
	ChunkingServicePageSchema,
	ChunkingServiceRecordSchema,
	ChunkingServiceUidParamSchema,
	CreateChunkingServiceInputSchema,
	ErrorEnvelopeSchema,
	PaginationQuerySchema,
	UpdateChunkingServiceInputSchema,
	WorkspaceUidParamSchema,
} from "../../openapi/schemas.js";

export function chunkingServiceRoutes(
	store: ControlPlaneStore,
): OpenAPIHono<AppEnv> {
	const app = makeOpenApi();

	app.openapi(
		createRoute({
			method: "get",
			path: "/{workspaceUid}/chunking-services",
			tags: ["chunking-services"],
			summary: "List chunking services in a workspace",
			request: {
				params: z.object({ workspaceUid: WorkspaceUidParamSchema }),
				query: PaginationQuerySchema,
			},
			responses: {
				200: {
					content: {
						"application/json": { schema: ChunkingServicePageSchema },
					},
					description: "All chunking services in the workspace",
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
			const rows = await store.listChunkingServices(workspaceUid);
			return c.json(paginate(rows, query), 200);
		},
	);

	app.openapi(
		createRoute({
			method: "post",
			path: "/{workspaceUid}/chunking-services",
			tags: ["chunking-services"],
			summary: "Create a chunking service",
			request: {
				params: z.object({ workspaceUid: WorkspaceUidParamSchema }),
				body: {
					content: {
						"application/json": { schema: CreateChunkingServiceInputSchema },
					},
				},
			},
			responses: {
				201: {
					content: {
						"application/json": { schema: ChunkingServiceRecordSchema },
					},
					description: "Created",
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
			const record = await store.createChunkingService(workspaceUid, body);
			return c.json(record, 201);
		},
	);

	app.openapi(
		createRoute({
			method: "get",
			path: "/{workspaceUid}/chunking-services/{chunkingServiceUid}",
			tags: ["chunking-services"],
			summary: "Get a chunking service",
			request: {
				params: z.object({
					workspaceUid: WorkspaceUidParamSchema,
					chunkingServiceUid: ChunkingServiceUidParamSchema,
				}),
			},
			responses: {
				200: {
					content: {
						"application/json": { schema: ChunkingServiceRecordSchema },
					},
					description: "Chunking service",
				},
				404: {
					content: { "application/json": { schema: ErrorEnvelopeSchema } },
					description: "Workspace or service not found",
				},
			},
		}),
		async (c) => {
			const { workspaceUid, chunkingServiceUid } = c.req.valid("param");
			assertWorkspaceAccess(c, workspaceUid);
			const record = await store.getChunkingService(
				workspaceUid,
				chunkingServiceUid,
			);
			if (!record)
				throw new ControlPlaneNotFoundError(
					"chunking service",
					chunkingServiceUid,
				);
			return c.json(record, 200);
		},
	);

	app.openapi(
		createRoute({
			method: "put",
			path: "/{workspaceUid}/chunking-services/{chunkingServiceUid}",
			tags: ["chunking-services"],
			summary: "Update a chunking service",
			request: {
				params: z.object({
					workspaceUid: WorkspaceUidParamSchema,
					chunkingServiceUid: ChunkingServiceUidParamSchema,
				}),
				body: {
					content: {
						"application/json": { schema: UpdateChunkingServiceInputSchema },
					},
				},
			},
			responses: {
				200: {
					content: {
						"application/json": { schema: ChunkingServiceRecordSchema },
					},
					description: "Updated",
				},
				404: {
					content: { "application/json": { schema: ErrorEnvelopeSchema } },
					description: "Workspace or service not found",
				},
			},
		}),
		async (c) => {
			const { workspaceUid, chunkingServiceUid } = c.req.valid("param");
			assertWorkspaceAccess(c, workspaceUid);
			const body = c.req.valid("json");
			const record = await store.updateChunkingService(
				workspaceUid,
				chunkingServiceUid,
				body,
			);
			return c.json(record, 200);
		},
	);

	app.openapi(
		createRoute({
			method: "delete",
			path: "/{workspaceUid}/chunking-services/{chunkingServiceUid}",
			tags: ["chunking-services"],
			summary: "Delete a chunking service",
			description:
				"Refuses with 409 if any knowledge base still references this service.",
			request: {
				params: z.object({
					workspaceUid: WorkspaceUidParamSchema,
					chunkingServiceUid: ChunkingServiceUidParamSchema,
				}),
			},
			responses: {
				204: { description: "Deleted" },
				404: {
					content: { "application/json": { schema: ErrorEnvelopeSchema } },
					description: "Workspace or service not found",
				},
				409: {
					content: { "application/json": { schema: ErrorEnvelopeSchema } },
					description: "Service is still referenced by a knowledge base",
				},
			},
		}),
		async (c) => {
			const { workspaceUid, chunkingServiceUid } = c.req.valid("param");
			assertWorkspaceAccess(c, workspaceUid);
			const { deleted } = await store.deleteChunkingService(
				workspaceUid,
				chunkingServiceUid,
			);
			if (!deleted)
				throw new ControlPlaneNotFoundError(
					"chunking service",
					chunkingServiceUid,
				);
			return c.body(null, 204);
		},
	);

	return app;
}
