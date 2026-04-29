/**
 * Model Context Protocol server façade.
 *
 * Each request to `/api/v1/workspaces/{workspaceId}/mcp` constructs
 * a fresh {@link McpServer} and {@link WebStandardStreamableHTTPServerTransport}
 * pair scoped to that workspace, and hands the call off to the
 * MCP SDK. Stateless — no session state survives between requests.
 *
 * The tools exposed are deliberately a subset of the full HTTP API:
 *
 *   - `list_knowledge_bases`   read-only KB metadata
 *   - `list_documents`         paginated documents in a KB
 *   - `search_kb`              vector / hybrid / rerank search
 *   - `list_chats`             chat thread metadata
 *   - `list_chat_messages`     turn-by-turn chat history
 *   - `chat_send`              optional, gated on `mcp.exposeChat`
 *                              + `chat` config; runs Bobbie and
 *                              returns the reply as a single text
 *                              block (streaming would require MCP
 *                              progress notifications which most
 *                              clients don't surface yet)
 *
 * Auth is the same as every other `/api/v1/workspaces/*` route: the
 * route handler runs `assertWorkspaceAccess(c, workspaceId)` before
 * invoking any tool, so a scoped API key for workspace A cannot
 * call MCP tools against workspace B even if they have the URL.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { z } from "zod";
import { assemblePrompt } from "../chat/prompt.js";
import { retrieveContext } from "../chat/retrieval.js";
import type { ChatService } from "../chat/types.js";
import type { ChatConfig } from "../config/schema.js";
import { BOBBIE_SYSTEM_PROMPT } from "../control-plane/defaults.js";
import type { ControlPlaneStore } from "../control-plane/store.js";
import type { VectorStoreDriverRegistry } from "../drivers/registry.js";
import type { EmbedderFactory } from "../embeddings/factory.js";
import { logger } from "../lib/logger.js";
import { resolveKb } from "../routes/api-v1/kb-descriptor.js";
import { dispatchSearch } from "../routes/api-v1/search-dispatch.js";
import { VERSION } from "../version.js";

export interface McpServerDeps {
	readonly store: ControlPlaneStore;
	readonly drivers: VectorStoreDriverRegistry;
	readonly embedders: EmbedderFactory;
	readonly chatService: ChatService | null;
	readonly chatConfig: ChatConfig | null;
	readonly exposeChat: boolean;
}

export interface McpHandleRequestArgs {
	readonly workspaceId: string;
	readonly request: Request;
	readonly deps: McpServerDeps;
}

/**
 * Run a single MCP request to completion. The transport handles
 * `initialize`, `tools/list`, `tools/call`, etc. — we just register
 * the tools and let the SDK route.
 *
 * Cleanup lifecycle: `transport.handleRequest()` returns the
 * `Response(readable, …)` shell **synchronously** while the SDK
 * still has to async-process the message and pipe the JSON-RPC
 * reply into the stream via `transport.send()`. A `finally` block
 * around `handleRequest` would call `transport.close()` (which
 * closes every open stream controller) before the SDK had a chance
 * to write the response — yielding `Content-Length: 0` on the
 * wire. Instead, we wrap the body in a TransformStream and run
 * cleanup from its `flush` / `cancel` hooks, which fire after the
 * SDK has finished sending or the client has disconnected.
 *
 * For non-streaming responses (e.g. JSON-RPC error envelopes that
 * the SDK returns directly), we still need to close the transport
 * — those Responses have a non-stream body and the wrapping is a
 * no-op, so we close on the next microtask.
 */
export async function handleMcpRequest(
	args: McpHandleRequestArgs,
): Promise<Response> {
	const server = buildMcpServer(args.workspaceId, args.deps);
	const transport = new WebStandardStreamableHTTPServerTransport({
		// Stateless — every request is a fresh server instance, no
		// per-client session ID to track.
		sessionIdGenerator: undefined,
	});
	await server.connect(transport);

	const cleanup = async (): Promise<void> => {
		await transport.close().catch(() => {});
		await server.close().catch(() => {});
	};

	let response: Response;
	try {
		response = await transport.handleRequest(args.request);
	} catch (error) {
		await cleanup();
		throw error;
	}

	// No body to drain — close immediately on the microtask queue so
	// the empty Response is delivered first, then the transport is
	// torn down.
	if (!response.body) {
		queueMicrotask(() => {
			void cleanup();
		});
		return response;
	}

	// Body is a stream (SSE or JSON written through a controller).
	// Pipe through a passthrough; cleanup runs when the stream
	// finishes naturally OR when the client cancels.
	const passthrough = new TransformStream({
		flush() {
			void cleanup();
		},
		// `cancel` runs when the consumer (Hono → Node adapter →
		// network) tears down the pipe early — e.g. client disconnect.
		// The TransformStream spec calls `cancel` on the writable side
		// in that case; mirror it on the readable side.
	});
	response.body
		.pipeTo(passthrough.writable)
		.catch(() => {
			// pipeTo rejects on cancel; cleanup is still required.
			void cleanup();
		});

	return new Response(passthrough.readable, {
		status: response.status,
		statusText: response.statusText,
		headers: response.headers,
	});
}

