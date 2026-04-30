/**
 * Shared dispatcher for the per-agent chat send/stream pipeline.
 *
 * Backs `/api/v1/workspaces/{w}/agents/{a}/conversations/{c}/messages`
 * for both the synchronous send and the SSE stream variants, providing
 * the same RAG retrieval + prompt-assembly + persistence shape.
 *
 * Resolution order for the per-turn effective values:
 *   - **System prompt**: `agent.systemPrompt` ?? `chatConfig.systemPrompt`
 *     ?? `DEFAULT_AGENT_SYSTEM_PROMPT`.
 *   - **KB scope**: `conversation.knowledgeBaseIds` if non-empty, else
 *     `agent.knowledgeBaseIds` if non-empty, else `[]` (the retrieval
 *     layer interprets `[]` as "all KBs in the workspace").
 *   - **Retrieval K**: `agent.ragMaxResults` ?? `chatConfig.retrievalK`
 *     ?? 6.
 *   - **Chat service**: when `agent.llmServiceId` is set, build a fresh
 *     `HuggingFaceChatService` from the workspace's `LlmServiceRecord`.
 *     Otherwise fall back to `deps.chatService` (the global runtime
 *     chat service). 422 if the service record points at a non-`huggingface`
 *     provider — the only adapter wired today.
 *
 * Persisted assistant `metadata.model` reflects the **resolved** chat
 * service's `modelId`, not the global runtime's, so audit logs are
 * per-turn accurate even when an agent overrides the model.
 */

import {
	HuggingFaceChatService,
	type HuggingFaceChatServiceOptions,
} from "../chat/huggingface.js";
import type { RetrievedChunk } from "../chat/prompt.js";
import { assemblePrompt } from "../chat/prompt.js";
import { retrieveContext } from "../chat/retrieval.js";
import type { ChatService, ChatStreamEvent } from "../chat/types.js";
import type { ChatConfig } from "../config/schema.js";
import { DEFAULT_AGENT_SYSTEM_PROMPT } from "../control-plane/defaults.js";
import { ControlPlaneNotFoundError } from "../control-plane/errors.js";
import type { ControlPlaneStore } from "../control-plane/store.js";
import type {
	AgentRecord,
	ConversationRecord,
	LlmServiceRecord,
	MessageRecord,
} from "../control-plane/types.js";
import type { VectorStoreDriverRegistry } from "../drivers/registry.js";
import type { EmbedderFactory } from "../embeddings/factory.js";
import { ApiError } from "../lib/errors.js";
import type { Logger } from "../lib/logger.js";
import type { SecretResolver } from "../secrets/provider.js";

const DEFAULT_RETRIEVAL_K = 6;
const DEFAULT_MAX_OUTPUT_TOKENS = 1024;

export interface AgentDispatchDeps {
	readonly store: ControlPlaneStore;
	readonly drivers: VectorStoreDriverRegistry;
	readonly embedders: EmbedderFactory;
	readonly secrets: SecretResolver;
	readonly logger: Pick<Logger, "warn" | "debug">;
	/** Global runtime chat service; used when the agent has no `llmServiceId`. */
	readonly chatService: ChatService | null;
	/** Mirrors the runtime config; controls retrieval / persona defaults. */
	readonly chatConfig: ChatConfig | null;
}

export interface AgentDispatchContext {
	readonly workspaceId: string;
	readonly agent: AgentRecord;
	readonly conversation: ConversationRecord;
}

export interface AgentDispatchBody {
	readonly content: string;
}

export interface AgentSendResult {
	readonly user: MessageRecord;
	readonly assistant: MessageRecord;
}

/**
 * SSE writer abstraction the agent stream dispatcher uses. Mirrors the
 * subset of Hono's `streamSSE` handle that we actually call: a writer
 * that sends typed `event` envelopes plus a one-shot abort hook the
 * route layer wires to client disconnects.
 */
export interface AgentSseWriter {
	writeSSE(event: { event: string; data: string }): Promise<void>;
	onAbort(handler: () => void): void;
}

/* ------------------------------------------------------------------ */
/* Effective-config resolution                                        */
/* ------------------------------------------------------------------ */

interface ResolvedAgentChat {
	readonly chatService: ChatService;
	readonly systemPrompt: string;
	readonly retrievalK: number;
	readonly knowledgeBaseIds: readonly string[];
}

