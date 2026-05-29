/**
 * Pure reducer turning the chat SSE event stream into the ordered list
 * of tool-call cards the transcript renders during an in-flight turn.
 *
 * The agent dispatch loop interleaves token deltas with tool calls:
 *
 *   user-message → token* → token-reset → tool-call → tool-result+ →
 *   token* → done
 *
 * A `tool-call` event announces one or more calls (`{ id, name,
 * arguments }`); a later `tool-result` carries the output keyed by
 * `toolCallId`. We fold those into a stable, insertion-ordered list of
 * {@link ToolCardState} so the UI can show each call as an expandable
 * card that flips from `running` to `done` the moment its result lands.
 *
 * Kept framework-free (no React) so it can be unit-tested directly and
 * reused by the streaming hook without pulling in render concerns.
 */

import type { ChatStreamUiEvent } from "@/lib/chatStream";

/** Lifecycle of a single tool-call card. */
export type ToolCardStatus = "running" | "done";

export interface ToolCardState {
	/** Tool-call id from the model; the join key to its result. */
	readonly id: string;
	/** Tool name (namespaced for native/astra/mcp tools). */
	readonly name: string;
	/** Raw argument JSON the model produced (string on the wire). */
	readonly arguments: string;
	/** Result body once the `tool-result` event arrives; null while running. */
	readonly result: string | null;
	readonly status: ToolCardStatus;
}

/**
 * Apply one stream event to the current card list, returning a NEW list
 * (immutable update). Non-tool events leave the list untouched —
 * `token-reset`, `done`, etc. are handled by the streaming hook's other
 * state. A `tool-result` whose id matches no known card is appended as a
 * `done` card with empty args, so an out-of-order result is never lost.
 */
export function reduceToolCards(
	cards: readonly ToolCardState[],
	event: ChatStreamUiEvent,
): readonly ToolCardState[] {
	if (event.type === "tool-call") {
		// Append each announced call as a `running` card, skipping ids we
		// already track (defensive against a duplicate announcement).
		const known = new Set(cards.map((c) => c.id));
		const additions = event.toolCalls
			.filter((tc) => !known.has(tc.id))
			.map(
				(tc): ToolCardState => ({
					id: tc.id,
					name: tc.name,
					arguments: tc.arguments,
					result: null,
					status: "running",
				}),
			);
		return additions.length > 0 ? [...cards, ...additions] : cards;
	}
	if (event.type === "tool-result") {
		const idx = cards.findIndex((c) => c.id === event.toolCallId);
		if (idx === -1) {
			// Result with no matching announcement — surface it anyway.
			return [
				...cards,
				{
					id: event.toolCallId,
					name: event.name,
					arguments: "",
					result: event.content,
					status: "done",
				},
			];
		}
		const next = [...cards];
		next[idx] = {
			...(cards[idx] as ToolCardState),
			result: event.content,
			status: "done",
		};
		return next;
	}
	return cards;
}

/**
 * Best-effort pretty-print of a tool-call argument JSON string. Falls
 * back to the raw string when it isn't valid JSON (the model can emit
 * a partial/garbled payload). An empty/whitespace string returns "".
 */
export function formatToolArguments(raw: string): string {
	const trimmed = raw.trim();
	if (trimmed.length === 0) return "";
	try {
		return JSON.stringify(JSON.parse(trimmed), null, 2);
	} catch {
		return raw;
	}
}
