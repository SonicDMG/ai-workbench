/**
 * `/api/v1/workspaces/{workspaceId}/agents` — workspace-scoped agents.
 *
 * Generalises the Bobbie chat surface: callers can create their own
 * agents (with their own system prompt, KB defaults, reranking
 * preferences) and run conversations against them. The chat surface
 * (`/chats`) stays as a thin Bobbie alias over the same underlying
 * tables; deleting Bobbie via this surface is allowed but the next
 * `ensureBobbieAgent` call (or any `/chats` send) will recreate it.
 *
 * Conversation send-message routes (sync + streaming) are NOT included
 * here yet — they'd duplicate the chat-5 SSE machinery. The follow-up
 * PR generalises the chat send path to take an `(agentId, agent)`
 * pair and exposes both `/chats` and `/agents/{a}/conversations` over
 * the same handler.
 */

import { createRoute, type OpenAPIHono, z } from "@hono/zod-openapi";
import { assertWorkspaceAccess } from "../../auth/authz.js";
import { ControlPlaneNotFoundError } from "../../control-plane/errors.js";
import type { ControlPlaneStore } from "../../control-plane/store.js";
import type {
	AgentRecord,
	ConversationRecord,
} from "../../control-plane/types.js";
import { makeOpenApi } from "../../lib/openapi.js";
import { paginate } from "../../lib/pagination.js";
import type { AppEnv } from "../../lib/types.js";
import {
	AgentIdParamSchema,
	AgentPageSchema,
	AgentRecordSchema,
	ConversationIdParamSchema,
	ConversationPageSchema,
	ConversationRecordSchema,
	CreateAgentInputSchema,
	CreateConversationInputSchema,
	ErrorEnvelopeSchema,
	PaginationQuerySchema,
	UpdateAgentInputSchema,
	UpdateConversationInputSchema,
	WorkspaceIdParamSchema,
} from "../../openapi/schemas.js";

interface AgentWire {
	workspaceId: string;
	agentId: string;
	name: string;
	description: string | null;
	systemPrompt: string | null;
	userPrompt: string | null;
	knowledgeBaseIds: string[];
	ragEnabled: boolean;
	ragMaxResults: number | null;
	ragMinScore: number | null;
	rerankEnabled: boolean;
	rerankingServiceId: string | null;
	rerankMaxResults: number | null;
	createdAt: string;
	updatedAt: string;
}

interface ConversationWire {
	workspaceId: string;
	agentId: string;
	conversationId: string;
	title: string | null;
	knowledgeBaseIds: string[];
	createdAt: string;
}

function toAgentWire(record: AgentRecord): AgentWire {
	return {
		workspaceId: record.workspaceId,
		agentId: record.agentId,
		name: record.name,
		description: record.description,
		systemPrompt: record.systemPrompt,
		userPrompt: record.userPrompt,
		knowledgeBaseIds: [...record.knowledgeBaseIds],
		ragEnabled: record.ragEnabled,
		ragMaxResults: record.ragMaxResults,
		ragMinScore: record.ragMinScore,
		rerankEnabled: record.rerankEnabled,
		rerankingServiceId: record.rerankingServiceId,
		rerankMaxResults: record.rerankMaxResults,
		createdAt: record.createdAt,
		updatedAt: record.updatedAt,
	};
}

function toConversationWire(record: ConversationRecord): ConversationWire {
	return {
		workspaceId: record.workspaceId,
		agentId: record.agentId,
		conversationId: record.conversationId,
		title: record.title,
		knowledgeBaseIds: [...record.knowledgeBaseIds],
		createdAt: record.createdAt,
	};
}

