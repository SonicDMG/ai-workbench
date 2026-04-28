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
import { assemblePrompt } from "../../chat/prompt.js";
import { retrieveContext } from "../../chat/retrieval.js";
import type { ChatService } from "../../chat/types.js";
import type { ChatConfig } from "../../config/schema.js";
import {
	BOBBIE_SYSTEM_PROMPT,
	bobbieAgentId,
} from "../../control-plane/defaults.js";
import { ControlPlaneNotFoundError } from "../../control-plane/errors.js";
import type { ControlPlaneStore } from "../../control-plane/store.js";
import type {
	ConversationRecord,
	MessageRecord,
} from "../../control-plane/types.js";
import type { VectorStoreDriverRegistry } from "../../drivers/registry.js";
import type { EmbedderFactory } from "../../embeddings/factory.js";
import { ApiError } from "../../lib/errors.js";
import { logger } from "../../lib/logger.js";
import { makeOpenApi } from "../../lib/openapi.js";
import { paginate } from "../../lib/pagination.js";
import type { AppEnv } from "../../lib/types.js";
import {
	ChatIdParamSchema,
	ChatMessagePageSchema,
	ChatPageSchema,
	ChatRecordSchema,
	CreateChatInputSchema,
	ErrorEnvelopeSchema,
	PaginationQuerySchema,
	SendChatMessageInputSchema,
	SendChatMessageResponseSchema,
	UpdateChatInputSchema,
	WorkspaceIdParamSchema,
} from "../../openapi/schemas.js";

export interface ChatRouteDeps {
	readonly store: ControlPlaneStore;
	readonly drivers: VectorStoreDriverRegistry;
	readonly embedders: EmbedderFactory;
	/** `null` when the runtime was booted without a `chat` config block. */
	readonly chatService: ChatService | null;
	/** Mirrors the runtime config; controls retrieval / persona behavior. */
	readonly chatConfig: ChatConfig | null;
}

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

export function chatRoutes(deps: ChatRouteDeps): OpenAPIHono<AppEnv> {
	const { store, drivers, embedders, chatService, chatConfig } = deps;
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
			summary: "Send a user message and get Bobbie's reply",
			description:
				"Persists the user turn, retrieves grounding context from the conversation's knowledge bases, calls the configured chat-completion model, and persists the assistant turn. Returns both messages so the UI can replace any optimistic stub. Phase 5 will convert this to a token-by-token SSE stream.",
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
						"application/json": { schema: SendChatMessageResponseSchema },
					},
					description: "User and assistant messages persisted",
				},
				404: {
					content: { "application/json": { schema: ErrorEnvelopeSchema } },
					description: "Workspace or chat not found",
				},
				503: {
					content: { "application/json": { schema: ErrorEnvelopeSchema } },
					description:
						"Chat is not configured on this runtime (no `chat` block in workbench.yaml).",
				},
			},
		}),
		async (c) => {
			const { workspaceId, chatId } = c.req.valid("param");
			assertWorkspaceAccess(c, workspaceId);
			if (!chatService || !chatConfig) {
				throw new ApiError(
					"chat_disabled",
					"chat is not configured on this runtime; set the `chat` block in workbench.yaml",
					503,
				);
			}
			const body = c.req.valid("json");

			// Resolve the conversation up front so retrieval and history
			// pulls share the same view; also surfaces a clean 404 if the
			// chat doesn't exist before we spend retrieval cycles.
			const chat = await store.getChat(workspaceId, chatId);
			if (!chat) {
				throw new ControlPlaneNotFoundError("chat", chatId);
			}

			// 1) Persist the user turn.
			const userRecord = await store.appendChatMessage(workspaceId, chatId, {
				role: "user",
				content: body.content,
			});

			// 2) Retrieve grounding context. Failures inside individual
			// KBs are swallowed by retrieveContext (logged + skipped), so
			// at worst Bobbie answers without grounding.
			const chunks = await retrieveContext(
				{ store, drivers, embedders, logger },
				{
					workspaceId,
					knowledgeBaseIds: chat.knowledgeBaseIds,
					query: body.content,
					retrievalK: chatConfig.retrievalK,
				},
			);

			// 3) Build the model-facing prompt from history + new turn.
			const history = await store.listChatMessages(workspaceId, chatId);
			// Filter out the just-appended user turn so the prompt-
			// assembler doesn't double-count it (history.userTurn is
			// still passed separately as the new user role at the end).
			const priorHistory = history.filter(
				(m) => m.messageId !== userRecord.messageId,
			);
			const prompt = assemblePrompt({
				systemPrompt: chatConfig.systemPrompt ?? BOBBIE_SYSTEM_PROMPT,
				chunks,
				history: priorHistory,
				userTurn: body.content,
			});

			// 4) Call the model. The service is responsible for converting
			// transport errors into a `finishReason: "error"` outcome —
			// we don't try/catch here because we still want to persist the
			// failure as an assistant row.
			const completion = await chatService.complete({ messages: prompt });

			// 5) Persist the assistant turn with provenance. Force its
			// `messageTs` strictly after the user's so the cluster-key
			// ordering is unambiguous — the column has ms resolution
			// and a fast model can finish within the same millisecond
			// the user was stamped, which would otherwise leave the
			// turn order to a random-UUID tiebreaker.
			const userTs = Date.parse(userRecord.messageTs);
			const assistantTs = new Date(
				Math.max(userTs + 1, Date.now()),
			).toISOString();
			const assistantRecord = await store.appendChatMessage(
				workspaceId,
				chatId,
				{
					role: "agent",
					authorId: bobbieAgentId(workspaceId),
					messageTs: assistantTs,
					content:
						completion.finishReason === "error"
							? (completion.errorMessage ?? "Bobbie couldn't answer this turn.")
							: completion.content,
					tokenCount: completion.tokenCount,
					metadata: buildMetadata(chunks, chatService.modelId, completion),
				},
			);

			return c.json(
				{
					user: toChatMessageWire(userRecord),
					assistant: toChatMessageWire(assistantRecord),
				},
				201,
			);
		},
	);

	return app;
}

function buildMetadata(
	chunks: readonly { chunkId: string }[],
	model: string,
	completion: {
		finishReason: "stop" | "length" | "error";
		errorMessage: string | null;
	},
): Record<string, string> {
	const metadata: Record<string, string> = {
		model,
		finish_reason: completion.finishReason,
	};
	if (chunks.length > 0) {
		metadata.context_document_ids = chunks.map((c) => c.chunkId).join(",");
	}
	if (completion.errorMessage) {
		metadata.error_message = completion.errorMessage;
	}
	return metadata;
}
