/**
 * Persistence primitives shared by `dispatchAgentSend` and
 * `dispatchAgentSendStream`.
 *
 * Each helper takes `prevTs` and returns the `messageTs` it minted so
 * the caller can chain — message timestamps must be strictly monotonic
 * so `listChatMessages` returns turns in the order they happened.
 *
 * Pulled out of `agent-dispatch.ts` so the dispatcher there is just the
 * iteration loop. A change to the assistant-message wire shape lands
 * in this single module rather than being copy-pasted across the sync
 * + streaming code paths.
 */

import type { ControlPlaneStore } from "../control-plane/store.js";
import type { AgentRecord, MessageRecord } from "../control-plane/types.js";
import type { Logger } from "../lib/logger.js";
import type { RetrievedChunk } from "./prompt.js";
import { executeWorkspaceTool, type OnToolInvoke } from "./tools/dispatcher.js";
import { parseMcpToolName } from "./tools/providers/remote-mcp.js";
import {
	type AgentToolDeps,
	type AgentToolset,
	classifyToolSource,
} from "./tools/registry.js";
import type { ChatService, ChatTurn, ToolCall } from "./types.js";

export interface PersistTurnDeps {
	readonly store: ControlPlaneStore;
	readonly logger: Pick<Logger, "warn" | "debug">;
}

export interface PersistTurnContext {
	readonly deps: PersistTurnDeps;
	readonly workspaceId: string;
	readonly conversationId: string;
	readonly agent: AgentRecord;
	readonly chatService: ChatService;
	readonly chunks: readonly RetrievedChunk[];
	/**
	 * Per-search-call envelopes captured during chat retrieval. Empty
	 * for non-Astra workspaces or turns where the model didn't call
	 * `search_kb`. The web UI surfaces these as a "view client code"
	 * affordance on the assistant bubble. See
	 * `chat/retrieval.ts:AstraQuerySnapshot`.
	 */
	readonly astraQueries: readonly import("./retrieval.js").AstraQuerySnapshot[];
}

export interface AssistantToolCallTurn {
	readonly content: string;
	readonly toolCalls: readonly ToolCall[];
	readonly tokenCount: number | null;
}

