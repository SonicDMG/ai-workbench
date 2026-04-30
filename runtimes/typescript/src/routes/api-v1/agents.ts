/**
 * `/api/v1/workspaces/{workspaceId}/agents` — workspace-scoped agents.
 *
 * Callers create their own agents (with their own system prompt, KB
 * defaults, reranking preferences) and run conversations against
 * them. Conversation send-message routes (sync + streaming) live at
 * `.../agents/{a}/conversations/{c}/messages[/stream]` and use the
 * shared `chat/agent-dispatch.ts` helper for retrieval, prompt
 * assembly, and persistence.
 */

import { createRoute, type OpenAPIHono, z } from "@hono/zod-openapi";
import { streamSSE } from "hono/streaming";
import { assertWorkspaceAccess } from "../../auth/authz.js";
import {
	dispatchAgentSend,
	dispatchAgentSendStream,
} from "../../chat/agent-dispatch.js";
import type { ChatService } from "../../chat/types.js";
import type { ChatConfig } from "../../config/schema.js";
import { ControlPlaneNotFoundError } from "../../control-plane/errors.js";
import type { ControlPlaneStore } from "../../control-plane/store.js";
import type {
	AgentRecord,
	ConversationRecord,
} from "../../control-plane/types.js";
import type { VectorStoreDriverRegistry } from "../../drivers/registry.js";
import type { EmbedderFactory } from "../../embeddings/factory.js";
import { ApiError } from "../../lib/errors.js";
import { logger } from "../../lib/logger.js";
import { makeOpenApi } from "../../lib/openapi.js";
import { paginate } from "../../lib/pagination.js";
import type { AppEnv } from "../../lib/types.js";
import {
	AgentIdParamSchema,
	AgentPageSchema,
	AgentRecordSchema,
	ChatMessagePageSchema,
	ConversationIdParamSchema,
	ConversationPageSchema,
	ConversationRecordSchema,
	CreateAgentInputSchema,
	CreateConversationInputSchema,
	ErrorEnvelopeSchema,
	PaginationQuerySchema,
	SendChatMessageInputSchema,
	SendChatMessageResponseSchema,
	UpdateAgentInputSchema,
	UpdateConversationInputSchema,
	WorkspaceIdParamSchema,
} from "../../openapi/schemas.js";
import type { SecretResolver } from "../../secrets/provider.js";
import {
	toWireAgent as toAgentWire,
	toWireChatMessage as toChatMessageWire,
	toWireConversation as toConversationWire,
} from "./serdes/index.js";

// Wire converters live in `serdes/agent.ts`. Aliased to the legacy
// names below to keep the call sites in this file untouched.

export interface AgentRouteDeps {
	readonly store: ControlPlaneStore;
	readonly drivers: VectorStoreDriverRegistry;
	readonly embedders: EmbedderFactory;
	readonly secrets: SecretResolver;
	/** `null` when the runtime was booted without a `chat` config block. */
	readonly chatService: ChatService | null;
	/** Mirrors the runtime config; controls retrieval / persona defaults. */
	readonly chatConfig: ChatConfig | null;
}