async function resolveAgentChat(
	deps: AgentDispatchDeps,
	ctx: AgentDispatchContext,
): Promise<ResolvedAgentChat> {
	const { store, secrets, chatService, chatConfig } = deps;
	const { workspaceId, agent, conversation } = ctx;

	const chat = await resolveChatService(store, secrets, workspaceId, agent, {
		fallbackChatService: chatService,
		fallbackMaxOutputTokens: chatConfig?.maxOutputTokens,
	});

	// System-prompt resolution: agent override > runtime config override
	// > generic default.
	const systemPrompt =
		agent.systemPrompt ??
		chatConfig?.systemPrompt ??
		DEFAULT_AGENT_SYSTEM_PROMPT;

	const retrievalK =
		agent.ragMaxResults ?? chatConfig?.retrievalK ?? DEFAULT_RETRIEVAL_K;

	// KB-scope resolution: per-conversation > per-agent > workspace-wide
	// (the empty list signals "all KBs" to retrieveContext).
	const knowledgeBaseIds =
		conversation.knowledgeBaseIds.length > 0
			? conversation.knowledgeBaseIds
			: agent.knowledgeBaseIds.length > 0
				? agent.knowledgeBaseIds
				: [];

	return {
		chatService: chat,
		systemPrompt,
		retrievalK,
		knowledgeBaseIds,
	};
}

interface ChatServiceResolutionOptions {
	readonly fallbackChatService: ChatService | null;
	readonly fallbackMaxOutputTokens: number | undefined;
}

async function resolveChatService(
	store: ControlPlaneStore,
	secrets: SecretResolver,
	workspaceId: string,
	agent: AgentRecord,
	opts: ChatServiceResolutionOptions,
): Promise<ChatService> {
	if (!agent.llmServiceId) {
		// Phase B keeps the global-chatService fallback for agents that
		// haven't been migrated to per-agent llm services yet. Phase C
		// retires the global fallback alongside the /chats route.
		if (!opts.fallbackChatService) {
			throw new ApiError(
				"chat_disabled",
				"this runtime has no chat service configured and the agent has no llmServiceId; set `chat:` in workbench.yaml or attach an llm service to the agent",
				503,
			);
		}
		return opts.fallbackChatService;
	}

	const record = await store.getLlmService(workspaceId, agent.llmServiceId);
	if (!record) {
		throw new ControlPlaneNotFoundError("llm service", agent.llmServiceId);
	}
	if (record.provider !== "huggingface") {
		throw new ApiError(
			"llm_provider_unsupported",
			`only the 'huggingface' provider is supported in this runtime today; agent points at provider '${record.provider}'`,
			422,
		);
	}
	if (!record.credentialRef) {
		throw new ApiError(
			"llm_credential_missing",
			`llm service '${record.llmServiceId}' has no credentialRef set; cannot authenticate to HuggingFace`,
			422,
		);
	}

	const token = await secrets.resolve(record.credentialRef);
	const options: HuggingFaceChatServiceOptions = {
		token,
		modelId: record.modelName,
		maxOutputTokens:
			record.maxOutputTokens ??
			opts.fallbackMaxOutputTokens ??
			DEFAULT_MAX_OUTPUT_TOKENS,
	};
	return new HuggingFaceChatService(options);
}

/* ------------------------------------------------------------------ */
/* Metadata                                                           */
/* ------------------------------------------------------------------ */

/**
 * Compose the assistant message's `metadata` map. The web UI's
 * `MarkdownContent.tsx` citation parser depends on the
 * `context_chunks` shape — a JSON-encoded array of
 * `[chunkId, knowledgeBaseId, documentId]` tuples — and the
 * `context_document_ids` comma-joined fallback for older clients.
 */
export function buildAgentMetadata(
	chunks: readonly {
		readonly chunkId: string;
		readonly knowledgeBaseId: string;
		readonly documentId: string | null;
	}[],
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
		metadata.context_chunks = JSON.stringify(
			chunks.map((c) => [c.chunkId, c.knowledgeBaseId, c.documentId]),
		);
	}
	if (completion.errorMessage) {
		metadata.error_message = completion.errorMessage;
	}
	return metadata;
}

/* ------------------------------------------------------------------ */
/* Sync send                                                          */
/* ------------------------------------------------------------------ */

/**
 * Run a single agent turn synchronously: persist the user turn, fetch
 * RAG context, call the resolved chat service, and persist the
 * assistant turn. Returns both records so the route layer can return
 * them verbatim.
 */
