/**
 * Outer dispatcher loops for the per-agent chat send/stream pipeline.
 *
 * Backs `/api/v1/workspaces/{w}/agents/{a}/conversations/{c}/messages`
 * for both the synchronous send and the SSE stream variants, providing
 * the same RAG retrieval + prompt-assembly + persistence shape.
 *
 * Layered:
 *   - Per-turn effective config resolution      → `chat/agent-resolution.ts`
 *   - Persistence + tool execution helpers      → `chat/agent-persistence.ts`
 *   - Per-call workspace tool dispatch          → `chat/tools/dispatcher.ts`
 *   - Prompt assembly                            → `chat/prompt.ts`
 *   - RAG retrieval                              → `chat/retrieval.ts`
 *
 * This file owns the iteration-cap loop and the streaming variant — the
 * parts whose sequencing is the actual policy.
 *
 * Persisted assistant `metadata.model` reflects the **resolved** chat
 * service's `modelId`, not the global runtime's, so audit logs are
 * per-turn accurate even when an agent overrides the model.
 */

import {
	buildAgentMetadata,
	executeToolCalls,
	type PersistTurnContext,
	persistAssistantToolCallTurn,
	persistFinalAssistant,
} from "../chat/agent-persistence.js";
import {
	type AgentResolutionContext,
	type AgentResolutionDeps,
	resolveAgentChat,
	retrieveContextIfEnabled,
} from "../chat/agent-resolution.js";
import type { RetrievedChunk } from "../chat/prompt.js";
import { assemblePrompt } from "../chat/prompt.js";
import { DEFAULT_AGENT_TOOLS } from "../chat/tools/registry.js";
import type {
	ChatService,
	ChatTurn,
	ToolCall,
	ToolDefinition,
} from "../chat/types.js";
import type {
	LlmServiceRecord,
	MessageRecord,
} from "../control-plane/types.js";

/**
 * Hard cap on how many tool-call iterations a single user turn can
 * trigger. Each iteration is one round-trip with the LLM. The cap
 * prevents a confused model from looping forever on malformed tool
 * results; in practice 3–4 iterations is plenty for "list KBs → pick
 * one → search → answer".
 */
const MAX_TOOL_ITERATIONS = 6;

/**
 * Public deps surface for both `dispatchAgentSend` and
 * `dispatchAgentSendStream`. Identical to {@link AgentResolutionDeps}
 * — re-aliased here so route handlers don't have to know about the
 * resolution layer's name.
 */
export type AgentDispatchDeps = AgentResolutionDeps;

export type AgentDispatchContext = AgentResolutionContext;

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

/** Re-export so the route layer can advertise the same set in its OpenAPI metadata. */
export { buildAgentMetadata, DEFAULT_AGENT_TOOLS };

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
const ITERATION_CAP_MESSAGE =
	"the agent kept calling tools without converging on an answer; aborting after the iteration cap.";