/**
 * Construct (but don't connect) the MCP server for a workspace.
 * Exported so tests can drive it through an `InMemoryTransport`
 * without going through HTTP.
 */
export function buildMcpServer(
	workspaceId: string,
	deps: McpServerDeps,
): McpServer {
	const server = new McpServer(
		{ name: `ai-workbench:${workspaceId}`, version: VERSION },
		{ capabilities: { tools: {}, resources: {} } },
	);

	server.registerTool(
		"list_knowledge_bases",
		{
			title: "List knowledge bases",
			description:
				"List the workspace's knowledge bases. Returns a JSON array of KB summaries (id, name, status, language, document counts implied by listing /documents per KB).",
			inputSchema: {},
		},
		async () => {
			const rows = await deps.store.listKnowledgeBases(workspaceId);
			const summary = rows.map((kb) => ({
				knowledgeBaseId: kb.knowledgeBaseId,
				name: kb.name,
				description: kb.description,
				status: kb.status,
				language: kb.language,
			}));
			return {
				content: [{ type: "text", text: JSON.stringify(summary, null, 2) }],
			};
		},
	);

	server.registerTool(
		"list_documents",
		{
			title: "List documents in a knowledge base",
			description:
				"Paginated document metadata for a single knowledge base. Use this to discover which sources Bobbie / your agent can ground on. Returns id, source filename, status, content hash, and chunk count.",
			inputSchema: {
				knowledgeBaseId: z.string().uuid(),
				limit: z.number().int().positive().max(200).optional(),
			},
		},
		async ({ knowledgeBaseId, limit }) => {
			const all = await deps.store.listRagDocuments(
				workspaceId,
				knowledgeBaseId,
			);
			const slice = limit ? all.slice(0, limit) : [...all];
			const summary = slice.map((d) => ({
				documentId: d.documentId,
				sourceFilename: d.sourceFilename,
				status: d.status,
				chunkTotal: d.chunkTotal,
				contentHash: d.contentHash,
				ingestedAt: d.ingestedAt,
			}));
			return {
				content: [{ type: "text", text: JSON.stringify(summary, null, 2) }],
			};
		},
	);

	server.registerTool(
		"search_kb",
		{
			title: "Search a knowledge base",
			description:
				"Run vector / hybrid / rerank search against a single knowledge base. Returns top-K hits with chunk id, score, document id, and chunk text. Use the same KB id from `list_knowledge_bases`. Provide `text` (most common) or a precomputed `vector`. Hybrid + rerank flags are optional and follow the descriptor's defaults when omitted.",
			inputSchema: {
				knowledgeBaseId: z.string().uuid(),
				text: z.string().min(1).optional(),
				vector: z.array(z.number()).optional(),
				topK: z.number().int().positive().max(64).optional(),
				hybrid: z.boolean().optional(),
				rerank: z.boolean().optional(),
			},
		},
		async ({ knowledgeBaseId, text, vector, topK, hybrid, rerank }) => {
			if (!text && !vector) {
				return {
					isError: true,
					content: [
						{
							type: "text",
							text: "Either `text` or `vector` must be supplied.",
						},
					],
				};
			}
			const ctx = await resolveKb(deps.store, workspaceId, knowledgeBaseId);
			const driver = deps.drivers.for(ctx.workspace);
			const hits = await dispatchSearch({
				ctx,
				driver,
				embedders: deps.embedders,
				body: { text, vector, topK, hybrid, rerank },
			});
			const summary = hits.map((h) => ({
				chunkId: h.id,
				score: h.score,
				documentId:
					typeof h.payload?.documentId === "string"
						? h.payload.documentId
						: null,
				content:
					typeof h.payload?.content === "string"
						? h.payload.content
						: typeof h.payload?.text === "string"
							? h.payload.text
							: null,
			}));
			return {
				content: [{ type: "text", text: JSON.stringify(summary, null, 2) }],
			};
		},
	);

	server.registerTool(
		"list_chats",
		{
			title: "List chats",
			description:
				"List Bobbie chats in the workspace. Useful when an external agent wants to read or audit prior conversations before adding to them.",
			inputSchema: {},
		},
		async () => {
			const rows = await deps.store.listChats(workspaceId);
			const summary = rows.map((c) => ({
				chatId: c.conversationId,
				title: c.title,
				knowledgeBaseIds: c.knowledgeBaseIds,
				createdAt: c.createdAt,
			}));
			return {
				content: [{ type: "text", text: JSON.stringify(summary, null, 2) }],
			};
		},
	);

	server.registerTool(
		"list_chat_messages",
		{
			title: "List chat messages",
			description:
				"Oldest-first message history for one chat. Returns role, content, timestamp, and (for assistant turns) RAG provenance metadata.",
			inputSchema: {
				chatId: z.string().uuid(),
			},
		},
		async ({ chatId }) => {
			const rows = await deps.store.listChatMessages(workspaceId, chatId);
			const summary = rows.map((m) => ({
				messageId: m.messageId,
				role: m.role,
				content: m.content,
				messageTs: m.messageTs,
				metadata: m.metadata,
			}));
			return {
				content: [{ type: "text", text: JSON.stringify(summary, null, 2) }],
			};
		},
	);

	if (deps.exposeChat && deps.chatService && deps.chatConfig) {
		registerChatTool(server, workspaceId, {
			...deps,
			chatService: deps.chatService,
			chatConfig: deps.chatConfig,
		});
	}

	return server;
}

