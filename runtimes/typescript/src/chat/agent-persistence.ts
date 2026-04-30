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
import { executeWorkspaceTool } from "./tools/dispatcher.js";
import type { AgentToolDeps } from "./tools/registry.js";
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
			metadata: buildAgentMetadata(ctx.chunks, ctx.chatService.modelId, {
				finishReason: args.finishReason,
				errorMessage: args.errorMessage ?? null,
			}),
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
 */
export async function executeToolCalls(
	ctx: PersistTurnContext,
	resolved: { readonly toolDeps: AgentToolDeps },
	toolCalls: readonly ToolCall[],
	startTs: string,
	onResult?: (call: ToolCall, resultText: string) => Promise<void>,
): Promise<{
	readonly endTs: string;
	readonly turns: readonly ChatTurn[];
}> {
	let prevTs = startTs;
	const turns: ChatTurn[] = [];
	for (const call of toolCalls) {
		const resultText = await executeWorkspaceTool(call, resolved.toolDeps);
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
