/**
 * Unit coverage for the HuggingFace chat-model probe classifier.
 *
 * The classifier is the load-bearing piece: a false positive blocks a
 * legitimate LLM-service save, so it must match the router's
 * task-mismatch phrasings and nothing else. The live probe itself is a
 * thin wrapper over {@link HuggingFaceChatService.complete} (already
 * covered) — here we assert the not-a-chat-model signal is recognised
 * and that everything else fails open.
 */

import { describe, expect, test } from "vitest";
import { isNotChatModelError } from "../../src/chat/model-probe.js";

describe("isNotChatModelError", () => {
	test("matches the canonical HF router phrasing", () => {
		expect(
			isNotChatModelError(
				'HuggingFace inference failed: Model "mistralai/Mistral-7B-Instruct-v0.3" is not a chat model.',
			),
		).toBe(true);
	});

	test("matches 'not supported for task' wording", () => {
		expect(
			isNotChatModelError(
				"Task conversational not supported for model some/model.",
			),
		).toBe(true);
	});

	test("matches 'task conversational is not ...' wording", () => {
		expect(
			isNotChatModelError(
				"The task 'conversational' is not enabled for this model.",
			),
		).toBe(true);
	});

	test("does NOT match an empty-completion failure (fail-open)", () => {
		expect(
			isNotChatModelError(
				"HuggingFace returned an empty completion — try again, or pick a different model.",
			),
		).toBe(false);
	});

	test("does NOT match transient transport / rate-limit errors (fail-open)", () => {
		expect(isNotChatModelError("429 Too Many Requests")).toBe(false);
		expect(isNotChatModelError("fetch failed: ENOTFOUND")).toBe(false);
		expect(
			isNotChatModelError("Model is currently loading; retry in 20s"),
		).toBe(false);
		expect(isNotChatModelError("401 Unauthorized: invalid token")).toBe(false);
	});
});
