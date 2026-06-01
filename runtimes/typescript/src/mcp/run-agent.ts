/**
 * Shared agent-turn orchestration used by both `chat_send` and
 * `run_agent` MCP tools.
 *
 * Encapsulates the "append user turn → retrieve grounding context →
 * assemble prompt → call chat-completion model → persist assistant
 * turn" pipeline. `chat_send` calls this with an existing conversation
 * (the legacy single-tool surface); `run_agent` calls it after
 * resolving (or creating) a conversation bound to a stored agent.
 *
 * The two tools differ only in conversation lifecycle and the agent
 * resolution dance; the actual model invocation, RAG retrieval, and
 * persistence logic lives here exactly once so the two front doors
 * cannot drift.
 */

import { assemblePrompt, PROMPT_HISTORY_FETCH_LIMIT } from "../chat/prompt.js";
import { retrieveContext } from "../chat/retrieval.js";
import type { ChatService } from "../chat/types.js";
import type { ChatConfig } from "../config/schema.js";
import { DEFAULT_AGENT_SYSTEM_PROMPT } from "../control-plane/defaults.js";
import type { ControlPlaneStore } from "../control-plane/store.js";
import type { VectorStoreDriverRegistry } from "../drivers/registry.js";
import type { EmbedderFactory } from "../embeddings/factory.js";
import { logger } from "../lib/logger.js";

export interface RunAgentTurnDeps {
	readonly store: ControlPlaneStore;
	readonly drivers: VectorStoreDriverRegistry;
	readonly embedders: EmbedderFactory;
	readonly chatService: ChatService;
	readonly chatConfig: ChatConfig;
}

export interface RunAgentTurnArgs {
	readonly workspaceId: string;
	readonly agentId: string;
	readonly chatId: string;
	readonly content: string;
	/**
	 * Grounding KB ids — usually the conversation's persisted set, so
	 * that follow-up turns keep the same RAG scope. The caller is
	 * responsible for sourcing this (from the conversation row, or
	 * from an agent at creation time).
	 */
	readonly knowledgeBaseIds: readonly string[];
	/**
	 * Optional per-agent system prompt override. When omitted, falls
	 * back to `chatConfig.systemPrompt`, then to the default. Allows
	 * `run_agent` to honor the agent's stored prompt without changing
	 * the runtime-wide chat config.
	 */
	readonly systemPrompt?: string | null;
}

export interface RunAgentTurnOutcome {
	readonly replyText: string;
	readonly finishReason: "stop" | "length" | "error" | "tool_calls";
	readonly tokenCount: number | null;
	readonly errorMessage: string | null;
	readonly contextChunkIds: readonly string[];
}

/**
 * Persist a user turn, retrieve grounding context, run the model, and
 * persist the assistant turn. Returns the assistant text + the model's
 * finish reason so callers can shape their wire response — the MCP
 * `chat_send` returns just the text in a single content block; the new
 * MCP `run_agent` returns the structured envelope so external callers
 * can branch on `finishReason`.
 *
 * **Failure semantics.** When the chat service returns
 * `finishReason: "error"`, the assistant turn is still persisted with
 * the error message in metadata (consistent with the historical
 * `chat_send` behavior). Callers wrap the return value in an
 * `isError: true` MCP envelope based on `finishReason`.
 */
export async function runAgentTurn(
	deps: RunAgentTurnDeps,
	args: RunAgentTurnArgs,
): Promise<RunAgentTurnOutcome> {
	const userRecord = await deps.store.appendChatMessage(
		args.workspaceId,
		args.chatId,
		{ role: "user", content: args.content },
	);

	const { chunks } = await retrieveContext(
		{
			store: deps.store,
			drivers: deps.drivers,
			embedders: deps.embedders,
			logger,
		},
		{
			workspaceId: args.workspaceId,
			knowledgeBaseIds: args.knowledgeBaseIds,
			query: args.content,
			retrievalK: deps.chatConfig.retrievalK,
		},
	);

	// Bounded recent-history window for prompt assembly (see
	// `PROMPT_HISTORY_FETCH_LIMIT`) — avoids a full-partition scan per
	// turn; `assemblePrompt` only keeps the recent tail regardless.
	const history = await deps.store.listRecentChatMessages(
		args.workspaceId,
		args.chatId,
		PROMPT_HISTORY_FETCH_LIMIT,
	);
	const systemPrompt =
		args.systemPrompt ??
		deps.chatConfig.systemPrompt ??
		DEFAULT_AGENT_SYSTEM_PROMPT;
	const prompt = assemblePrompt({
		systemPrompt,
		chunks,
		history,
		userTurn: args.content,
	});

	const completion = await deps.chatService.complete({ messages: prompt });
	const replyText =
		completion.finishReason === "error"
			? (completion.errorMessage ?? "The agent couldn't answer this turn.")
			: completion.content;

	// Force the assistant turn strictly after the user turn so the
	// `message_ts ASC` cluster ordering is unambiguous — the column
	// has ms resolution and a fast model can finish in the same
	// millisecond as the user append, which would otherwise leave the
	// order to a random-UUID tiebreaker.
	const userTs = Date.parse(userRecord.messageTs);
	const assistantTs = new Date(Math.max(userTs + 1, Date.now())).toISOString();

	await deps.store.appendChatMessage(args.workspaceId, args.chatId, {
		role: "agent",
		authorId: args.agentId,
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
		replyText,
		finishReason: completion.finishReason,
		tokenCount: completion.tokenCount,
		errorMessage: completion.errorMessage,
		contextChunkIds: chunks.map((c) => c.chunkId),
	};
}
