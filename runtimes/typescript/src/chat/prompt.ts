/**
 * Pure prompt-assembly for the agent chat surface. Given a system prompt,
 * a set of retrieved KB chunks, the conversation history, and a new
 * user turn, produce the ordered list of {@link ChatTurn}s to send
 * to the model.
 *
 * The function is deliberately stateless — easier to unit-test, no
 * surprise behavior tied to time or env. The caller controls
 * truncation by pre-trimming history before invoking.
 */

import type { MessageRecord } from "../control-plane/types.js";
import type { ChatTurn, ToolCall } from "./types.js";

/**
 * One chunk of KB content injected into the system context block.
 * Used by both the prompt assembler (for the model) and the route
 * layer (for `metadata.context_document_ids` provenance).
 */
export interface RetrievedChunk {
	readonly chunkId: string;
	readonly knowledgeBaseId: string;
	readonly documentId: string | null;
	readonly content: string;
	readonly score: number;
}

export interface AssemblePromptInput {
	readonly systemPrompt: string;
	readonly chunks: readonly RetrievedChunk[];
	/**
	 * Prior turns in oldest-first order. Already-persisted assistant
	 * placeholder rows (empty content, `finish_reason: "error"`) are
	 * dropped by the assembler so the model doesn't see incomplete
	 * turns.
	 */
	readonly history: readonly MessageRecord[];
	readonly userTurn: string;
	/**
	 * Maximum prior turns (user + assistant pairs combined) included.
	 * Older turns are dropped from the head — recency over
	 * completeness, since chat-completion APIs penalize long prompts
	 * and v0 has no summarization step.
	 */
	readonly historyLimit?: number;
}

const DEFAULT_HISTORY_LIMIT = 16;

/**
 * Build the model-facing turn list:
 *
 *   1. A `system` turn with the persona prompt + the retrieved
 *      context block (chunks delimited so the model can cite them).
 *   2. The most recent N history turns, in chronological order,
 *      with internal `tool` rows filtered out (no tools wired in v0)
 *      and empty / errored assistant placeholders dropped.
 *   3. The new `user` turn.
 *
 * No retrieval, no I/O — pure function.
 */
export function assemblePrompt(
	input: AssemblePromptInput,
): readonly ChatTurn[] {
	const limit = input.historyLimit ?? DEFAULT_HISTORY_LIMIT;
	const turns: ChatTurn[] = [];

	turns.push({
		role: "system",
		content: buildSystemPromptWithContext(input.systemPrompt, input.chunks),
	});

	const historyTurns: ChatTurn[] = [];
	for (const m of input.history) {
		if (m.role === "user") {
			if (m.content && m.content.length > 0) {
				historyTurns.push({ role: "user", content: m.content });
			}
		} else if (m.role === "agent") {
			// Drop rows that were persisted with `finish_reason: "error"`
			// — re-sending them confuses the model and just wastes
			// tokens. Empty-content rows are kept ONLY when they carry
			// tool_calls, since the model still needs to see its own
			// tool-call history to make sense of the tool turns that
			// follow.
			if (m.metadata.finish_reason === "error") continue;
			const persistedToolCalls = decodePersistedToolCalls(m.toolCallPayload);
			if (persistedToolCalls.length > 0) {
				historyTurns.push({
					role: "assistant",
					content: m.content ?? "",
					toolCalls: persistedToolCalls,
				});
			} else if (m.content && m.content.length > 0) {
				historyTurns.push({ role: "assistant", content: m.content });
			}
		} else if (m.role === "tool") {
			// Tool result rows are persisted as `role:"tool"` with the
			// tool name in `toolId` and `{ content, toolCallId }` in
			// `toolResponse`. Skip rows that don't match — they're either
			// in-flight placeholders or pre-tool-loop legacy rows.
			const tr = m.toolResponse;
			if (
				tr &&
				typeof tr.content === "string" &&
				typeof tr.toolCallId === "string" &&
				m.toolId
			) {
				historyTurns.push({
					role: "tool",
					toolCallId: tr.toolCallId,
					name: m.toolId,
					content: tr.content,
				});
			}
		}
		// `system` history rows are intentionally skipped — the system
		// prompt is rebuilt from current persona+context every turn.
	}

	// Keep the tail (most recent) under the limit, then prune any
	// orphan tool turns at the head — i.e. tool results whose
	// preceding `assistant(toolCalls)` got trimmed out, which OpenAI
	// rejects with a 400.
	const trimmed =
		historyTurns.length > limit
			? historyTurns.slice(historyTurns.length - limit)
			: historyTurns;
	turns.push(...stripOrphanToolTurns(trimmed));

	turns.push({ role: "user", content: input.userTurn });
	return turns;
}

/**
 * Strip leading `tool` turns whose matching `assistant(toolCalls)`
 * isn't in the slice. The OpenAI Chat Completions API rejects a tool
 * message that doesn't have a corresponding assistant tool_call_id
 * earlier in the conversation, so we have to drop them rather than
 * leak history-trim leakage into the next request.
 */
function stripOrphanToolTurns(turns: readonly ChatTurn[]): ChatTurn[] {
	const seenIds = new Set<string>();
	const out: ChatTurn[] = [];
	for (const t of turns) {
		if (t.role === "assistant" && t.toolCalls) {
			for (const tc of t.toolCalls) seenIds.add(tc.id);
			out.push(t);
		} else if (t.role === "tool") {
			if (seenIds.has(t.toolCallId)) out.push(t);
			// else: orphan; silently drop.
		} else {
			out.push(t);
		}
	}
	return out;
}

/**
 * Decode the `toolCallPayload` map persisted on an assistant
 * `MessageRecord` back into structured {@link ToolCall}s. Tolerant
 * of legacy rows that don't have the field set, and of partial /
 * malformed payloads (skip silently — the alternative is failing the
 * whole turn just because one prior call's payload is corrupt).
 */
function decodePersistedToolCalls(
	payload: Readonly<Record<string, unknown>> | null,
): readonly ToolCall[] {
	if (!payload) return [];
	const calls = payload.toolCalls;
	if (!Array.isArray(calls)) return [];
	const out: ToolCall[] = [];
	for (const c of calls) {
		if (
			c &&
			typeof c === "object" &&
			typeof (c as { id?: unknown }).id === "string" &&
			typeof (c as { name?: unknown }).name === "string" &&
			typeof (c as { arguments?: unknown }).arguments === "string"
		) {
			out.push(c as ToolCall);
		}
	}
	return out;
}

/**
 * Builds the `system` turn body. The context block is a labeled list
 * of chunks so the model can cite them as `[chunkId]` per the
 * persona prompt's instructions. Empty context = persona prompt
 * alone, which is the right behavior when the agent has no KBs to
 * ground in.
 */
function buildSystemPromptWithContext(
	systemPrompt: string,
	chunks: readonly RetrievedChunk[],
): string {
	if (chunks.length === 0) {
		return systemPrompt;
	}
	const formatted = chunks
		.map(
			(chunk) =>
				`[${chunk.chunkId}] (kb=${chunk.knowledgeBaseId})\n${chunk.content}`,
		)
		.join("\n\n---\n\n");
	return `${systemPrompt}\n\n<context>\n${formatted}\n</context>`;
}
