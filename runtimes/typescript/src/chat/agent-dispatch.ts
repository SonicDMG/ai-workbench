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
import {
	OpenAIChatService,
	type OpenAIChatServiceOptions,
} from "../chat/openai.js";
import type { RetrievedChunk } from "../chat/prompt.js";
import { assemblePrompt } from "../chat/prompt.js";
import { retrieveContext } from "../chat/retrieval.js";
import {
	type AgentTool,
	type AgentToolDeps,
	DEFAULT_AGENT_TOOLS,
} from "../chat/tools/registry.js";
import type {
	ChatService,
	ChatStreamEvent,
	ChatTurn,
	ToolCall,
	ToolDefinition,
} from "../chat/types.js";
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

/**
 * Hard cap on how many tool-call iterations a single user turn can
 * trigger. Each iteration is one round-trip with the LLM. The cap
 * prevents a confused model from looping forever on malformed tool
 * results; in practice 3–4 iterations is plenty for "list KBs → pick
 * one → search → answer".
 */
const MAX_TOOL_ITERATIONS = 6;

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
	/**
	 * Tools advertised to the model on every iteration of the
	 * tool-call loop. Empty when the agent's chat provider doesn't
	 * support function calling — the dispatcher falls back to the
	 * old retrieve-and-answer flow.
	 */
	readonly tools: readonly AgentTool[];
	/**
	 * Bound context for tool execution. Built once per turn so each
	 * tool invocation doesn't have to plumb workspace + store + driver
	 * registry on its own.
	 */
	readonly toolDeps: AgentToolDeps;
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

	const toolDeps: AgentToolDeps = {
		workspaceId,
		store,
		drivers: deps.drivers,
		embedders: deps.embedders,
		logger: deps.logger,
	};

	// Tools are always advertised to the resolved chat service. The
	// OpenAI adapter forwards them as the `tools[]` request body field
	// and the model decides whether to call them; the HuggingFace
	// adapter drops the field on the floor (its provider request
	// shape doesn't carry tools today), so HF-backed agents simply
	// answer in plain text. There's no harm in advertising regardless,
	// and the dispatcher loop only iterates when a completion actually
	// emits tool calls.
	const tools = DEFAULT_AGENT_TOOLS;

	return {
		chatService: chat,
		systemPrompt,
		retrievalK,
		knowledgeBaseIds,
		tools,
		toolDeps,
	};
}

/**
 * Conditionally pull RAG context up front. Tool-using agents
 * (`ragEnabled === false`) skip the implicit retrieval and let the
 * model decide when to call `search_kb`; classic RAG agents keep the
 * existing top-K-into-system-prompt behavior.
 */
async function retrieveContextIfEnabled(
	deps: AgentDispatchDeps,
	agent: AgentRecord,
	request: {
		readonly workspaceId: string;
		readonly knowledgeBaseIds: readonly string[];
		readonly query: string;
		readonly retrievalK: number;
	},
): Promise<readonly RetrievedChunk[]> {
	if (!agent.ragEnabled) return [];
	return retrieveContext(
		{
			store: deps.store,
			drivers: deps.drivers,
			embedders: deps.embedders,
			logger: deps.logger,
		},
		request,
	);
}

/**
 * Execute a single tool call. Argument JSON is parsed defensively —
 * the model occasionally emits malformed payloads (extra fields,
 * smart quotes, partial closures) and we want a clean error string
 * back to the model, not an exception.
 */
async function runToolCall(
	call: ToolCall,
	deps: AgentToolDeps,
): Promise<string> {
	const tool = DEFAULT_AGENT_TOOLS.find((t) => t.definition.name === call.name);
	if (!tool) {
		return `Error: tool '${call.name}' is not available. Try one of: ${DEFAULT_AGENT_TOOLS.map((t) => t.definition.name).join(", ")}.`;
	}
	let parsed: unknown;
	try {
		parsed = call.arguments.length === 0 ? {} : JSON.parse(call.arguments);
	} catch (err) {
		return `Error: tool arguments were not valid JSON (${err instanceof Error ? err.message : String(err)}).`;
	}
	try {
		return await tool.execute(parsed, deps);
	} catch (err) {
		deps.logger?.warn?.(
			{ err, tool: call.name },
			"agent tool threw — surfacing as a tool error",
		);
		return `Error: tool '${call.name}' failed — ${err instanceof Error ? err.message : String(err)}.`;
	}
}

