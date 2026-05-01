/**
 * `/api/v1/workspaces/{workspaceId}/embedding-services` — embedding
 * service CRUD (issue #98).
 *
 * Service rows describe **how** to call an embedding model — endpoint,
 * auth, dimension, distance metric. They don't store data and don't
 * own collections. Knowledge bases reference one by id.
 */

import { createRoute, type OpenAPIHono, z } from "@hono/zod-openapi";
import { ControlPlaneNotFoundError } from "../../control-plane/errors.js";
import type { ControlPlaneStore } from "../../control-plane/store.js";
import { errorResponse, makeOpenApi } from "../../lib/openapi.js";
import { paginate } from "../../lib/pagination.js";
import type { AppEnv } from "../../lib/types.js";
import {
	CreateEmbeddingServiceInputSchema,
	EmbeddingServiceIdParamSchema,
	EmbeddingServicePageSchema,
	EmbeddingServiceRecordSchema,
	PaginationQuerySchema,
	UpdateEmbeddingServiceInputSchema,
	WorkspaceIdParamSchema,
} from "../../openapi/schemas.js";
import { toWireEmbedding, toWirePage } from "./serdes/index.js";

export function embeddingServiceRoutes(
	store: ControlPlaneStore,
): OpenAPIHono<AppEnv> {
	const app = makeOpenApi();

	app.openapi(
		createRoute({
			method: "get",
			path: "/{workspaceId}/embedding-services",
			tags: ["embedding-services"],
			summary: "List embedding services in a workspace",
			request: {
				params: z.object({ workspaceId: WorkspaceIdParamSchema }),
				query: PaginationQuerySchema,
			},
			responses: {
				200: {
					content: {
						"application/json": { schema: EmbeddingServicePageSchema },
					},
					description: "All embedding services in the workspace",
				},
				...errorResponse(404, "Workspace not found"),
			},
		}),
		async (c) => {
			const { workspaceId } = c.req.valid("param");
			const query = c.req.valid("query");
			const rows = await store.listEmbeddingServices(workspaceId);
			return c.json(toWirePage(paginate(rows, query), toWireEmbedding), 200);
		},
	);

	app.openapi(
		createRoute({
			method: "post",
			path: "/{workspaceId}/embedding-services",
			tags: ["embedding-services"],
			summary: "Create an embedding service",
			request: {
				params: z.object({ workspaceId: WorkspaceIdParamSchema }),
				body: {
					content: {
						"application/json": { schema: CreateEmbeddingServiceInputSchema },
					},
				},
			},
			responses: {
				201: {
					content: {
						"application/json": { schema: EmbeddingServiceRecordSchema },
					},
					description: "Created",
				},
				...errorResponse(404, "Workspace not found"),
				...errorResponse(409, "Duplicate embeddingServiceId"),
			},
		}),
		async (c) => {
			const { workspaceId } = c.req.valid("param");
			const body = c.req.valid("json");
			const record = await store.createEmbeddingService(workspaceId, {
				...body,
				uid: body.embeddingServiceId,
			});
			return c.json(toWireEmbedding(record), 201);
		},
	);

	app.openapi(
		createRoute({
			method: "get",
			path: "/{workspaceId}/embedding-services/{embeddingServiceId}",
			tags: ["embedding-services"],
			summary: "Get an embedding service",
			request: {
				params: z.object({
					workspaceId: WorkspaceIdParamSchema,
					embeddingServiceId: EmbeddingServiceIdParamSchema,
				}),
			},
			responses: {
				200: {
					content: {
						"application/json": { schema: EmbeddingServiceRecordSchema },
					},
					description: "Embedding service",
				},
				...errorResponse(404, "Workspace or service not found"),
			},
		}),
		async (c) => {
			const { workspaceId, embeddingServiceId } = c.req.valid("param");
			const record = await store.getEmbeddingService(
				workspaceId,
				embeddingServiceId,
			);
			if (!record)
				throw new ControlPlaneNotFoundError(
					"embedding service",
					embeddingServiceId,
				);
			return c.json(toWireEmbedding(record), 200);
		},
	);

	app.openapi(
		createRoute({
			method: "patch",
			path: "/{workspaceId}/embedding-services/{embeddingServiceId}",
			tags: ["embedding-services"],
			summary: "Update an embedding service",
			request: {
				params: z.object({
					workspaceId: WorkspaceIdParamSchema,
					embeddingServiceId: EmbeddingServiceIdParamSchema,
				}),
				body: {
					content: {
						"application/json": { schema: UpdateEmbeddingServiceInputSchema },
					},
				},
			},
			responses: {
				200: {
					content: {
						"application/json": { schema: EmbeddingServiceRecordSchema },
					},
					description: "Updated",
				},
				...errorResponse(404, "Workspace or service not found"),
			},
		}),
		async (c) => {
			const { workspaceId, embeddingServiceId } = c.req.valid("param");
			const body = c.req.valid("json");
			const record = await store.updateEmbeddingService(
				workspaceId,
				embeddingServiceId,
				body,
			);
			return c.json(toWireEmbedding(record), 200);
		},
	);

	app.openapi(
		createRoute({
			method: "delete",
			path: "/{workspaceId}/embedding-services/{embeddingServiceId}",
			tags: ["embedding-services"],
			summary: "Delete an embedding service",
			description:
				"Refuses with 409 if any knowledge base still references this service.",
			request: {
				params: z.object({
					workspaceId: WorkspaceIdParamSchema,
					embeddingServiceId: EmbeddingServiceIdParamSchema,
				}),
			},
			responses: {
				204: { description: "Deleted" },
				...errorResponse(404, "Workspace or service not found"),
				...errorResponse(
					409,
					"Service is still referenced by a knowledge base",
				),
			},
		}),
		async (c) => {
			const { workspaceId, embeddingServiceId } = c.req.valid("param");
			const { deleted } = await store.deleteEmbeddingService(
				workspaceId,
				embeddingServiceId,
			);
			if (!deleted)
				throw new ControlPlaneNotFoundError(
					"embedding service",
					embeddingServiceId,
				);
			return c.body(null, 204);
		},
	);

	return app;
}