export function agentRoutes(deps: {
	readonly store: ControlPlaneStore;
}): OpenAPIHono<AppEnv> {
	const { store } = deps;
	const app = makeOpenApi();

	/* ---------------- Agent CRUD ---------------- */

	app.openapi(
		createRoute({
			method: "get",
			path: "/{workspaceId}/agents",
			tags: ["agents"],
			summary: "List agents in a workspace",
			request: {
				params: z.object({ workspaceId: WorkspaceIdParamSchema }),
				query: PaginationQuerySchema,
			},
			responses: {
				200: {
					content: { "application/json": { schema: AgentPageSchema } },
					description: "All agents in the workspace, oldest-first",
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
			const rows = await store.listAgents(workspaceId);
			return c.json(paginate(rows.map(toAgentWire), query), 200);
		},
	);

	app.openapi(
		createRoute({
			method: "post",
			path: "/{workspaceId}/agents",
			tags: ["agents"],
			summary: "Create a new agent",
			request: {
				params: z.object({ workspaceId: WorkspaceIdParamSchema }),
				body: {
					content: {
						"application/json": { schema: CreateAgentInputSchema },
					},
				},
			},
			responses: {
				201: {
					content: { "application/json": { schema: AgentRecordSchema } },
					description: "Agent created",
				},
				404: {
					content: { "application/json": { schema: ErrorEnvelopeSchema } },
					description: "Workspace not found",
				},
				409: {
					content: { "application/json": { schema: ErrorEnvelopeSchema } },
					description: "Duplicate agentId",
				},
			},
		}),
		async (c) => {
			const { workspaceId } = c.req.valid("param");
			assertWorkspaceAccess(c, workspaceId);
			const body = c.req.valid("json");
			const record = await store.createAgent(workspaceId, body);
			return c.json(toAgentWire(record), 201);
		},
	);

	app.openapi(
		createRoute({
			method: "get",
			path: "/{workspaceId}/agents/{agentId}",
			tags: ["agents"],
			summary: "Get an agent",
			request: {
				params: z.object({
					workspaceId: WorkspaceIdParamSchema,
					agentId: AgentIdParamSchema,
				}),
			},
			responses: {
				200: {
					content: { "application/json": { schema: AgentRecordSchema } },
					description: "Agent",
				},
				404: {
					content: { "application/json": { schema: ErrorEnvelopeSchema } },
					description: "Workspace or agent not found",
				},
			},
		}),
		async (c) => {
			const { workspaceId, agentId } = c.req.valid("param");
			assertWorkspaceAccess(c, workspaceId);
			const record = await store.getAgent(workspaceId, agentId);
			if (!record) {
				throw new ControlPlaneNotFoundError("agent", agentId);
			}
			return c.json(toAgentWire(record), 200);
		},
	);

	app.openapi(
		createRoute({
			method: "patch",
			path: "/{workspaceId}/agents/{agentId}",
			tags: ["agents"],
			summary: "Update an agent",
			request: {
				params: z.object({
					workspaceId: WorkspaceIdParamSchema,
					agentId: AgentIdParamSchema,
				}),
				body: {
					content: {
						"application/json": { schema: UpdateAgentInputSchema },
					},
				},
			},
			responses: {
				200: {
					content: { "application/json": { schema: AgentRecordSchema } },
					description: "Updated agent",
				},
				404: {
					content: { "application/json": { schema: ErrorEnvelopeSchema } },
					description: "Workspace or agent not found",
				},
			},
		}),
		async (c) => {
			const { workspaceId, agentId } = c.req.valid("param");
			assertWorkspaceAccess(c, workspaceId);
			const body = c.req.valid("json");
			const record = await store.updateAgent(workspaceId, agentId, body);
			return c.json(toAgentWire(record), 200);
		},
	);

	app.openapi(
		createRoute({
			method: "delete",
			path: "/{workspaceId}/agents/{agentId}",
			tags: ["agents"],
			summary: "Delete an agent (cascades conversations + messages)",
			request: {
				params: z.object({
					workspaceId: WorkspaceIdParamSchema,
					agentId: AgentIdParamSchema,
				}),
			},
			responses: {
				204: { description: "Deleted" },
				404: {
					content: { "application/json": { schema: ErrorEnvelopeSchema } },
					description: "Workspace or agent not found",
				},
			},
		}),
		async (c) => {
			const { workspaceId, agentId } = c.req.valid("param");
			assertWorkspaceAccess(c, workspaceId);
			const { deleted } = await store.deleteAgent(workspaceId, agentId);
			if (!deleted) {
				throw new ControlPlaneNotFoundError("agent", agentId);
			}
			return c.body(null, 204);
		},
	);

	/* ---------------- Conversation CRUD ---------------- */

	app.openapi(
		createRoute({
			method: "get",
			path: "/{workspaceId}/agents/{agentId}/conversations",
			tags: ["agents"],
			summary: "List conversations for an agent",
			request: {
				params: z.object({
					workspaceId: WorkspaceIdParamSchema,
					agentId: AgentIdParamSchema,
				}),
				query: PaginationQuerySchema,
			},
			responses: {
				200: {
					content: { "application/json": { schema: ConversationPageSchema } },
					description: "Conversations, newest-first",
				},
				404: {
					content: { "application/json": { schema: ErrorEnvelopeSchema } },
					description: "Workspace not found",
				},
			},
		}),
		async (c) => {
			const { workspaceId, agentId } = c.req.valid("param");
			const query = c.req.valid("query");
			assertWorkspaceAccess(c, workspaceId);
			const rows = await store.listConversations(workspaceId, agentId);
			return c.json(paginate(rows.map(toConversationWire), query), 200);
		},
	);

	app.openapi(
		createRoute({
			method: "post",
			path: "/{workspaceId}/agents/{agentId}/conversations",
			tags: ["agents"],
			summary: "Start a new conversation against an agent",
			request: {
				params: z.object({
					workspaceId: WorkspaceIdParamSchema,
					agentId: AgentIdParamSchema,
				}),
				body: {
					content: {
						"application/json": { schema: CreateConversationInputSchema },
					},
				},
			},
			responses: {
				201: {
					content: { "application/json": { schema: ConversationRecordSchema } },
					description: "Conversation created",
				},
				404: {
					content: { "application/json": { schema: ErrorEnvelopeSchema } },
					description: "Workspace or agent not found",
				},
				409: {
					content: { "application/json": { schema: ErrorEnvelopeSchema } },
					description: "Duplicate conversationId",
				},
			},
		}),
		async (c) => {
			const { workspaceId, agentId } = c.req.valid("param");
			assertWorkspaceAccess(c, workspaceId);
			const body = c.req.valid("json");
			const record = await store.createConversation(workspaceId, agentId, body);
			return c.json(toConversationWire(record), 201);
		},
	);

	app.openapi(
		createRoute({
			method: "get",
			path: "/{workspaceId}/agents/{agentId}/conversations/{conversationId}",
			tags: ["agents"],
			summary: "Get a conversation",
			request: {
				params: z.object({
					workspaceId: WorkspaceIdParamSchema,
					agentId: AgentIdParamSchema,
					conversationId: ConversationIdParamSchema,
				}),
			},
			responses: {
				200: {
					content: { "application/json": { schema: ConversationRecordSchema } },
					description: "Conversation",
				},
				404: {
					content: { "application/json": { schema: ErrorEnvelopeSchema } },
					description: "Workspace, agent, or conversation not found",
				},
			},
		}),
		async (c) => {
			const { workspaceId, agentId, conversationId } = c.req.valid("param");
			assertWorkspaceAccess(c, workspaceId);
			const record = await store.getConversation(
				workspaceId,
				agentId,
				conversationId,
			);
			if (!record) {
				throw new ControlPlaneNotFoundError("conversation", conversationId);
			}
			return c.json(toConversationWire(record), 200);
		},
	);

	app.openapi(
		createRoute({
			method: "patch",
			path: "/{workspaceId}/agents/{agentId}/conversations/{conversationId}",
			tags: ["agents"],
			summary: "Update a conversation (title, KB filter)",
			request: {
				params: z.object({
					workspaceId: WorkspaceIdParamSchema,
					agentId: AgentIdParamSchema,
					conversationId: ConversationIdParamSchema,
				}),
				body: {
					content: {
						"application/json": { schema: UpdateConversationInputSchema },
					},
				},
			},
			responses: {
				200: {
					content: { "application/json": { schema: ConversationRecordSchema } },
					description: "Updated conversation",
				},
				404: {
					content: { "application/json": { schema: ErrorEnvelopeSchema } },
					description: "Workspace, agent, or conversation not found",
				},
			},
		}),
		async (c) => {
			const { workspaceId, agentId, conversationId } = c.req.valid("param");
			assertWorkspaceAccess(c, workspaceId);
			const body = c.req.valid("json");
			const record = await store.updateConversation(
				workspaceId,
				agentId,
				conversationId,
				body,
			);
			return c.json(toConversationWire(record), 200);
		},
	);

	app.openapi(
		createRoute({
			method: "delete",
			path: "/{workspaceId}/agents/{agentId}/conversations/{conversationId}",
			tags: ["agents"],
			summary: "Delete a conversation (cascades messages)",
			request: {
				params: z.object({
					workspaceId: WorkspaceIdParamSchema,
					agentId: AgentIdParamSchema,
					conversationId: ConversationIdParamSchema,
				}),
			},
			responses: {
				204: { description: "Deleted" },
				404: {
					content: { "application/json": { schema: ErrorEnvelopeSchema } },
					description: "Workspace, agent, or conversation not found",
				},
			},
		}),
		async (c) => {
			const { workspaceId, agentId, conversationId } = c.req.valid("param");
			assertWorkspaceAccess(c, workspaceId);
			const { deleted } = await store.deleteConversation(
				workspaceId,
				agentId,
				conversationId,
			);
			if (!deleted) {
				throw new ControlPlaneNotFoundError("conversation", conversationId);
			}
			return c.body(null, 204);
		},
	);

	return app;
}