/** Re-export so the route layer can advertise the same set in its OpenAPI metadata. */
export { DEFAULT_AGENT_TOOLS };

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
	if (record.provider !== "huggingface" && record.provider !== "openai") {
		throw new ApiError(
			"llm_provider_unsupported",
			`only the 'huggingface' and 'openai' providers are supported in this runtime today; agent points at provider '${record.provider}'`,
			422,
		);
	}
	if (!record.credentialRef) {
		throw new ApiError(
			"llm_credential_missing",
			`llm service '${record.llmServiceId}' has no credentialRef set; cannot authenticate to ${record.provider}`,
			422,
		);
	}

	const credential = await secrets.resolve(record.credentialRef);
	const maxOutputTokens =
		record.maxOutputTokens ??
		opts.fallbackMaxOutputTokens ??
		DEFAULT_MAX_OUTPUT_TOKENS;

	if (record.provider === "huggingface") {
		const options: HuggingFaceChatServiceOptions = {
			token: credential,
			modelId: record.modelName,
			maxOutputTokens,
		};
		return new HuggingFaceChatService(options);
	}
	const options: OpenAIChatServiceOptions = {
		apiKey: credential,
		modelId: record.modelName,
		maxOutputTokens,
	};
	return new OpenAIChatService(options);
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
		readonly finishReason: "stop" | "length" | "error" | "tool_calls";
		readonly errorMessage: string | null;
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
 * Run a single agent turn synchronously. Persists the user turn,
 * fetches optional up-front RAG context, then runs the tool-call loop
 * against the resolved chat service: for each iteration the model
 * either emits tool calls (which the dispatcher executes and feeds
 * back as `tool` turns) or returns a final answer. Each tool call /
 * tool result is persisted as its own message row so the conversation
 * history stays auditable.
 *
 * Returns the user row and the FINAL assistant row. Intermediate
 * tool-call assistant rows + tool-result rows live in the conversation
 * history but aren't returned here — keeps the wire response shape
 * stable for callers that just want the user-visible reply.
 */