export function agentRoutes(deps: AgentRouteDeps): OpenAPIHono<AppEnv> {
	const { store, drivers, embedders, secrets, chatService, chatConfig } = deps;
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

	/* ---------------- Conversation messages (per agent) ---------------- */

	/**
	 * Resolve `(workspaceId, agentId, conversationId)` with consistency
	 * checks. Returns `null` when any link is missing or when the
	 * conversation belongs to a different agent — callers translate
	 * `null` into a clean 404.
	 *
	 * Centralised here so the three message routes (list / send /
	 * stream) share identical error responses. The store-level
	 * `getConversation` already filters by agent, but we still fetch
	 * the agent record explicitly so the dispatcher receives a
	 * concrete `AgentRecord` for prompt + service resolution.
	 */
	async function resolveAgentConversation(
		workspaceId: string,
		agentId: string,
		conversationId: string,
	): Promise<{
		readonly agent: AgentRecord;
		readonly conversation: ConversationRecord;
	} | null> {
		const agent = await store.getAgent(workspaceId, agentId);
		if (!agent) return null;
		const conversation = await store.getConversation(
			workspaceId,
			agentId,
			conversationId,
		);
		if (!conversation) return null;
		// Defense-in-depth: store already partitions by agent, but this
		// keeps the route layer self-consistent if the underlying schema
		// ever changes.
		if (conversation.agentId !== agentId) return null;
		return { agent, conversation };
	}

	app.openapi(
		createRoute({
			method: "get",
			path: "/{workspaceId}/agents/{agentId}/conversations/{conversationId}/messages",
			tags: ["agents"],
			summary: "List conversation messages (oldest-first)",
			request: {
				params: z.object({
					workspaceId: WorkspaceIdParamSchema,
					agentId: AgentIdParamSchema,
					conversationId: ConversationIdParamSchema,
				}),
				query: PaginationQuerySchema,
			},
			responses: {
				200: {
					content: { "application/json": { schema: ChatMessagePageSchema } },
					description: "Messages, oldest-first",
				},
				404: {
					content: { "application/json": { schema: ErrorEnvelopeSchema } },
					description: "Workspace, agent, or conversation not found",
				},
			},
		}),
		async (c) => {
			const { workspaceId, agentId, conversationId } = c.req.valid("param");
			const query = c.req.valid("query");
			assertWorkspaceAccess(c, workspaceId);
			const resolved = await resolveAgentConversation(
				workspaceId,
				agentId,
				conversationId,
			);
			if (!resolved) {
				throw new ControlPlaneNotFoundError("conversation", conversationId);
			}
			const rows = await store.listChatMessages(workspaceId, conversationId);
			return c.json(paginate(rows.map(toChatMessageWire), query), 200);
		},
	);

	app.openapi(
		createRoute({
			method: "post",
			path: "/{workspaceId}/agents/{agentId}/conversations/{conversationId}/messages",
			tags: ["agents"],
			summary: "Send a user message and get the agent's reply",
			description:
				"Persists the user turn, retrieves grounding context using the conversation's (or agent's) knowledge bases, calls the agent's LLM service (or the runtime's global chat service when the agent has no `llmServiceId`), and persists the assistant turn. Returns both messages so the UI can replace any optimistic stub.",
			request: {
				params: z.object({
					workspaceId: WorkspaceIdParamSchema,
					agentId: AgentIdParamSchema,
					conversationId: ConversationIdParamSchema,
				}),
				body: {
					content: {
						"application/json": { schema: SendChatMessageInputSchema },
					},
				},
			},
			responses: {
				201: {
					content: {
						"application/json": { schema: SendChatMessageResponseSchema },
					},
					description: "User and assistant messages persisted",
				},
				404: {
					content: { "application/json": { schema: ErrorEnvelopeSchema } },
					description: "Workspace, agent, or conversation not found",
				},
				422: {
					content: { "application/json": { schema: ErrorEnvelopeSchema } },
					description:
						"Agent's llm service is misconfigured (e.g. unsupported provider)",
				},
				503: {
					content: { "application/json": { schema: ErrorEnvelopeSchema } },
					description:
						"Runtime has no chat service configured AND the agent has no llmServiceId.",
				},
			},
		}),
		async (c) => {
			const { workspaceId, agentId, conversationId } = c.req.valid("param");
			assertWorkspaceAccess(c, workspaceId);
			const resolved = await resolveAgentConversation(
				workspaceId,
				agentId,
				conversationId,
			);
			if (!resolved) {
				throw new ControlPlaneNotFoundError("conversation", conversationId);
			}
			// Without an executor (no global chatService AND no per-agent
			// llmServiceId) we cannot generate a reply. 503 with a
			// `chat_disabled` envelope advertises why.
			if (!chatService && !resolved.agent.llmServiceId) {
				throw new ApiError(
					"chat_disabled",
					"this runtime has no chat service configured and the agent has no llmServiceId; set `chat:` in workbench.yaml or attach an llm service to the agent",
					503,
				);
			}
			const body = c.req.valid("json");
			const { user, assistant } = await dispatchAgentSend(
				{
					store,
					drivers,
					embedders,
					secrets,
					logger,
					chatService,
					chatConfig,
				},
				{
					workspaceId,
					agent: resolved.agent,
					conversation: resolved.conversation,
				},
				{ content: body.content },
			);
			return c.json(
				{
					user: toChatMessageWire(user),
					assistant: toChatMessageWire(assistant),
				},
				201,
			);
		},
	);

	// SSE streaming variant of POST /messages. Emits the canonical
	// persisted user turn first, then a `token` event per delta, then
	// a single terminal `done` (or `error`) carrying the persisted
	// assistant row.
	app.post(
		"/:workspaceId/agents/:agentId/conversations/:conversationId/messages/stream",
		async (c) => {
			const workspaceId = c.req.param("workspaceId");
			const agentId = c.req.param("agentId");
			const conversationId = c.req.param("conversationId");
			assertWorkspaceAccess(c, workspaceId);
			const resolved = await resolveAgentConversation(
				workspaceId,
				agentId,
				conversationId,
			);
			if (!resolved) {
				throw new ControlPlaneNotFoundError("conversation", conversationId);
			}
			if (!chatService && !resolved.agent.llmServiceId) {
				throw new ApiError(
					"chat_disabled",
					"this runtime has no chat service configured and the agent has no llmServiceId; set `chat:` in workbench.yaml or attach an llm service to the agent",
					503,
				);
			}
			const body = await c.req.json<{ content?: unknown }>();
			if (
				typeof body?.content !== "string" ||
				body.content.trim().length === 0
			) {
				throw new ApiError(
					"validation_error",
					"`content` must be a non-empty string",
					400,
				);
			}
			const userContent = body.content;

			return streamSSE(c, async (stream) => {
				await dispatchAgentSendStream(
					{
						store,
						drivers,
						embedders,
						secrets,
						logger,
						chatService,
						chatConfig,
					},
					{
						workspaceId,
						agent: resolved.agent,
						conversation: resolved.conversation,
					},
					{ content: userContent },
					{
						writeSSE: (event) => stream.writeSSE(event),
						onAbort: (handler) => stream.onAbort(handler),
					},
					{
						serializeUserMessage: (record) =>
							JSON.stringify(toChatMessageWire(record)),
						serializeAssistantMessage: (record) =>
							JSON.stringify(toChatMessageWire(record)),
					},
				);
			});
		},
	);

	return app;
}
