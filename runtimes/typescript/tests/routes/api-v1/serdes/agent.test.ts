/**
 * Unit tests for the chat-message wire predicates.
 *
 * `isUserVisibleMessage` filters internal scaffolding turns (tool
 * results + the model's pre-tool-call placeholders) out of the public
 * chat transcript. They stay in the store so `assemblePrompt` can
 * still replay the full tool-call loop on subsequent turns; this
 * predicate just keeps them out of the UI.
 */

import { describe, expect, test } from "vitest";
import type { MessageRecord } from "../../../../src/control-plane/types.js";
import { isUserVisibleMessage } from "../../../../src/routes/api-v1/serdes/agent.js";

function record(overrides: Partial<MessageRecord>): MessageRecord {
	return {
		workspaceId: "ws",
		conversationId: "conv",
		messageId: "msg",
		messageTs: "2026-05-01T00:00:00.000Z",
		role: "user",
		authorId: null,
		content: "hi",
		toolId: null,
		toolCallPayload: null,
		toolResponse: null,
		tokenCount: null,
		metadata: {},
		...overrides,
	};
}

describe("isUserVisibleMessage", () => {
	test("user turns are always visible", () => {
		expect(isUserVisibleMessage(record({ role: "user", content: "hi" }))).toBe(
			true,
		);
		// A user turn with empty content shouldn't happen in practice but
		// must never be silently dropped.
		expect(isUserVisibleMessage(record({ role: "user", content: "" }))).toBe(
			true,
		);
	});

	test("agent turns with real text are visible", () => {
		expect(
			isUserVisibleMessage(
				record({
					role: "agent",
					content: "Here's your answer.",
					metadata: { model: "gpt-4o-mini", finish_reason: "stop" },
				}),
			),
		).toBe(true);
	});

	test("agent turn with empty content + tool_calls finish reason is hidden", () => {
		// This is the model's pre-tool-call placeholder — the bubble that
		// previously rendered as a blank agent message in the UI.
		expect(
			isUserVisibleMessage(
				record({
					role: "agent",
					content: "",
					metadata: { model: "gpt-4o-mini", finish_reason: "tool_calls" },
				}),
			),
		).toBe(false);
	});

	test("agent turn with empty content but finish_reason: stop stays visible", () => {
		// A model that legitimately returned no text on a `stop` turn is
		// rare but possible (and arguably a model error worth surfacing) —
		// we only hide the tool-call placeholder shape.
		expect(
			isUserVisibleMessage(
				record({
					role: "agent",
					content: "",
					metadata: { model: "gpt-4o-mini", finish_reason: "stop" },
				}),
			),
		).toBe(true);
	});

	test("tool rows are always hidden from the public listing", () => {
		expect(
			isUserVisibleMessage(
				record({
					role: "tool",
					content: null,
					toolResponse: { content: "tool result", toolCallId: "call-1" },
				}),
			),
		).toBe(false);
	});

	test("agent turn with null content + tool_calls finish reason is hidden", () => {
		// Defensive: some persistence paths may write `null` instead of
		// `""` for an empty pre-tool-call turn. Same UX impact.
		expect(
			isUserVisibleMessage(
				record({
					role: "agent",
					content: null,
					metadata: { finish_reason: "tool_calls" },
				}),
			),
		).toBe(false);
	});

	test("system turns pass through", () => {
		expect(
			isUserVisibleMessage(
				record({ role: "system", content: "system prompt" }),
			),
		).toBe(true);
	});
});