export async function dispatchAgentSend(
	deps: AgentDispatchDeps,
	ctx: AgentDispatchContext,
	body: AgentDispatchBody,
): Promise<AgentSendResult> {
	const resolved = await resolveAgentChat(deps, ctx);
	const { workspaceId, agent, conversation } = ctx;
	const conversationId = conversation.conversationId;

	// 1) Persist the user turn first so it appears even if the model
	// fails midway through the call.
	const userRecord = await deps.store.appendChatMessage(
		workspaceId,
		conversationId,
		{
			role: "user",
			content: body.content,
		},
	);

	// 2) RAG retrieval (single-KB and multi-KB fan-out both flow
	// through the same helper used by /chats).
	const chunks = await retrieveContext(
		{
			store: deps.store,
			drivers: deps.drivers,
			embedders: deps.embedders,
			logger: deps.logger,
		},
		{
			workspaceId,
			knowledgeBaseIds: resolved.knowledgeBaseIds,
			query: body.content,
			retrievalK: resolved.retrievalK,
		},
	);

	// 3) Build the prompt from history + the just-appended turn. We
	// drop the new user row out of `priorHistory` so the assembler
	// doesn't double-count it (it's added back as `userTurn`).
	const history = await deps.store.listChatMessages(
		workspaceId,
		conversationId,
	);
	const priorHistory = history.filter(
		(m) => m.messageId !== userRecord.messageId,
	);
	const prompt = assemblePrompt({
		systemPrompt: resolved.systemPrompt,
		chunks,
		history: priorHistory,
		userTurn: body.content,
	});

	// 4) Call the resolved chat service. Errors are returned as a
	// `finishReason: "error"` outcome — we still persist the row so
	// the chat history reflects the failure.
	const completion = await resolved.chatService.complete({
		messages: prompt,
	});

	// 5) Persist the assistant turn with provenance. Strictly-after
	// timestamp keeps cluster ordering monotonic when a fast model
	// finishes within the same millisecond as the user-turn write.
	const assistantTs = strictlyAfter(userRecord.messageTs);
	const assistantRecord = await deps.store.appendChatMessage(
		workspaceId,
		conversationId,
		{
			role: "agent",
			authorId: agent.agentId,
			messageTs: assistantTs,
			content:
				completion.finishReason === "error"
					? (completion.errorMessage ?? "the agent couldn't answer this turn.")
					: completion.content,
			tokenCount: completion.tokenCount,
			metadata: buildAgentMetadata(chunks, resolved.chatService.modelId, {
				finishReason: completion.finishReason,
				errorMessage: completion.errorMessage,
			}),
		},
	);

	return { user: userRecord, assistant: assistantRecord };
}

/* ------------------------------------------------------------------ */
/* Streaming send                                                     */
/* ------------------------------------------------------------------ */

interface FinalStreamState {
	readonly finishReason: "stop" | "length" | "error";
	readonly errorMessage: string | null;
	readonly tokenCount: number | null;
	readonly content: string;
}

export interface AgentStreamSerializer {
	/** Convert a persisted user message to the SSE `data` payload. */
	serializeUserMessage(record: MessageRecord): string;
	/** Convert a persisted assistant message to the SSE `data` payload. */
	serializeAssistantMessage(record: MessageRecord): string;
}

/**
 * Run a single agent turn with token-by-token streaming. Mirrors the
 * `/chats/.../messages/stream` SSE shape: emits one `user-message`,
 * a series of `token` events, and a single terminal `done` (or
 * `error`) carrying the persisted assistant row.
 *
 * The route caller supplies `serializer` because the SSE wire format
 * uses the `*Wire` projections defined per-route (chats and agents
 * share schemas but the route owns the serializer to keep this module
 * route-shape agnostic).
 */
