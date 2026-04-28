/**
 * `/api/v1/workspaces/{workspaceId}/chats` — workspace-scoped Bobbie chats.
 *
 * Phase 3 of the chat-with-Bobbie roadmap: CRUD over conversations
 * and message history, **no HuggingFace integration and no SSE
 * streaming yet**. POSTing a message persists it as a `user` turn and
 * returns the row. Phase 4 wires HF retrieval and synchronous reply;
 * phase 5 converts that to an SSE token stream.
 *
 * Conversations are workspace-scoped (not KB-scoped) — see the
 * `knowledgeBaseIds` field on the chat row for the per-conversation
 * RAG-grounding set. Empty / omitted = Bobbie may draw from any KB
 * in the workspace at retrieval time.
 *
 * Wire-shape projection: routes talk `Chat` / `ChatMessage` (the
 * user-facing terms). Internally the store reads/writes the Stage-2
 * agentic tables — agent_id is hidden from the wire because v0 has
 * exactly one agent per workspace and surfacing it would leak
 * premature agent-management surface area.
 */

import { createRoute, type OpenAPIHono, z } from "@hono/zod-openapi";
import { assertWorkspaceAccess } from "../../auth/authz.js";
import { ControlPlaneNotFoundError } from "../../control-plane/errors.js";
import type { ControlPlaneStore } from "../../control-plane/store.js";
import type {
	ConversationRecord,
	MessageRecord,
} from "../../control-plane/types.js";
import { makeOpenApi } from "../../lib/openapi.js";
import { paginate } from "../../lib/pagination.js";
import type { AppEnv } from "../../lib/types.js";
import {
	ChatIdParamSchema,
	ChatMessagePageSchema,
	ChatMessageRecordSchema,
	ChatPageSchema,
	ChatRecordSchema,
	CreateChatInputSchema,
	ErrorEnvelopeSchema,
	PaginationQuerySchema,
	SendChatMessageInputSchema,
	UpdateChatInputSchema,
	WorkspaceIdParamSchema,
} from "../../openapi/schemas.js";

interface ChatWire {
	workspaceId: string;
	chatId: string;
	title: string | null;
	knowledgeBaseIds: string[];
	createdAt: string;
}

interface ChatMessageWire {
	workspaceId: string;
	chatId: string;
	messageId: string;
	messageTs: string;
	role: "user" | "agent" | "system";
	content: string | null;
	tokenCount: number | null;
	metadata: Record<string, string>;
}

function toChatWire(record: ConversationRecord): ChatWire {
	return {
		workspaceId: record.workspaceId,
		chatId: record.conversationId,
		title: record.title,
		knowledgeBaseIds: [...record.knowledgeBaseIds],
		createdAt: record.createdAt,
	};
}

function toChatMessageWire(record: MessageRecord): ChatMessageWire {
	// Internal `tool` role is filtered out — v0 chat doesn't surface
	// tool turns yet (no tools wired). Future agent-management UI can
	// expose them when they exist.
	const role: "user" | "agent" | "system" =
		record.role === "tool" ? "agent" : record.role;
	return {
		workspaceId: record.workspaceId,
		chatId: record.conversationId,
		messageId: record.messageId,
		messageTs: record.messageTs,
		role,
		content: record.content,
		tokenCount: record.tokenCount,
		metadata: { ...record.metadata },
	};
}

