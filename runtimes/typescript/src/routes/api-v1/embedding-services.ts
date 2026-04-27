/**
 * `/api/v1/workspaces/{workspaceUid}/embedding-services` — embedding
 * service CRUD (issue #98).
 *
 * Service rows describe **how** to call an embedding model — endpoint,
 * auth, dimension, distance metric. They don't store data and don't
 * own collections. Knowledge bases reference one by id.
 */

import { createRoute, type OpenAPIHono, z } from "@hono/zod-openapi";
import { assertWorkspaceAccess } from "../../auth/authz.js";
import { ControlPlaneNotFoundError } from "../../control-plane/errors.js";
import type { ControlPlaneStore } from "../../control-plane/store.js";
import { makeOpenApi } from "../../lib/openapi.js";
import { paginate } from "../../lib/pagination.js";
import type { AppEnv } from "../../lib/types.js";
import {
	CreateEmbeddingServiceInputSchema,
	EmbeddingServicePageSchema,
	EmbeddingServiceRecordSchema,
	EmbeddingServiceUidParamSchema,
	ErrorEnvelopeSchema,
	PaginationQuerySchema,
	UpdateEmbeddingServiceInputSchema,
	WorkspaceUidParamSchema,
} from "../../openapi/schemas.js";
import { toWireEmbedding, toWirePage } from "./service-serdes.js";

export function embeddingServiceRoutes(
	store: ControlPlaneStore,
): OpenAPIHono<AppEnv> {
	const app = makeOpenApi();

	app.openapi(
		createRoute({
			method: "get",
			path: "/{workspaceUid}/embedding-services",
			tags: ["embedding-services"],
			summary: "List embedding services in a workspace",
			request: {
				params: z.object({ workspaceUid: WorkspaceUidParamSchema }),
				query: PaginationQuerySchema,
			},
			responses: {
				200: {
					content: {
						"application/json": { schema: EmbeddingServicePageSchema },
					},
					description: "All embedding services in the workspace",
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
			const rows = await store.listEmbeddingServices(workspaceUid);
			return c.json(toWirePage(paginate(rows, query), toWireEmbedding), 200);
		},
	);

	app.openapi(
		createRoute({
			method: "post",
			path: "/{workspaceUid}/embedding-services",
			tags: ["embedding-services"],
			summary: "Create an embedding service",
			request: {
				params: z.object({ workspaceUid: WorkspaceUidParamSchema }),
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
			const record = await store.createEmbeddingService(workspaceUid, body);
			return c.json(toWireEmbedding(record), 201);
		},
	);

	app.openapi(
		createRoute({
			method: "get",
			path: "/{workspaceUid}/embedding-services/{embeddingServiceUid}",
			tags: ["embedding-services"],
			summary: "Get an embedding service",
			request: {
				params: z.object({
					workspaceUid: WorkspaceUidParamSchema,
					embeddingServiceUid: EmbeddingServiceUidParamSchema,
				}),
			},
			responses: {
				200: {
					content: {
						"application/json": { schema: EmbeddingServiceRecordSchema },
					},
					description: "Embedding service",
				},
				404: {
					content: { "application/json": { schema: ErrorEnvelopeSchema } },
					description: "Workspace or service not found",
				},
			},
		}),
		async (c) => {
			const { workspaceUid, embeddingServiceUid } = c.req.valid("param");
			assertWorkspaceAccess(c, workspaceUid);
			const record = await store.getEmbeddingService(
				workspaceUid,
				embeddingServiceUid,
			);
			if (!record)
				throw new ControlPlaneNotFoundError(
					"embedding service",
					embeddingServiceUid,
				);
			return c.json(toWireEmbedding(record), 200);
		},
	);

	app.openapi(
		createRoute({
			method: "put",
			path: "/{workspaceUid}/embedding-services/{embeddingServiceUid}",
			tags: ["embedding-services"],
			summary: "Update an embedding service",
			request: {
				params: z.object({
					workspaceUid: WorkspaceUidParamSchema,
					embeddingServiceUid: EmbeddingServiceUidParamSchema,
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
				404: {
					content: { "application/json": { schema: ErrorEnvelopeSchema } },
					description: "Workspace or service not found",
				},
			},
		}),
		async (c) => {
			const { workspaceUid, embeddingServiceUid } = c.req.valid("param");
			assertWorkspaceAccess(c, workspaceUid);
			const body = c.req.valid("json");
			const record = await store.updateEmbeddingService(
				workspaceUid,
				embeddingServiceUid,
				body,
			);
			return c.json(toWireEmbedding(record), 200);
		},
	);

	app.openapi(
		createRoute({
			method: "delete",
			path: "/{workspaceUid}/embedding-services/{embeddingServiceUid}",
			tags: ["embedding-services"],
			summary: "Delete an embedding service",
			description:
				"Refuses with 409 if any knowledge base still references this service.",
			request: {
				params: z.object({
					workspaceUid: WorkspaceUidParamSchema,
					embeddingServiceUid: EmbeddingServiceUidParamSchema,
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
			const { workspaceUid, embeddingServiceUid } = c.req.valid("param");
			assertWorkspaceAccess(c, workspaceUid);
			const { deleted } = await store.deleteEmbeddingService(
				workspaceUid,
				embeddingServiceUid,
			);
			if (!deleted)
				throw new ControlPlaneNotFoundError(
					"embedding service",
					embeddingServiceUid,
				);
			return c.body(null, 204);
		},
	);

	return app;
}
