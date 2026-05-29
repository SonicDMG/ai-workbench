import { describe, expect, it } from "vitest";
import type { ChatStreamUiEvent } from "@/lib/chatStream";
import {
	formatToolArguments,
	reduceToolCards,
	type ToolCardState,
} from "@/lib/toolCards";

/** Fold a sequence of events through the reducer from an empty start. */
function fold(events: readonly ChatStreamUiEvent[]): readonly ToolCardState[] {
	return events.reduce<readonly ToolCardState[]>(
		(cards, evt) => reduceToolCards(cards, evt),
		[],
	);
}

describe("reduceToolCards", () => {
	it("adds a running card on tool-call, flips it to done on its result", () => {
		const cards = fold([
			{
				type: "tool-call",
				toolCalls: [
					{ id: "c1", name: "search_kb", arguments: '{"query":"hi"}' },
				],
			},
		]);
		expect(cards).toHaveLength(1);
		expect(cards[0]).toMatchObject({
			id: "c1",
			name: "search_kb",
			status: "running",
			result: null,
		});

		const resolved = reduceToolCards(cards, {
			type: "tool-result",
			toolCallId: "c1",
			name: "search_kb",
			content: "3 hits",
		});
		expect(resolved[0]).toMatchObject({
			id: "c1",
			status: "done",
			result: "3 hits",
		});
		// Original array is not mutated (immutable update).
		expect(cards[0]?.status).toBe("running");
	});

	it("preserves insertion order across interleaved calls and results", () => {
		const cards = fold([
			{
				type: "tool-call",
				toolCalls: [{ id: "a", name: "list_kbs", arguments: "{}" }],
			},
			// token-reset / token events between iterations don't touch cards.
			{ type: "token-reset" },
			{ type: "token", delta: "thinking" },
			{
				type: "tool-call",
				toolCalls: [{ id: "b", name: "search_kb", arguments: "{}" }],
			},
			{
				type: "tool-result",
				toolCallId: "a",
				name: "list_kbs",
				content: "two",
			},
			{
				type: "tool-result",
				toolCallId: "b",
				name: "search_kb",
				content: "hit",
			},
		]);
		expect(cards.map((c) => c.id)).toEqual(["a", "b"]);
		expect(cards.every((c) => c.status === "done")).toBe(true);
		expect(cards.map((c) => c.result)).toEqual(["two", "hit"]);
	});

	it("handles a multi-call tool-call event (parallel calls)", () => {
		const cards = fold([
			{
				type: "tool-call",
				toolCalls: [
					{ id: "x", name: "list_kbs", arguments: "{}" },
					{ id: "y", name: "count_documents", arguments: "{}" },
				],
			},
			{
				type: "tool-result",
				toolCallId: "y",
				name: "count_documents",
				content: "12",
			},
		]);
		expect(cards.map((c) => c.id)).toEqual(["x", "y"]);
		expect(cards[0]?.status).toBe("running");
		expect(cards[1]?.status).toBe("done");
	});

	it("ignores a duplicate tool-call announcement for the same id", () => {
		const cards = fold([
			{
				type: "tool-call",
				toolCalls: [{ id: "dup", name: "search_kb", arguments: "{}" }],
			},
			{
				type: "tool-call",
				toolCalls: [{ id: "dup", name: "search_kb", arguments: "{}" }],
			},
		]);
		expect(cards).toHaveLength(1);
	});

	it("surfaces a result whose id has no matching announcement", () => {
		const cards = reduceToolCards([], {
			type: "tool-result",
			toolCallId: "orphan",
			name: "native:fetch",
			content: "body",
		});
		expect(cards).toHaveLength(1);
		expect(cards[0]).toMatchObject({
			id: "orphan",
			status: "done",
			result: "body",
		});
	});

	it("leaves the list untouched for non-tool events", () => {
		const base: readonly ToolCardState[] = [
			{
				id: "c1",
				name: "search_kb",
				arguments: "{}",
				result: null,
				status: "running",
			},
		];
		expect(reduceToolCards(base, { type: "token", delta: "x" })).toBe(base);
		expect(reduceToolCards(base, { type: "token-reset" })).toBe(base);
	});
});

describe("formatToolArguments", () => {
	it("pretty-prints valid JSON", () => {
		expect(formatToolArguments('{"query":"hi","limit":3}')).toBe(
			'{\n  "query": "hi",\n  "limit": 3\n}',
		);
	});

	it("returns the raw string for non-JSON input", () => {
		expect(formatToolArguments("not json{")).toBe("not json{");
	});

	it("returns empty string for blank arguments", () => {
		expect(formatToolArguments("   ")).toBe("");
		expect(formatToolArguments("")).toBe("");
	});
});
