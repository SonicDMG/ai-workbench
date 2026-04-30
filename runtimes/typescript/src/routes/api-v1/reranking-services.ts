/**
 * `/api/v1/workspaces/{workspaceId}/reranking-services` — reranking
 * service CRUD (issue #98).
 *
 * Service rows describe **how** to call a reranker — endpoint, auth,
 * scoring strategy. They don't store data. Both knowledge bases and
 * agents may reference one by id; the agent value overrides the KB
 * value at query time.
 */

import { createRoute, type OpenAPIHono, z } from "@hono/zod-openapi";
import { assertWorkspaceAccess } from "../../auth/authz.js";
import { ControlPlaneNotFoundError } from "../../control-plane/errors.js";
import type { ControlPlaneStore } from "../../control-plane/store.js";
import { makeOpenApi } from "../../lib/openapi.js";
import { paginate } from "../../lib/pagination.js";
import type { AppEnv } from "../../lib/types.js";
import {
	CreateRerankingServiceInputSchema,
	ErrorEnvelopeSchema,
	PaginationQuerySchema,
	RerankingServiceIdParamSchema,
	RerankingServicePageSchema,
	RerankingServiceRecordSchema,
	UpdateRerankingServiceInputSchema,
	WorkspaceIdParamSchema,
} from "../../openapi/schemas.js";
import { toWirePage, toWireReranking } from "./serdes/index.js";

export function rerankingServiceRoutes(
	store: ControlPlaneStore,
): OpenAPIHono<AppEnv> {
	const app = makeOpenApi();

	app.openapi(
		createRoute({
			method: "get",
			path: "/{workspaceId}/reranking-services",
			tags: ["reranking-services"],
			summary: "List reranking services in a workspace",
			request: {
				params: z.object({ workspaceId: WorkspaceIdParamSchema }),
				query: PaginationQuerySchema,
			},
			responses: {
				200: {
					content: {
						"application/json": { schema: RerankingServicePageSchema },
					},
					description: "All reranking services in the workspace",
				},
				404: {
					content: { "application/json": { schema: ErrorEnvelopeSchema } },
					description: "Workspace not found",
				},
			},
		}),
		async (c) => {
			const { workspaceId } = c.req.valid("param");
			const query = c.req.valid("query");
			assertWorkspaceAccess(c, workspaceId);
			const rows = await store.listRerankingServices(workspaceId);
			return c.json(toWirePage(paginate(rows, query), toWireReranking), 200);
		},
	);

	app.openapi(
		createRoute({
			method: "post",
			path: "/{workspaceId}/reranking-services",
			tags: ["reranking-services"],
			summary: "Create a reranking service",
			request: {
				params: z.object({ workspaceId: WorkspaceIdParamSchema }),
				body: {
					content: {
						"application/json": { schema: CreateRerankingServiceInputSchema },
					},
				},
			},
			responses: {
				201: {
					content: {
						"application/json": { schema: RerankingServiceRecordSchema },
					},
					description: "Created",
				},
				404: {
					content: { "application/json": { schema: ErrorEnvelopeSchema } },
					description: "Workspace not found",
				},
				409: {
					content: { "application/json": { schema: ErrorEnvelopeSchema } },
					description: "Duplicate rerankingServiceId",
				},
			},
		}),
		async (c) => {
			const { workspaceId } = c.req.valid("param");
			assertWorkspaceAccess(c, workspaceId);
			const body = c.req.valid("json");
			const record = await store.createRerankingService(workspaceId, {
				...body,
				uid: body.rerankingServiceId,
			});
			return c.json(toWireReranking(record), 201);
		},
	);

	app.openapi(
		createRoute({
			method: "get",
			path: "/{workspaceId}/reranking-services/{rerankingServiceId}",
			tags: ["reranking-services"],
			summary: "Get a reranking service",
			request: {
				params: z.object({
					workspaceId: WorkspaceIdParamSchema,
					rerankingServiceId: RerankingServiceIdParamSchema,
				}),
			},
			responses: {
				200: {
					content: {
						"application/json": { schema: RerankingServiceRecordSchema },
					},
					description: "Reranking service",
				},
				404: {
					content: { "application/json": { schema: ErrorEnvelopeSchema } },
					description: "Workspace or service not found",
				},
			},
		}),
		async (c) => {
			const { workspaceId, rerankingServiceId } = c.req.valid("param");
			assertWorkspaceAccess(c, workspaceId);
			const record = await store.getRerankingService(
				workspaceId,
				rerankingServiceId,
			);
			if (!record)
				throw new ControlPlaneNotFoundError(
					"reranking service",
					rerankingServiceId,
				);
			return c.json(toWireReranking(record), 200);
		},
	);

	app.openapi(
		createRoute({
			method: "patch",
			path: "/{workspaceId}/reranking-services/{rerankingServiceId}",
			tags: ["reranking-services"],
			summary: "Update a reranking service",
			request: {
				params: z.object({
					workspaceId: WorkspaceIdParamSchema,
					rerankingServiceId: RerankingServiceIdParamSchema,
				}),
				body: {
					content: {
						"application/json": { schema: UpdateRerankingServiceInputSchema },
					},
				},
			},
			responses: {
				200: {
					content: {
						"application/json": { schema: RerankingServiceRecordSchema },
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
			const { workspaceId, rerankingServiceId } = c.req.valid("param");
			assertWorkspaceAccess(c, workspaceId);
			const body = c.req.valid("json");
			const record = await store.updateRerankingService(
				workspaceId,
				rerankingServiceId,
				body,
			);
			return c.json(toWireReranking(record), 200);
		},
	);

	app.openapi(
		createRoute({
			method: "delete",
			path: "/{workspaceId}/reranking-services/{rerankingServiceId}",
			tags: ["reranking-services"],
			summary: "Delete a reranking service",
			description:
				"Refuses with 409 if any knowledge base still references this service.",
			request: {
				params: z.object({
					workspaceId: WorkspaceIdParamSchema,
					rerankingServiceId: RerankingServiceIdParamSchema,
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
			const { workspaceId, rerankingServiceId } = c.req.valid("param");
			assertWorkspaceAccess(c, workspaceId);
			const { deleted } = await store.deleteRerankingService(
				workspaceId,
				rerankingServiceId,
			);
			if (!deleted)
				throw new ControlPlaneNotFoundError(
					"reranking service",
					rerankingServiceId,
				);
			return c.body(null, 204);
		},
	);

	return app;
}