export async function dispatchAgentSendStream(
	deps: AgentDispatchDeps,
	ctx: AgentDispatchContext,
	body: AgentDispatchBody,
	sse: AgentSseWriter,
	serializer: AgentStreamSerializer,
): Promise<void> {
	const resolved = await resolveAgentChat(deps, ctx);
	const { workspaceId, agent, conversation } = ctx;
	const conversationId = conversation.conversationId;

	const userRecord = await deps.store.appendChatMessage(
		workspaceId,
		conversationId,
		{
			role: "user",
			content: body.content,
		},
	);

	const chunks = await retrieveContext(
		{
			store: deps.store,
			drivers: deps.drivers,
			embedders: deps.embedders,
			logger: deps.logger,
		},
		{
			workspaceId,
			knowledgeBaseIds: resolved.knowledgeBaseIds,
			query: body.content,
			retrievalK: resolved.retrievalK,
		},
	);
	const history = await deps.store.listChatMessages(
		workspaceId,
		conversationId,
	);
	const priorHistory = history.filter(
		(m) => m.messageId !== userRecord.messageId,
	);
	const prompt = assemblePrompt({
		systemPrompt: resolved.systemPrompt,
		chunks,
		history: priorHistory,
		userTurn: body.content,
	});

	const abort = new AbortController();
	sse.onAbort(() => {
		abort.abort();
	});

	await sse.writeSSE({
		event: "user-message",
		data: serializer.serializeUserMessage(userRecord),
	});

	const final = await consumeChatStream(
		resolved.chatService,
		prompt,
		abort.signal,
		sse,
	);

	const assistantTs = strictlyAfter(userRecord.messageTs);
	const persistedContent =
		final.finishReason === "error"
			? (final.errorMessage ?? "the agent couldn't answer this turn.")
			: final.content;

	const assistantRecord = await deps.store.appendChatMessage(
		workspaceId,
		conversationId,
		{
			role: "agent",
			authorId: agent.agentId,
			messageTs: assistantTs,
			content: persistedContent,
			tokenCount: final.tokenCount,
			metadata: buildAgentMetadata(chunks, resolved.chatService.modelId, {
				finishReason: final.finishReason,
				errorMessage: final.errorMessage,
			}),
		},
	);

	await sse.writeSSE({
		event: final.finishReason === "error" ? "error" : "done",
		data: serializer.serializeAssistantMessage(assistantRecord),
	});
}

async function consumeChatStream(
	chatService: ChatService,
	prompt: ReturnType<typeof assemblePrompt>,
	signal: AbortSignal,
	sse: AgentSseWriter,
): Promise<FinalStreamState> {
	let buffer = "";
	let finalEvent:
		| { type: "done"; finishReason: "stop" | "length"; content: string }
		| { type: "error"; errorMessage: string }
		| null = null;
	let tokenCount: number | null = null;

	try {
		for await (const event of chatService.completeStream(
			{ messages: prompt },
			{ signal },
		) as AsyncIterable<ChatStreamEvent>) {
			if (event.type === "token") {
				buffer += event.delta;
				await sse.writeSSE({
					event: "token",
					data: JSON.stringify({ delta: event.delta }),
				});
			} else if (event.type === "done") {
				finalEvent = {
					type: "done",
					finishReason:
						event.finishReason === "error" ? "stop" : event.finishReason,
					content:
						event.content && event.content.length > buffer.length
							? event.content
							: buffer,
				};
				tokenCount = event.tokenCount;
				if (event.content && event.content.length > buffer.length) {
					buffer = event.content;
				}
			} else if (event.type === "error") {
				finalEvent = { type: "error", errorMessage: event.errorMessage };
				tokenCount = event.tokenCount;
			}
		}
	} catch (err) {
		finalEvent = {
			type: "error",
			errorMessage: err instanceof Error ? err.message : String(err),
		};
	}

	if (!finalEvent) {
		// Stream ended without a terminal event — defensive; the
		// ChatService contract requires exactly one terminal event.
		finalEvent = {
			type: "error",
			errorMessage: "chat service stream ended without a terminal event",
		};
	}

	if (finalEvent.type === "done") {
		return {
			finishReason: finalEvent.finishReason,
			errorMessage: null,
			tokenCount,
			content: finalEvent.content,
		};
	}
	return {
		finishReason: "error",
		errorMessage: finalEvent.errorMessage,
		tokenCount,
		content: buffer,
	};
}

/**
 * Stamp a timestamp strictly after `prev` (ISO-8601). Guarantees
 * monotonic ordering of cluster-keyed message rows even when a fast
 * model emits its terminal event in the same millisecond as the
 * preceding write.
 */
function strictlyAfter(prevIso: string): string {
	const prev = Date.parse(prevIso);
	return new Date(Math.max(prev + 1, Date.now())).toISOString();
}

/* Re-export for routes that need the resolution shape. */
export type { LlmServiceRecord, RetrievedChunk };