export async function dispatchAgentSend(
	deps: AgentDispatchDeps,
	ctx: AgentDispatchContext,
	body: AgentDispatchBody,
): Promise<AgentSendResult> {
	const resolved = await resolveAgentChat(deps, ctx);
	const { workspaceId, agent, conversation } = ctx;
	const conversationId = conversation.conversationId;

	const userRecord = await deps.store.appendChatMessage(
		workspaceId,
		conversationId,
		{ role: "user", content: body.content },
	);

	const chunks = await retrieveContextIfEnabled(deps, agent, {
		workspaceId,
		knowledgeBaseIds: resolved.knowledgeBaseIds,
		query: body.content,
		retrievalK: resolved.retrievalK,
	});

	const history = await deps.store.listChatMessages(
		workspaceId,
		conversationId,
	);
	const priorHistory = history.filter(
		(m) => m.messageId !== userRecord.messageId,
	);
	const initialPrompt = assemblePrompt({
		systemPrompt: resolved.systemPrompt,
		chunks,
		history: priorHistory,
		userTurn: body.content,
	});

	const tools = resolved.tools;
	const turns: ChatTurn[] = [...initialPrompt];
	let lastTokenCount: number | null = null;
	let prevTs = userRecord.messageTs;

	for (let i = 0; i < MAX_TOOL_ITERATIONS; i++) {
		const completion = await resolved.chatService.complete({
			messages: turns,
			tools: tools.length > 0 ? tools.map((t) => t.definition) : undefined,
		});
		lastTokenCount = completion.tokenCount;

		if (completion.finishReason === "error") {
			const ts = strictlyAfter(prevTs);
			const assistantRecord = await deps.store.appendChatMessage(
				workspaceId,
				conversationId,
				{
					role: "agent",
					authorId: agent.agentId,
					messageTs: ts,
					content:
						completion.errorMessage ?? "the agent couldn't answer this turn.",
					tokenCount: completion.tokenCount,
					metadata: buildAgentMetadata(
						chunks,
						resolved.chatService.modelId,
						completion,
					),
				},
			);
			return { user: userRecord, assistant: assistantRecord };
		}

		// Final answer — no tool calls.
		if (completion.toolCalls.length === 0) {
			const ts = strictlyAfter(prevTs);
			const assistantRecord = await deps.store.appendChatMessage(
				workspaceId,
				conversationId,
				{
					role: "agent",
					authorId: agent.agentId,
					messageTs: ts,
					content: completion.content,
					tokenCount: completion.tokenCount,
					metadata: buildAgentMetadata(
						chunks,
						resolved.chatService.modelId,
						completion,
					),
				},
			);
			return { user: userRecord, assistant: assistantRecord };
		}

		// Tool-call iteration: persist the assistant turn (carrying the
		// tool calls), execute each tool, persist + append a tool turn
		// for each result, then loop.
		const assistantTs = strictlyAfter(prevTs);
		await deps.store.appendChatMessage(workspaceId, conversationId, {
			role: "agent",
			authorId: agent.agentId,
			messageTs: assistantTs,
			content: completion.content,
			tokenCount: completion.tokenCount,
			toolCallPayload: { toolCalls: completion.toolCalls },
			metadata: {
				model: resolved.chatService.modelId,
				finish_reason: completion.finishReason,
			},
		});
		prevTs = assistantTs;
		turns.push({
			role: "assistant",
			content: completion.content,
			toolCalls: completion.toolCalls,
		});

		for (const call of completion.toolCalls) {
			const resultText = await runToolCall(call, resolved.toolDeps);
			const toolTs = strictlyAfter(prevTs);
			await deps.store.appendChatMessage(workspaceId, conversationId, {
				role: "tool",
				messageTs: toolTs,
				toolId: call.name,
				toolResponse: { content: resultText, toolCallId: call.id },
			});
			prevTs = toolTs;
			turns.push({
				role: "tool",
				toolCallId: call.id,
				name: call.name,
				content: resultText,
			});
		}
	}

	// Hit the iteration cap without convergence. Persist a friendly
	// error so the chat reflects what happened.
	const failTs = strictlyAfter(prevTs);
	const assistantRecord = await deps.store.appendChatMessage(
		workspaceId,
		conversationId,
		{
			role: "agent",
			authorId: agent.agentId,
			messageTs: failTs,
			content:
				"the agent kept calling tools without converging on an answer; aborting after the iteration cap.",
			tokenCount: lastTokenCount,
			metadata: buildAgentMetadata(chunks, resolved.chatService.modelId, {
				finishReason: "error",
				errorMessage: "tool-call iteration cap reached",
			}),
		},
	);
	return { user: userRecord, assistant: assistantRecord };
}

/* ------------------------------------------------------------------ */
/* Streaming send                                                     */
/* ------------------------------------------------------------------ */

export interface AgentStreamSerializer {
	/** Convert a persisted user message to the SSE `data` payload. */
	serializeUserMessage(record: MessageRecord): string;
	/** Convert a persisted assistant message to the SSE `data` payload. */
	serializeAssistantMessage(record: MessageRecord): string;
}