const ITERATION_CAP_REASON = "tool-call iteration cap reached";

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
	const persistCtx: PersistTurnContext = {
		deps,
		workspaceId,
		conversationId,
		agent,
		chatService: resolved.chatService,
		chunks,
	};

	for (let i = 0; i < MAX_TOOL_ITERATIONS; i++) {
		const completion = await resolved.chatService.complete({
			messages: turns,
			tools: tools.length > 0 ? tools.map((t) => t.definition) : undefined,
		});
		lastTokenCount = completion.tokenCount;

		if (completion.finishReason === "error") {
			const assistantRecord = await persistFinalAssistant(persistCtx, prevTs, {
				content:
					completion.errorMessage ?? "the agent couldn't answer this turn.",
				tokenCount: completion.tokenCount,
				finishReason: "error",
				errorMessage: completion.errorMessage,
			});
			return { user: userRecord, assistant: assistantRecord };
		}

		// Final answer — no tool calls.
		if (completion.toolCalls.length === 0) {
			const assistantRecord = await persistFinalAssistant(persistCtx, prevTs, {
				content: completion.content,
				tokenCount: completion.tokenCount,
				finishReason: completion.finishReason,
				errorMessage: null,
			});
			return { user: userRecord, assistant: assistantRecord };
		}

		// Tool-call iteration: persist the assistant turn carrying the
		// tool calls, then execute each tool and persist its result.
		prevTs = await persistAssistantToolCallTurn(persistCtx, prevTs, {
			content: completion.content,
			toolCalls: completion.toolCalls,
			tokenCount: completion.tokenCount,
		});
		turns.push({
			role: "assistant",
			content: completion.content,
			toolCalls: completion.toolCalls,
		});

		const toolStep = await executeToolCalls(
			persistCtx,
			resolved,
			completion.toolCalls,
			prevTs,
		);
		prevTs = toolStep.endTs;
		turns.push(...toolStep.turns);
	}

	// Hit the iteration cap without convergence. Persist a friendly
	// error so the chat reflects what happened.
	const assistantRecord = await persistFinalAssistant(persistCtx, prevTs, {
		content: ITERATION_CAP_MESSAGE,
		tokenCount: lastTokenCount,
		finishReason: "error",
		errorMessage: ITERATION_CAP_REASON,
	});
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
 *   - `token` events for every iteration's content delta as it lands
 *     (live, not buffered) — including any pre-tool-call narration
 *   - a `token-reset` after each tool-call iteration so the frontend
 *     clears the live preview before the next iteration's tokens
 *     stream in
 *   - zero or more `tool-call` / `tool-result` events surfacing the
 *     intermediate tool-call iterations
 *   - exactly one terminal `done` (or `error`) carrying the persisted
 *     assistant row, which always reflects only the FINAL iteration's
 *     content (the canonical thread is unaffected by what leaked into
 *     the live preview)
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
	const persistCtx: PersistTurnContext = {
		deps,
		workspaceId,
		conversationId,
		agent,
		chatService: resolved.chatService,
		chunks,
	};

	// The iteration body persists rows + writes SSE events one-at-a-time;
	// any uncaught throw in the middle would leave the wire half-formed
	// (tool-result events landed but no terminal `done`/`error`). Wrap
	// the whole loop so every termination path goes through
	// {@link emitTerminalError} and the SPA always sees exactly one
	// terminal event.
	try {
		for (let i = 0; i < MAX_TOOL_ITERATIONS; i++) {
			// Forward content tokens to the SSE consumer as they land.
			// Pre-tool-call narration (e.g. "let me look that up...") will
			// leak into the live preview when an iteration ends with tool
			// calls; the dispatcher emits `token-reset` after the iteration
			// so the frontend can clear the buffer before the next
			// iteration's tokens stream in. The persisted assistant row is
			// still drawn only from the final iteration's content, so the
			// canonical thread is unaffected.
			const final = await consumeStreamIteration(
				resolved.chatService,
				turns,
				tools.map((t) => t.definition),
				abort.signal,
				async (delta) => {
					await sse.writeSSE({
						event: "token",
						data: JSON.stringify({ delta }),
					});
				},
			);
			lastTokenCount = final.tokenCount;

			if (final.kind === "error") {
				await emitTerminalError(
					persistCtx,
					prevTs,
					final.tokenCount,
					final.errorMessage ?? "the agent couldn't answer this turn.",
					sse,
					serializer,
				);
				return;
			}

			if (final.toolCalls.length === 0) {
				// Final answer. Tokens already streamed live; just persist
				// and emit `done` so the frontend can swap the live preview
				// for the canonical persisted row.
				const assistantRecord = await persistFinalAssistant(
					persistCtx,
					prevTs,
					{
						content: final.content,
						tokenCount: final.tokenCount,
						finishReason: final.finishReason,
						errorMessage: null,
					},
				);
				await sse.writeSSE({
					event: "done",
					data: serializer.serializeAssistantMessage(assistantRecord),
				});
				return;
			}

			// Tool-call iteration. Tell the frontend to clear any pre-tool-
			// call narration that streamed into the live preview, persist
			// the assistant tool-call turn, and surface tool progress.
			await sse.writeSSE({ event: "token-reset", data: "{}" });
			prevTs = await persistAssistantToolCallTurn(persistCtx, prevTs, {
				content: final.content,
				toolCalls: final.toolCalls,
				tokenCount: final.tokenCount,
			});
			await sse.writeSSE({
				event: "tool-call",
				data: JSON.stringify({ toolCalls: final.toolCalls }),
			});
			turns.push({
				role: "assistant",
				content: final.content,
				toolCalls: final.toolCalls,
			});

			const toolStep = await executeToolCalls(
				persistCtx,
				resolved,
				final.toolCalls,
				prevTs,
				async (call, resultText) => {
					await sse.writeSSE({
						event: "tool-result",
						data: JSON.stringify({
							toolCallId: call.id,
							name: call.name,
							content: resultText,
						}),
					});
				},
			);
			prevTs = toolStep.endTs;
			turns.push(...toolStep.turns);
		}

		await emitTerminalError(
			persistCtx,
			prevTs,
			lastTokenCount,
			ITERATION_CAP_MESSAGE,
			sse,
			serializer,
			ITERATION_CAP_REASON,
		);
	} catch (err) {
		const errorMessage = err instanceof Error ? err.message : String(err);
		deps.logger?.warn?.(
			{ err, conversationId },
			"streaming dispatcher caught a mid-iteration failure; emitting terminal error",
		);
		await emitTerminalError(
			persistCtx,
			prevTs,
			lastTokenCount,
			errorMessage,
			sse,
			serializer,
		);
	}
}

