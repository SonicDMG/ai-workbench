/**
 * `/api/v1/workspaces/{workspaceUid}/reranking-services` — reranking
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
	RerankingServicePageSchema,
	RerankingServiceRecordSchema,
	RerankingServiceUidParamSchema,
	UpdateRerankingServiceInputSchema,
	WorkspaceUidParamSchema,
} from "../../openapi/schemas.js";
import { toWirePage, toWireReranking } from "./service-serdes.js";

export function rerankingServiceRoutes(
	store: ControlPlaneStore,
): OpenAPIHono<AppEnv> {
	const app = makeOpenApi();

	app.openapi(
		createRoute({
			method: "get",
			path: "/{workspaceUid}/reranking-services",
			tags: ["reranking-services"],
			summary: "List reranking services in a workspace",
			request: {
				params: z.object({ workspaceUid: WorkspaceUidParamSchema }),
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
			const { workspaceUid } = c.req.valid("param");
			const query = c.req.valid("query");
			assertWorkspaceAccess(c, workspaceUid);
			const rows = await store.listRerankingServices(workspaceUid);
			return c.json(toWirePage(paginate(rows, query), toWireReranking), 200);
		},
	);

	app.openapi(
		createRoute({
			method: "post",
			path: "/{workspaceUid}/reranking-services",
			tags: ["reranking-services"],
			summary: "Create a reranking service",
			request: {
				params: z.object({ workspaceUid: WorkspaceUidParamSchema }),
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
					description: "Duplicate uid",
				},
			},
		}),
		async (c) => {
			const { workspaceUid } = c.req.valid("param");
			assertWorkspaceAccess(c, workspaceUid);
			const body = c.req.valid("json");
			const record = await store.createRerankingService(workspaceUid, body);
			return c.json(toWireReranking(record), 201);
		},
	);

	app.openapi(
		createRoute({
			method: "get",
			path: "/{workspaceUid}/reranking-services/{rerankingServiceUid}",
			tags: ["reranking-services"],
			summary: "Get a reranking service",
			request: {
				params: z.object({
					workspaceUid: WorkspaceUidParamSchema,
					rerankingServiceUid: RerankingServiceUidParamSchema,
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
			const { workspaceUid, rerankingServiceUid } = c.req.valid("param");
			assertWorkspaceAccess(c, workspaceUid);
			const record = await store.getRerankingService(
				workspaceUid,
				rerankingServiceUid,
			);
			if (!record)
				throw new ControlPlaneNotFoundError(
					"reranking service",
					rerankingServiceUid,
				);
			return c.json(toWireReranking(record), 200);
		},
	);

	app.openapi(
		createRoute({
			method: "put",
			path: "/{workspaceUid}/reranking-services/{rerankingServiceUid}",
			tags: ["reranking-services"],
			summary: "Update a reranking service",
			request: {
				params: z.object({
					workspaceUid: WorkspaceUidParamSchema,
					rerankingServiceUid: RerankingServiceUidParamSchema,
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
			const { workspaceUid, rerankingServiceUid } = c.req.valid("param");
			assertWorkspaceAccess(c, workspaceUid);
			const body = c.req.valid("json");
			const record = await store.updateRerankingService(
				workspaceUid,
				rerankingServiceUid,
				body,
			);
			return c.json(toWireReranking(record), 200);
		},
	);

	app.openapi(
		createRoute({
			method: "delete",
			path: "/{workspaceUid}/reranking-services/{rerankingServiceUid}",
			tags: ["reranking-services"],
			summary: "Delete a reranking service",
			description:
				"Refuses with 409 if any knowledge base still references this service.",
			request: {
				params: z.object({
					workspaceUid: WorkspaceUidParamSchema,
					rerankingServiceUid: RerankingServiceUidParamSchema,
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
			const { workspaceUid, rerankingServiceUid } = c.req.valid("param");
			assertWorkspaceAccess(c, workspaceUid);
			const { deleted } = await store.deleteRerankingService(
				workspaceUid,
				rerankingServiceUid,
			);
			if (!deleted)
				throw new ControlPlaneNotFoundError(
					"reranking service",
					rerankingServiceUid,
				);
			return c.body(null, 204);
		},
	);

	return app;
}