/**
 * Run a single agent turn with token-by-token streaming. Mirrors the
 * SSE shape the agents route uses:
 *
 *   - one `user-message` carrying the persisted user row
 *   - zero or more `tool-call` / `tool-result` events surfacing the
 *     intermediate tool-call iterations (when the model decides to
 *     use tools)
 *   - a series of `token` events for the FINAL user-visible answer
 *   - exactly one terminal `done` (or `error`) carrying the persisted
 *     assistant row
 *
 * Tool-call iterations are run synchronously inside the stream — the
 * model emits all tool calls before the dispatcher executes them, so
 * per-iteration token streaming would mostly leak metadata. We surface
 * progress via the `tool-call` / `tool-result` events instead, then
 * stream tokens for the model's final answer.
 *
 * The route caller supplies `serializer` because the SSE wire format
 * uses the `*Wire` projections defined per-route.
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
		{ role: "user", content: body.content },
	);

	const chunks = await retrieveContextIfEnabled(deps, agent, {
		workspaceId,
		knowledgeBaseIds: resolved.knowledgeBaseIds,
		query: body.content,
		retrievalK: resolved.retrievalK,
	});

	const history = await deps.store.listChatMessages(
		workspaceId,
		conversationId,
	);
	const priorHistory = history.filter(
		(m) => m.messageId !== userRecord.messageId,
	);
	const initialPrompt = assemblePrompt({
		systemPrompt: resolved.systemPrompt,
		chunks,
		history: priorHistory,
		userTurn: body.content,
	});

	const abort = new AbortController();
	sse.onAbort(() => abort.abort());

	await sse.writeSSE({
		event: "user-message",
		data: serializer.serializeUserMessage(userRecord),
	});

	const turns: ChatTurn[] = [...initialPrompt];
	const tools = resolved.tools;
	let prevTs = userRecord.messageTs;
	let lastTokenCount: number | null = null;

	for (let i = 0; i < MAX_TOOL_ITERATIONS; i++) {
		// Buffer tokens locally on each iteration. We only forward them
		// to the SSE consumer once we know the iteration is the FINAL
		// one (i.e. produced no tool calls) — otherwise the model's
		// "narration before calling a tool" would leak into the user-
		// visible reply.
		const buffer: string[] = [];
		const final = await consumeStreamIteration(
			resolved.chatService,
			turns,
			tools.map((t) => t.definition),
			abort.signal,
			(delta) => buffer.push(delta),
		);
		lastTokenCount = final.tokenCount;

		if (final.kind === "error") {
			const ts = strictlyAfter(prevTs);
			const assistantRecord = await deps.store.appendChatMessage(
				workspaceId,
				conversationId,
				{
					role: "agent",
					authorId: agent.agentId,
					messageTs: ts,
					content: final.errorMessage ?? "the agent couldn't answer this turn.",
					tokenCount: final.tokenCount,
					metadata: buildAgentMetadata(chunks, resolved.chatService.modelId, {
						finishReason: "error",
						errorMessage: final.errorMessage,
					}),
				},
			);
			await sse.writeSSE({
				event: "error",
				data: serializer.serializeAssistantMessage(assistantRecord),
			});
			return;
		}

		if (final.toolCalls.length === 0) {
			// Final answer. Replay the buffered tokens to the SSE
			// consumer in order, then persist + emit `done`.
			for (const delta of buffer) {
				await sse.writeSSE({
					event: "token",
					data: JSON.stringify({ delta }),
				});
			}
			const ts = strictlyAfter(prevTs);
			const assistantRecord = await deps.store.appendChatMessage(
				workspaceId,
				conversationId,
				{
					role: "agent",
					authorId: agent.agentId,
					messageTs: ts,
					content: final.content,
					tokenCount: final.tokenCount,
					metadata: buildAgentMetadata(chunks, resolved.chatService.modelId, {
						finishReason: final.finishReason,
						errorMessage: null,
					}),
				},
			);
			await sse.writeSSE({
				event: "done",
				data: serializer.serializeAssistantMessage(assistantRecord),
			});
			return;
		}

		// Tool-call iteration. Persist the assistant turn (with
		// tool_calls) + each tool result, surface progress on the
		// stream, and loop.
		const assistantTs = strictlyAfter(prevTs);
		await deps.store.appendChatMessage(workspaceId, conversationId, {
			role: "agent",
			authorId: agent.agentId,
			messageTs: assistantTs,
			content: final.content,
			tokenCount: final.tokenCount,
			toolCallPayload: { toolCalls: final.toolCalls },
			metadata: {
				model: resolved.chatService.modelId,
				finish_reason: "tool_calls",
			},
		});
		prevTs = assistantTs;
		await sse.writeSSE({
			event: "tool-call",
			data: JSON.stringify({ toolCalls: final.toolCalls }),
		});
		turns.push({
			role: "assistant",
			content: final.content,
			toolCalls: final.toolCalls,
		});

		for (const call of final.toolCalls) {
			const resultText = await runToolCall(call, resolved.toolDeps);
			const toolTs = strictlyAfter(prevTs);
			await deps.store.appendChatMessage(workspaceId, conversationId, {
				role: "tool",
				messageTs: toolTs,
				toolId: call.name,
				toolResponse: { content: resultText, toolCallId: call.id },
			});
			prevTs = toolTs;
			turns.push({
				role: "tool",
				toolCallId: call.id,
				name: call.name,
				content: resultText,
			});
			await sse.writeSSE({
				event: "tool-result",
				data: JSON.stringify({
					toolCallId: call.id,
					name: call.name,
					content: resultText,
				}),
			});
		}
	}

	const ts = strictlyAfter(prevTs);
	const assistantRecord = await deps.store.appendChatMessage(
		workspaceId,
		conversationId,
		{
			role: "agent",
			authorId: agent.agentId,
			messageTs: ts,
			content:
				"the agent kept calling tools without converging on an answer; aborting after the iteration cap.",
			tokenCount: lastTokenCount,
			metadata: buildAgentMetadata(chunks, resolved.chatService.modelId, {
				finishReason: "error",
				errorMessage: "tool-call iteration cap reached",
			}),
		},
	);
	await sse.writeSSE({
		event: "error",
		data: serializer.serializeAssistantMessage(assistantRecord),
	});
}

type IterationResult =
	| {
			readonly kind: "done";
			readonly finishReason: "stop" | "length" | "tool_calls";
			readonly content: string;
			readonly toolCalls: readonly ToolCall[];
			readonly tokenCount: number | null;
	  }
	| {
			readonly kind: "error";
			readonly errorMessage: string;
			readonly tokenCount: number | null;
	  };

/**
 * Consume one iteration of the streaming chat-completion. Tokens are
 * NOT directly forwarded to the SSE consumer — the dispatcher decides
 * after the iteration finishes whether this was the final answer
 * (replay tokens) or an intermediate tool-call iteration (drop them).
 *
 * `onToken` is invoked for every delta so the caller can buffer them.
 */
