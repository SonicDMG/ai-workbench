/**
 * `/api/v1/workspaces/{workspaceId}/knowledge-bases/{knowledgeBaseId}/filters`
 * — saved payload filters scoped to one Knowledge Base (issue #98).
 */

import { createRoute, type OpenAPIHono, z } from "@hono/zod-openapi";
import { ControlPlaneNotFoundError } from "../../control-plane/errors.js";
import type { ControlPlaneStore } from "../../control-plane/store.js";
import { errorResponse, makeOpenApi } from "../../lib/openapi.js";
import { paginate } from "../../lib/pagination.js";
import type { AppEnv } from "../../lib/types.js";
import {
	CreateKnowledgeFilterInputSchema,
	KnowledgeBaseIdParamSchema,
	KnowledgeFilterIdParamSchema,
	KnowledgeFilterPageSchema,
	KnowledgeFilterRecordSchema,
	PaginationQuerySchema,
	UpdateKnowledgeFilterInputSchema,
	WorkspaceIdParamSchema,
} from "../../openapi/schemas.js";

export function knowledgeFilterRoutes(
	store: ControlPlaneStore,
): OpenAPIHono<AppEnv> {
	const app = makeOpenApi();

	app.openapi(
		createRoute({
			method: "get",
			path: "/{workspaceId}/knowledge-bases/{knowledgeBaseId}/filters",
			tags: ["knowledge-bases"],
			summary: "List saved filters in a knowledge base",
			request: {
				params: z.object({
					workspaceId: WorkspaceIdParamSchema,
					knowledgeBaseId: KnowledgeBaseIdParamSchema,
				}),
				query: PaginationQuerySchema,
			},
			responses: {
				200: {
					content: {
						"application/json": { schema: KnowledgeFilterPageSchema },
					},
					description: "All saved filters in the knowledge base",
				},
				...errorResponse(404, "Workspace or knowledge base not found"),
			},
		}),
		async (c) => {
			const { workspaceId, knowledgeBaseId } = c.req.valid("param");
			const query = c.req.valid("query");
			const rows = await store.listKnowledgeFilters(
				workspaceId,
				knowledgeBaseId,
			);
			return c.json(paginate(rows, query), 200);
		},
	);

	app.openapi(
		createRoute({
			method: "post",
			path: "/{workspaceId}/knowledge-bases/{knowledgeBaseId}/filters",
			tags: ["knowledge-bases"],
			summary: "Create a saved knowledge-base filter",
			request: {
				params: z.object({
					workspaceId: WorkspaceIdParamSchema,
					knowledgeBaseId: KnowledgeBaseIdParamSchema,
				}),
				body: {
					content: {
						"application/json": { schema: CreateKnowledgeFilterInputSchema },
					},
				},
			},
			responses: {
				201: {
					content: {
						"application/json": { schema: KnowledgeFilterRecordSchema },
					},
					description: "Knowledge filter created",
				},
				...errorResponse(404, "Workspace or knowledge base not found"),
				...errorResponse(409, "Duplicate knowledgeFilterId"),
			},
		}),
		async (c) => {
			const { workspaceId, knowledgeBaseId } = c.req.valid("param");
			const body = c.req.valid("json");
			const record = await store.createKnowledgeFilter(
				workspaceId,
				knowledgeBaseId,
				{ ...body, uid: body.knowledgeFilterId },
			);
			return c.json(record, 201);
		},
	);

	app.openapi(
		createRoute({
			method: "get",
			path: "/{workspaceId}/knowledge-bases/{knowledgeBaseId}/filters/{knowledgeFilterId}",
			tags: ["knowledge-bases"],
			summary: "Get a saved knowledge-base filter",
			request: {
				params: z.object({
					workspaceId: WorkspaceIdParamSchema,
					knowledgeBaseId: KnowledgeBaseIdParamSchema,
					knowledgeFilterId: KnowledgeFilterIdParamSchema,
				}),
			},
			responses: {
				200: {
					content: {
						"application/json": { schema: KnowledgeFilterRecordSchema },
					},
					description: "Knowledge filter",
				},
				...errorResponse(404, "Workspace, knowledge base, or filter not found"),
			},
		}),
		async (c) => {
			const { workspaceId, knowledgeBaseId, knowledgeFilterId } =
				c.req.valid("param");
			const record = await store.getKnowledgeFilter(
				workspaceId,
				knowledgeBaseId,
				knowledgeFilterId,
			);
			if (!record) {
				throw new ControlPlaneNotFoundError(
					"knowledge filter",
					knowledgeFilterId,
				);
			}
			return c.json(record, 200);
		},
	);

	app.openapi(
		createRoute({
			method: "patch",
			path: "/{workspaceId}/knowledge-bases/{knowledgeBaseId}/filters/{knowledgeFilterId}",
			tags: ["knowledge-bases"],
			summary: "Update a saved knowledge-base filter",
			request: {
				params: z.object({
					workspaceId: WorkspaceIdParamSchema,
					knowledgeBaseId: KnowledgeBaseIdParamSchema,
					knowledgeFilterId: KnowledgeFilterIdParamSchema,
				}),
				body: {
					content: {
						"application/json": { schema: UpdateKnowledgeFilterInputSchema },
					},
				},
			},
			responses: {
				200: {
					content: {
						"application/json": { schema: KnowledgeFilterRecordSchema },
					},
					description: "Updated knowledge filter",
				},
				...errorResponse(404, "Workspace, knowledge base, or filter not found"),
			},
		}),
		async (c) => {
			const { workspaceId, knowledgeBaseId, knowledgeFilterId } =
				c.req.valid("param");
			const body = c.req.valid("json");
			const record = await store.updateKnowledgeFilter(
				workspaceId,
				knowledgeBaseId,
				knowledgeFilterId,
				body,
			);
			return c.json(record, 200);
		},
	);

	app.openapi(
		createRoute({
			method: "delete",
			path: "/{workspaceId}/knowledge-bases/{knowledgeBaseId}/filters/{knowledgeFilterId}",
			tags: ["knowledge-bases"],
			summary: "Delete a saved knowledge-base filter",
			request: {
				params: z.object({
					workspaceId: WorkspaceIdParamSchema,
					knowledgeBaseId: KnowledgeBaseIdParamSchema,
					knowledgeFilterId: KnowledgeFilterIdParamSchema,
				}),
			},
			responses: {
				204: { description: "Deleted" },
				...errorResponse(404, "Workspace, knowledge base, or filter not found"),
			},
		}),
		async (c) => {
			const { workspaceId, knowledgeBaseId, knowledgeFilterId } =
				c.req.valid("param");
			const { deleted } = await store.deleteKnowledgeFilter(
				workspaceId,
				knowledgeBaseId,
				knowledgeFilterId,
			);
			if (!deleted) {
				throw new ControlPlaneNotFoundError(
					"knowledge filter",
					knowledgeFilterId,
				);
			}
			return c.body(null, 204);
		},
	);

	return app;
}