/**
 * Best-effort terminal `error` envelope. Tries to persist a final
 * assistant row carrying the failure, then tries to write one terminal
 * `error` SSE event. Both steps swallow their own errors: persistence
 * may fail if the control plane is the very thing that died, and the
 * SSE write may fail if the client has already disconnected. In either
 * case the route layer's outer `streamSSE` wrapper provides the
 * last-resort guarantee that *something* terminal lands on the wire.
 */
async function emitTerminalError(
	persistCtx: PersistTurnContext,
	prevTs: string,
	lastTokenCount: number | null,
	errorMessage: string,
	sse: AgentSseWriter,
	serializer: AgentStreamSerializer,
	persistedErrorMessage?: string,
): Promise<void> {
	let assistantRecord: MessageRecord | null = null;
	try {
		assistantRecord = await persistFinalAssistant(persistCtx, prevTs, {
			content: errorMessage,
			tokenCount: lastTokenCount,
			finishReason: "error",
			errorMessage: persistedErrorMessage ?? errorMessage,
		});
	} catch (persistErr) {
		persistCtx.deps.logger?.warn?.(
			{ err: persistErr },
			"streaming dispatcher could not persist terminal error row",
		);
	}
	if (!assistantRecord) return;
	try {
		await sse.writeSSE({
			event: "error",
			data: serializer.serializeAssistantMessage(assistantRecord),
		});
	} catch (sseErr) {
		persistCtx.deps.logger?.debug?.(
			{ err: sseErr },
			"streaming dispatcher could not emit terminal error SSE (client gone)",
		);
	}
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
 * Consume one iteration of the streaming chat-completion. `onToken`
 * fires for each content delta as it arrives — callers (the SSE
 * dispatcher) forward those live so the user sees the model's
 * response appear token-by-token. Tool-call deltas are accumulated
 * locally and surfaced on the terminal `done` IterationResult.
 */
async function consumeStreamIteration(
	chatService: ChatService,
	prompt: readonly ChatTurn[],
	tools: readonly ToolDefinition[] | undefined,
	signal: AbortSignal,
	onToken: (delta: string) => Promise<void> | void,
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
		)) {
			if (event.type === "token") {
				buffer += event.delta;
				await onToken(event.delta);
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

/* Re-export for routes that need the resolution shape. */
export type { LlmServiceRecord, RetrievedChunk };