async function consumeStreamIteration(
	chatService: ChatService,
	prompt: readonly ChatTurn[],
	tools: readonly ToolDefinition[] | undefined,
	signal: AbortSignal,
	onToken: (delta: string) => void,
): Promise<IterationResult> {
	let buffer = "";
	let finalKind: IterationResult["kind"] | null = null;
	let finishReason: "stop" | "length" | "tool_calls" = "stop";
	let toolCalls: readonly ToolCall[] = [];
	let errorMessage = "";
	let tokenCount: number | null = null;

	try {
		for await (const event of chatService.completeStream(
			{
				messages: prompt,
				tools: tools && tools.length > 0 ? tools : undefined,
			},
			{ signal },
		) as AsyncIterable<ChatStreamEvent>) {
			if (event.type === "token") {
				buffer += event.delta;
				onToken(event.delta);
			} else if (event.type === "done") {
				finalKind = "done";
				finishReason =
					event.finishReason === "error" ? "stop" : event.finishReason;
				toolCalls = event.toolCalls ?? [];
				tokenCount = event.tokenCount;
				if (event.content && event.content.length > buffer.length) {
					buffer = event.content;
				}
			} else if (event.type === "error") {
				finalKind = "error";
				errorMessage = event.errorMessage;
				tokenCount = event.tokenCount;
			}
		}
	} catch (err) {
		finalKind = "error";
		errorMessage = err instanceof Error ? err.message : String(err);
	}

	if (finalKind === null) {
		return {
			kind: "error",
			errorMessage: "chat service stream ended without a terminal event",
			tokenCount,
		};
	}
	if (finalKind === "error") {
		return { kind: "error", errorMessage, tokenCount };
	}
	return {
		kind: "done",
		finishReason,
		content: buffer,
		toolCalls,
		tokenCount,
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
