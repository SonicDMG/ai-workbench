/**
 * `/api/v1/workspaces/{workspaceUid}/knowledge-bases/{knowledgeBaseUid}/filters`
 * — saved payload filters scoped to one Knowledge Base (issue #98).
 */

import { createRoute, type OpenAPIHono, z } from "@hono/zod-openapi";
import { assertWorkspaceAccess } from "../../auth/authz.js";
import { ControlPlaneNotFoundError } from "../../control-plane/errors.js";
import type { ControlPlaneStore } from "../../control-plane/store.js";
import { makeOpenApi } from "../../lib/openapi.js";
import { paginate } from "../../lib/pagination.js";
import type { AppEnv } from "../../lib/types.js";
import {
	CreateKnowledgeFilterInputSchema,
	ErrorEnvelopeSchema,
	KnowledgeBaseUidParamSchema,
	KnowledgeFilterPageSchema,
	KnowledgeFilterRecordSchema,
	KnowledgeFilterUidParamSchema,
	PaginationQuerySchema,
	UpdateKnowledgeFilterInputSchema,
	WorkspaceUidParamSchema,
} from "../../openapi/schemas.js";

export function knowledgeFilterRoutes(
	store: ControlPlaneStore,
): OpenAPIHono<AppEnv> {
	const app = makeOpenApi();

	app.openapi(
		createRoute({
			method: "get",
			path: "/{workspaceUid}/knowledge-bases/{knowledgeBaseUid}/filters",
			tags: ["knowledge-bases"],
			summary: "List saved filters in a knowledge base",
			request: {
				params: z.object({
					workspaceUid: WorkspaceUidParamSchema,
					knowledgeBaseUid: KnowledgeBaseUidParamSchema,
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
				404: {
					content: { "application/json": { schema: ErrorEnvelopeSchema } },
					description: "Workspace or knowledge base not found",
				},
			},
		}),
		async (c) => {
			const { workspaceUid, knowledgeBaseUid } = c.req.valid("param");
			const query = c.req.valid("query");
			assertWorkspaceAccess(c, workspaceUid);
			const rows = await store.listKnowledgeFilters(
				workspaceUid,
				knowledgeBaseUid,
			);
			return c.json(paginate(rows, query), 200);
		},
	);

	app.openapi(
		createRoute({
			method: "post",
			path: "/{workspaceUid}/knowledge-bases/{knowledgeBaseUid}/filters",
			tags: ["knowledge-bases"],
			summary: "Create a saved knowledge-base filter",
			request: {
				params: z.object({
					workspaceUid: WorkspaceUidParamSchema,
					knowledgeBaseUid: KnowledgeBaseUidParamSchema,
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
				404: {
					content: { "application/json": { schema: ErrorEnvelopeSchema } },
					description: "Workspace or knowledge base not found",
				},
				409: {
					content: { "application/json": { schema: ErrorEnvelopeSchema } },
					description: "Duplicate uid",
				},
			},
		}),
		async (c) => {
			const { workspaceUid, knowledgeBaseUid } = c.req.valid("param");
			assertWorkspaceAccess(c, workspaceUid);
			const body = c.req.valid("json");
			const record = await store.createKnowledgeFilter(
				workspaceUid,
				knowledgeBaseUid,
				body,
			);
			return c.json(record, 201);
		},
	);

	app.openapi(
		createRoute({
			method: "get",
			path: "/{workspaceUid}/knowledge-bases/{knowledgeBaseUid}/filters/{knowledgeFilterUid}",
			tags: ["knowledge-bases"],
			summary: "Get a saved knowledge-base filter",
			request: {
				params: z.object({
					workspaceUid: WorkspaceUidParamSchema,
					knowledgeBaseUid: KnowledgeBaseUidParamSchema,
					knowledgeFilterUid: KnowledgeFilterUidParamSchema,
				}),
			},
			responses: {
				200: {
					content: {
						"application/json": { schema: KnowledgeFilterRecordSchema },
					},
					description: "Knowledge filter",
				},
				404: {
					content: { "application/json": { schema: ErrorEnvelopeSchema } },
					description: "Workspace, knowledge base, or filter not found",
				},
			},
		}),
		async (c) => {
			const { workspaceUid, knowledgeBaseUid, knowledgeFilterUid } =
				c.req.valid("param");
			assertWorkspaceAccess(c, workspaceUid);
			const record = await store.getKnowledgeFilter(
				workspaceUid,
				knowledgeBaseUid,
				knowledgeFilterUid,
			);
			if (!record) {
				throw new ControlPlaneNotFoundError(
					"knowledge filter",
					knowledgeFilterUid,
				);
			}
			return c.json(record, 200);
		},
	);

	app.openapi(
		createRoute({
			method: "put",
			path: "/{workspaceUid}/knowledge-bases/{knowledgeBaseUid}/filters/{knowledgeFilterUid}",
			tags: ["knowledge-bases"],
			summary: "Update a saved knowledge-base filter",
			request: {
				params: z.object({
					workspaceUid: WorkspaceUidParamSchema,
					knowledgeBaseUid: KnowledgeBaseUidParamSchema,
					knowledgeFilterUid: KnowledgeFilterUidParamSchema,
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
				404: {
					content: { "application/json": { schema: ErrorEnvelopeSchema } },
					description: "Workspace, knowledge base, or filter not found",
				},
			},
		}),
		async (c) => {
			const { workspaceUid, knowledgeBaseUid, knowledgeFilterUid } =
				c.req.valid("param");
			assertWorkspaceAccess(c, workspaceUid);
			const body = c.req.valid("json");
			const record = await store.updateKnowledgeFilter(
				workspaceUid,
				knowledgeBaseUid,
				knowledgeFilterUid,
				body,
			);
			return c.json(record, 200);
		},
	);

	app.openapi(
		createRoute({
			method: "delete",
			path: "/{workspaceUid}/knowledge-bases/{knowledgeBaseUid}/filters/{knowledgeFilterUid}",
			tags: ["knowledge-bases"],
			summary: "Delete a saved knowledge-base filter",
			request: {
				params: z.object({
					workspaceUid: WorkspaceUidParamSchema,
					knowledgeBaseUid: KnowledgeBaseUidParamSchema,
					knowledgeFilterUid: KnowledgeFilterUidParamSchema,
				}),
			},
			responses: {
				204: { description: "Deleted" },
				404: {
					content: { "application/json": { schema: ErrorEnvelopeSchema } },
					description: "Workspace, knowledge base, or filter not found",
				},
			},
		}),
		async (c) => {
			const { workspaceUid, knowledgeBaseUid, knowledgeFilterUid } =
				c.req.valid("param");
			assertWorkspaceAccess(c, workspaceUid);
			const { deleted } = await store.deleteKnowledgeFilter(
				workspaceUid,
				knowledgeBaseUid,
				knowledgeFilterUid,
			);
			if (!deleted) {
				throw new ControlPlaneNotFoundError(
					"knowledge filter",
					knowledgeFilterUid,
				);
			}
			return c.body(null, 204);
		},
	);

	return app;
}