interface ChatToolDeps extends McpServerDeps {
	readonly chatService: ChatService;
	readonly chatConfig: ChatConfig;
}

function registerChatTool(
	server: McpServer,
	workspaceId: string,
	deps: ChatToolDeps,
): void {
	server.registerTool(
		"chat_send",
		{
			title: "Send a chat message",
			description:
				"Persist a user turn in an existing chat, retrieve grounding context across the chat's KB filter, run the configured chat-completion model, persist Bobbie's reply, and return the assistant text. Returns the assistant content as a single text block (streaming via MCP progress isn't surfaced by most clients yet).",
			inputSchema: {
				chatId: z.string().uuid(),
				content: z.string().min(1).max(32_000),
			},
		},
		async ({ chatId, content }) => {
			const chat = await deps.store.getChat(workspaceId, chatId);
			if (!chat) {
				return {
					isError: true,
					content: [{ type: "text", text: `chat '${chatId}' not found` }],
				};
			}
			const userRecord = await deps.store.appendChatMessage(
				workspaceId,
				chatId,
				{ role: "user", content },
			);
			const chunks = await retrieveContext(
				{
					store: deps.store,
					drivers: deps.drivers,
					embedders: deps.embedders,
					logger,
				},
				{
					workspaceId,
					knowledgeBaseIds: chat.knowledgeBaseIds,
					query: content,
					retrievalK: deps.chatConfig.retrievalK,
				},
			);
			const history = await deps.store.listChatMessages(workspaceId, chatId);
			const prompt = assemblePrompt({
				systemPrompt: deps.chatConfig.systemPrompt ?? BOBBIE_SYSTEM_PROMPT,
				chunks,
				history,
				userTurn: content,
			});
			const completion = await deps.chatService.complete({ messages: prompt });
			const replyText =
				completion.finishReason === "error"
					? (completion.errorMessage ?? "Bobbie couldn't answer this turn.")
					: completion.content;
			// Force the assistant turn strictly after the user turn so the
			// `message_ts ASC` cluster ordering is unambiguous — the column
			// has ms resolution and a fast model can finish in the same
			// millisecond as the user append, which would otherwise leave
			// the order to a random-UUID tiebreaker.
			const userTs = Date.parse(userRecord.messageTs);
			const assistantTs = new Date(
				Math.max(userTs + 1, Date.now()),
			).toISOString();
			await deps.store.appendChatMessage(workspaceId, chatId, {
				role: "agent",
				messageTs: assistantTs,
				content: replyText,
				tokenCount: completion.tokenCount,
				metadata: {
					model: deps.chatService.modelId,
					finish_reason: completion.finishReason,
					...(chunks.length > 0 && {
						context_document_ids: chunks.map((c) => c.chunkId).join(","),
						context_chunks: JSON.stringify(
							chunks.map((c) => [c.chunkId, c.knowledgeBaseId, c.documentId]),
						),
					}),
					...(completion.errorMessage && {
						error_message: completion.errorMessage,
					}),
				},
			});
			return {
				isError: completion.finishReason === "error",
				content: [{ type: "text", text: replyText }],
			};
		},
	);
}