export function chatRoutes(store: ControlPlaneStore): OpenAPIHono<AppEnv> {
	const app = makeOpenApi();

	app.openapi(
		createRoute({
			method: "get",
			path: "/{workspaceId}/chats",
			tags: ["chats"],
			summary: "List chats in a workspace",
			request: {
				params: z.object({ workspaceId: WorkspaceIdParamSchema }),
				query: PaginationQuerySchema,
			},
			responses: {
				200: {
					content: { "application/json": { schema: ChatPageSchema } },
					description: "All chats in the workspace, newest-first",
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
			const rows = await store.listChats(workspaceId);
			return c.json(paginate(rows.map(toChatWire), query), 200);
		},
	);

	app.openapi(
		createRoute({
			method: "post",
			path: "/{workspaceId}/chats",
			tags: ["chats"],
			summary: "Start a new chat",
			request: {
				params: z.object({ workspaceId: WorkspaceIdParamSchema }),
				body: {
					content: {
						"application/json": { schema: CreateChatInputSchema },
					},
				},
			},
			responses: {
				201: {
					content: { "application/json": { schema: ChatRecordSchema } },
					description: "Chat created",
				},
				404: {
					content: { "application/json": { schema: ErrorEnvelopeSchema } },
					description: "Workspace not found",
				},
				409: {
					content: { "application/json": { schema: ErrorEnvelopeSchema } },
					description: "Duplicate chatId",
				},
			},
		}),
		async (c) => {
			const { workspaceId } = c.req.valid("param");
			assertWorkspaceAccess(c, workspaceId);
			const body = c.req.valid("json");
			const record = await store.createChat(workspaceId, {
				chatId: body.chatId,
				title: body.title ?? null,
				knowledgeBaseIds: body.knowledgeBaseIds,
			});
			return c.json(toChatWire(record), 201);
		},
	);

	app.openapi(
		createRoute({
			method: "get",
			path: "/{workspaceId}/chats/{chatId}",
			tags: ["chats"],
			summary: "Get a chat",
			request: {
				params: z.object({
					workspaceId: WorkspaceIdParamSchema,
					chatId: ChatIdParamSchema,
				}),
			},
			responses: {
				200: {
					content: { "application/json": { schema: ChatRecordSchema } },
					description: "Chat",
				},
				404: {
					content: { "application/json": { schema: ErrorEnvelopeSchema } },
					description: "Workspace or chat not found",
				},
			},
		}),
		async (c) => {
			const { workspaceId, chatId } = c.req.valid("param");
			assertWorkspaceAccess(c, workspaceId);
			const record = await store.getChat(workspaceId, chatId);
			if (!record) {
				throw new ControlPlaneNotFoundError("chat", chatId);
			}
			return c.json(toChatWire(record), 200);
		},
	);

	app.openapi(
		createRoute({
			method: "patch",
			path: "/{workspaceId}/chats/{chatId}",
			tags: ["chats"],
			summary: "Update a chat (title, KB filter)",
			request: {
				params: z.object({
					workspaceId: WorkspaceIdParamSchema,
					chatId: ChatIdParamSchema,
				}),
				body: {
					content: {
						"application/json": { schema: UpdateChatInputSchema },
					},
				},
			},
			responses: {
				200: {
					content: { "application/json": { schema: ChatRecordSchema } },
					description: "Updated chat",
				},
				404: {
					content: { "application/json": { schema: ErrorEnvelopeSchema } },
					description: "Workspace or chat not found",
				},
			},
		}),
		async (c) => {
			const { workspaceId, chatId } = c.req.valid("param");
			assertWorkspaceAccess(c, workspaceId);
			const body = c.req.valid("json");
			const record = await store.updateChat(workspaceId, chatId, body);
			return c.json(toChatWire(record), 200);
		},
	);

	app.openapi(
		createRoute({
			method: "delete",
			path: "/{workspaceId}/chats/{chatId}",
			tags: ["chats"],
			summary: "Delete a chat (cascades to messages)",
			request: {
				params: z.object({
					workspaceId: WorkspaceIdParamSchema,
					chatId: ChatIdParamSchema,
				}),
			},
			responses: {
				204: { description: "Deleted" },
				404: {
					content: { "application/json": { schema: ErrorEnvelopeSchema } },
					description: "Workspace or chat not found",
				},
			},
		}),
		async (c) => {
			const { workspaceId, chatId } = c.req.valid("param");
			assertWorkspaceAccess(c, workspaceId);
			const { deleted } = await store.deleteChat(workspaceId, chatId);
			if (!deleted) {
				throw new ControlPlaneNotFoundError("chat", chatId);
			}
			return c.body(null, 204);
		},
	);

	app.openapi(
		createRoute({
			method: "get",
			path: "/{workspaceId}/chats/{chatId}/messages",
			tags: ["chats"],
			summary: "List chat messages (oldest-first)",
			request: {
				params: z.object({
					workspaceId: WorkspaceIdParamSchema,
					chatId: ChatIdParamSchema,
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
					description: "Workspace or chat not found",
				},
			},
		}),
		async (c) => {
			const { workspaceId, chatId } = c.req.valid("param");
			const query = c.req.valid("query");
			assertWorkspaceAccess(c, workspaceId);
			const rows = await store.listChatMessages(workspaceId, chatId);
			return c.json(paginate(rows.map(toChatMessageWire), query), 200);
		},
	);

	app.openapi(
		createRoute({
			method: "post",
			path: "/{workspaceId}/chats/{chatId}/messages",
			tags: ["chats"],
			summary: "Send a user message",
			description:
				"Persists a user turn and echoes it back. v0 does not run the model — Bobbie's reply will land in a follow-up phase that wires HuggingFace + SSE streaming.",
			request: {
				params: z.object({
					workspaceId: WorkspaceIdParamSchema,
					chatId: ChatIdParamSchema,
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
						"application/json": { schema: ChatMessageRecordSchema },
					},
					description: "User message persisted",
				},
				404: {
					content: { "application/json": { schema: ErrorEnvelopeSchema } },
					description: "Workspace or chat not found",
				},
			},
		}),
		async (c) => {
			const { workspaceId, chatId } = c.req.valid("param");
			assertWorkspaceAccess(c, workspaceId);
			const body = c.req.valid("json");
			const record = await store.appendChatMessage(workspaceId, chatId, {
				role: "user",
				content: body.content,
			});
			return c.json(toChatMessageWire(record), 201);
		},
	);

	return app;
}
