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
import type { ChatTurn } from "./types.js";

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
			// Drop empty placeholders or rows that were persisted with
			// `finish_reason: "error"` — re-sending them confuses the
			// model and just wastes tokens.
			if (
				m.content &&
				m.content.length > 0 &&
				m.metadata.finish_reason !== "error"
			) {
				historyTurns.push({ role: "assistant", content: m.content });
			}
		}
		// `system` and `tool` history rows are intentionally skipped —
		// the system prompt is rebuilt from current persona+context
		// every turn, and tool turns aren't part of v0.
	}

	// Keep the tail (most recent) under the limit.
	const trimmed =
		historyTurns.length > limit
			? historyTurns.slice(historyTurns.length - limit)
			: historyTurns;
	turns.push(...trimmed);

	turns.push({ role: "user", content: input.userTurn });
	return turns;
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