/**
 * Compose the assistant message's `metadata` map. The web UI's
 * `MarkdownContent.tsx` citation parser depends on the
 * `context_chunks` shape — a JSON-encoded array of
 * `[chunkId, knowledgeBaseId, documentId]` tuples — and the
 * `context_document_ids` comma-joined fallback for older clients.
 *
 * `astraQueries` is the per-search-call envelope captured during
 * retrieval; serialized as a JSON array under `astra_queries` for
 * the SPA's "show client code" affordance. Tokens never enter the
 * envelope — the helper that builds it lives in `chat/retrieval.ts`
 * and only captures the collection name, keyspace, query text, and
 * topK.
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
	astraQueries: readonly import("./retrieval.js").AstraQuerySnapshot[] = [],
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
	if (astraQueries.length > 0) {
		metadata.astra_queries = JSON.stringify(astraQueries);
	}
	if (completion.errorMessage) {
		metadata.error_message = completion.errorMessage;
	}
	return metadata;
}

export async function persistAssistantToolCallTurn(
	ctx: PersistTurnContext,
	prevTs: string,
	turn: AssistantToolCallTurn,
): Promise<string> {
	const ts = strictlyAfter(prevTs);
	await ctx.deps.store.appendChatMessage(ctx.workspaceId, ctx.conversationId, {
		role: "agent",
		authorId: ctx.agent.agentId,
		messageTs: ts,
		content: turn.content,
		tokenCount: turn.tokenCount,
		toolCallPayload: { toolCalls: turn.toolCalls },
		metadata: {
			model: ctx.chatService.modelId,
			finish_reason: "tool_calls",
		},
	});
	return ts;
}

export async function persistToolResult(
	ctx: PersistTurnContext,
	prevTs: string,
	call: ToolCall,
	resultText: string,
): Promise<string> {
	const ts = strictlyAfter(prevTs);
	await ctx.deps.store.appendChatMessage(ctx.workspaceId, ctx.conversationId, {
		role: "tool",
		messageTs: ts,
		toolId: call.name,
		toolResponse: { content: resultText, toolCallId: call.id },
	});
	return ts;
}

export async function persistFinalAssistant(
	ctx: PersistTurnContext,
	prevTs: string,
	args: {
		readonly content: string;
		readonly tokenCount: number | null;
		readonly finishReason: "stop" | "length" | "tool_calls" | "error";
		readonly errorMessage?: string | null;
	},
): Promise<MessageRecord> {
	const ts = strictlyAfter(prevTs);
	return await ctx.deps.store.appendChatMessage(
		ctx.workspaceId,
		ctx.conversationId,
		{
			role: "agent",
			authorId: ctx.agent.agentId,
			messageTs: ts,
			content: args.content,
			tokenCount: args.tokenCount,
			metadata: buildAgentMetadata(
				ctx.chunks,
				ctx.chatService.modelId,
				{
					finishReason: args.finishReason,
					errorMessage: args.errorMessage ?? null,
				},
				ctx.astraQueries,
			),
		},
	);
}

/**
 * Run the model-side tool-execution loop. Returns either the persisted
 * tool-call turn (so the caller can append a `turns` entry and emit any
 * SSE side-effects) or signals the caller to terminate (final answer
 * already persisted, or the tool list was empty).
 *
 * Kept as a helper rather than a full loop unifier because the
 * non-streaming dispatcher decides "final answer or continue" based on
 * `completion.toolCalls`, while the streaming dispatcher must also
 * decide whether to flush its token buffer — different enough that
 * keeping the two outer loops readable beats one over-clever loop.
 *
 * `onToolInvoke` is the audit seam: fired once per tool call with the
 * tool name + outcome (success / failure / denied) — but never the
 * arguments. The route layer supplies a closure that emits a
 * `tool.invoke` audit event, so this module stays free of any audit
 * coupling (mirrors the `onToolInvoke` hook in `mcp/server.ts`). Fired
 * before `onResult` so the audit row is written even if the SSE write
 * (or persistence) downstream throws.
 */
export async function executeToolCalls(
	ctx: PersistTurnContext,
	resolved: {
		readonly toolDeps: AgentToolDeps;
		readonly toolset: AgentToolset;
	},
	toolCalls: readonly ToolCall[],
	startTs: string,
	onResult?: (call: ToolCall, resultText: string) => Promise<void>,
	onToolInvoke?: OnToolInvoke,
): Promise<{
	readonly endTs: string;
	readonly turns: readonly ChatTurn[];
}> {
	let prevTs = startTs;
	const turns: ChatTurn[] = [];
	for (const call of toolCalls) {
		const { resultText, outcome, reason } = await executeWorkspaceTool(
			call,
			resolved.toolset,
			resolved.toolDeps,
		);
		// Emit the audit signal first — args are deliberately omitted.
		if (onToolInvoke) {
			const mcpServerId = parseMcpToolName(call.name)?.mcpServerId;
			onToolInvoke({
				toolName: call.name,
				outcome,
				source: classifyToolSource(call.name),
				...(mcpServerId ? { mcpServerId } : {}),
				...(reason ? { reason } : {}),
			});
		}
		prevTs = await persistToolResult(ctx, prevTs, call, resultText);
		turns.push({
			role: "tool",
			toolCallId: call.id,
			name: call.name,
			content: resultText,
		});
		// Fire the per-call hook *after* persistence so the streaming
		// dispatcher can emit a `tool-result` SSE event as soon as the
		// row is durable — matches the old behavior of "one result on
		// the wire as soon as the tool finishes."
		if (onResult) await onResult(call, resultText);
	}
	return { endTs: prevTs, turns };
}

/**
 * Stamp a timestamp strictly after `prev` (ISO-8601). Guarantees
 * monotonic ordering of cluster-keyed message rows even when a fast
 * model emits its terminal event in the same millisecond as the
 * preceding write.
 */
export function strictlyAfter(prevIso: string): string {
	const prev = Date.parse(prevIso);
	return new Date(Math.max(prev + 1, Date.now())).toISOString();
}
