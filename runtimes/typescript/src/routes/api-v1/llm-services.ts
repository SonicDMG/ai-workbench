/**
 * `/api/v1/workspaces/{workspaceId}/llm-services` — LLM service CRUD.
 *
 * LLM services describe **how** to call a chat / generation model —
 * provider, model name, endpoint, auth — and are referenced by agents
 * via `agent.llmServiceId`. Multiple agents in the same workspace
 * may share one service definition. Deleting an in-use service is
 * blocked with 409 (mirrors the embedding/chunking pattern).
 */

import { createRoute, type OpenAPIHono, z } from "@hono/zod-openapi";
import { assertWorkspaceAccess } from "../../auth/authz.js";
import { ControlPlaneNotFoundError } from "../../control-plane/errors.js";
import type { ControlPlaneStore } from "../../control-plane/store.js";
import { makeOpenApi } from "../../lib/openapi.js";
import { paginate } from "../../lib/pagination.js";
import type { AppEnv } from "../../lib/types.js";
import {
	CreateLlmServiceInputSchema,
	ErrorEnvelopeSchema,
	LlmServiceIdParamSchema,
	LlmServicePageSchema,
	LlmServiceRecordSchema,
	PaginationQuerySchema,
	UpdateLlmServiceInputSchema,
	WorkspaceIdParamSchema,
} from "../../openapi/schemas.js";
import { toWireLlm, toWirePage } from "./serdes/index.js";

export function llmServiceRoutes(
	store: ControlPlaneStore,
): OpenAPIHono<AppEnv> {
	const app = makeOpenApi();

	app.openapi(
		createRoute({
			method: "get",
			path: "/{workspaceId}/llm-services",
			tags: ["llm-services"],
			summary: "List LLM services in a workspace",
			request: {
				params: z.object({ workspaceId: WorkspaceIdParamSchema }),
				query: PaginationQuerySchema,
			},
			responses: {
				200: {
					content: {
						"application/json": { schema: LlmServicePageSchema },
					},
					description: "All LLM services in the workspace",
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
			const rows = await store.listLlmServices(workspaceId);
			return c.json(toWirePage(paginate(rows, query), toWireLlm), 200);
		},
	);

	app.openapi(
		createRoute({
			method: "post",
			path: "/{workspaceId}/llm-services",
			tags: ["llm-services"],
			summary: "Create an LLM service",
			request: {
				params: z.object({ workspaceId: WorkspaceIdParamSchema }),
				body: {
					content: {
						"application/json": { schema: CreateLlmServiceInputSchema },
					},
				},
			},
			responses: {
				201: {
					content: {
						"application/json": { schema: LlmServiceRecordSchema },
					},
					description: "Created",
				},
				404: {
					content: { "application/json": { schema: ErrorEnvelopeSchema } },
					description: "Workspace not found",
				},
				409: {
					content: { "application/json": { schema: ErrorEnvelopeSchema } },
					description: "Duplicate llmServiceId",
				},
			},
		}),
		async (c) => {
			const { workspaceId } = c.req.valid("param");
			assertWorkspaceAccess(c, workspaceId);
			const body = c.req.valid("json");
			const record = await store.createLlmService(workspaceId, {
				...body,
				uid: body.llmServiceId,
			});
			return c.json(toWireLlm(record), 201);
		},
	);

	app.openapi(
		createRoute({
			method: "get",
			path: "/{workspaceId}/llm-services/{llmServiceId}",
			tags: ["llm-services"],
			summary: "Get an LLM service",
			request: {
				params: z.object({
					workspaceId: WorkspaceIdParamSchema,
					llmServiceId: LlmServiceIdParamSchema,
				}),
			},
			responses: {
				200: {
					content: {
						"application/json": { schema: LlmServiceRecordSchema },
					},
					description: "LLM service",
				},
				404: {
					content: { "application/json": { schema: ErrorEnvelopeSchema } },
					description: "Workspace or service not found",
				},
			},
		}),
		async (c) => {
			const { workspaceId, llmServiceId } = c.req.valid("param");
			assertWorkspaceAccess(c, workspaceId);
			const record = await store.getLlmService(workspaceId, llmServiceId);
			if (!record)
				throw new ControlPlaneNotFoundError("llm service", llmServiceId);
			return c.json(toWireLlm(record), 200);
		},
	);

	app.openapi(
		createRoute({
			method: "patch",
			path: "/{workspaceId}/llm-services/{llmServiceId}",
			tags: ["llm-services"],
			summary: "Update an LLM service",
			request: {
				params: z.object({
					workspaceId: WorkspaceIdParamSchema,
					llmServiceId: LlmServiceIdParamSchema,
				}),
				body: {
					content: {
						"application/json": { schema: UpdateLlmServiceInputSchema },
					},
				},
			},
			responses: {
				200: {
					content: {
						"application/json": { schema: LlmServiceRecordSchema },
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
			const { workspaceId, llmServiceId } = c.req.valid("param");
			assertWorkspaceAccess(c, workspaceId);
			const body = c.req.valid("json");
			const record = await store.updateLlmService(
				workspaceId,
				llmServiceId,
				body,
			);
			return c.json(toWireLlm(record), 200);
		},
	);

	app.openapi(
		createRoute({
			method: "delete",
			path: "/{workspaceId}/llm-services/{llmServiceId}",
			tags: ["llm-services"],
			summary: "Delete an LLM service",
			description:
				"Refuses with 409 if any agent in the workspace still references this service via `agent.llmServiceId`.",
			request: {
				params: z.object({
					workspaceId: WorkspaceIdParamSchema,
					llmServiceId: LlmServiceIdParamSchema,
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
					description: "Service is still referenced by an agent",
				},
			},
		}),
		async (c) => {
			const { workspaceId, llmServiceId } = c.req.valid("param");
			assertWorkspaceAccess(c, workspaceId);
			const { deleted } = await store.deleteLlmService(
				workspaceId,
				llmServiceId,
			);
			if (!deleted)
				throw new ControlPlaneNotFoundError("llm service", llmServiceId);
			return c.body(null, 204);
		},
	);

	return app;
}
