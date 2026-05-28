/**
 * Unit coverage for the OpenAI-compatible chat-model probe classifier.
 *
 * The classifier is the load-bearing piece: a false positive blocks a
 * legitimate LLM-service save, so it must match the definitive
 * "model unusable" phrasings (OpenRouter's "no endpoints found",
 * OpenAI's `model_not_found`, etc.) and nothing transient. The live
 * probe itself is a thin wrapper over {@link OpenAIChatService.complete}
 * (already covered) — here we assert the signals are recognised and
 * everything else fails open.
 */

import { describe, expect, test } from "vitest";
import {
	classifyProbeFailure,
	isModelUnavailableError,
	isNotChatModelError,
} from "../../src/chat/model-probe.js";

describe("isNotChatModelError", () => {
	test("matches the 'is not a chat model' phrasing", () => {
		expect(isNotChatModelError('Model "some/model" is not a chat model.')).toBe(
			true,
		);
	});

	test("matches 'does not support chat' wording", () => {
		expect(
			isNotChatModelError("This model does not support chat completions."),
		).toBe(true);
	});

	test("does NOT match an empty-completion failure (fail-open)", () => {
		expect(
			isNotChatModelError(
				"openrouter returned an empty completion — try again, or pick a different model.",
			),
		).toBe(false);
	});

	test("does NOT match transient transport / rate-limit errors (fail-open)", () => {
		expect(isNotChatModelError("429 Too Many Requests")).toBe(false);
		expect(isNotChatModelError("fetch failed: ENOTFOUND")).toBe(false);
		expect(isNotChatModelError("401 Unauthorized: invalid token")).toBe(false);
	});

	test("does NOT match the model-unavailable signal (that's a different code)", () => {
		expect(
			isNotChatModelError("No endpoints found for openai/bogus-model."),
		).toBe(false);
	});
});

describe("isModelUnavailableError", () => {
	test("matches OpenRouter's 'no endpoints found' phrasing", () => {
		expect(
			isModelUnavailableError(
				"openrouter returned HTTP 404: No endpoints found for openai/bogus-model.",
			),
		).toBe(true);
	});

	test("matches OpenAI's machine code 'model_not_found'", () => {
		expect(
			isModelUnavailableError(
				'openai returned HTTP 404: {"error":{"code":"model_not_found"}}',
			),
		).toBe(true);
	});

	test("matches 'does not exist' / 'is not a valid model' variants", () => {
		expect(isModelUnavailableError("The model `gpt-9` does not exist.")).toBe(
			true,
		);
		expect(isModelUnavailableError("`x` is not a valid model id.")).toBe(true);
	});

	test("does NOT match transient transport / rate-limit errors (fail-open)", () => {
		expect(isModelUnavailableError("429 Too Many Requests")).toBe(false);
		expect(isModelUnavailableError("fetch failed: ENOTFOUND")).toBe(false);
	});
});

describe("classifyProbeFailure", () => {
	test("routes the not-a-chat-model signal to llm_model_not_chat", () => {
		expect(classifyProbeFailure('Model "x" is not a chat model.')).toBe(
			"llm_model_not_chat",
		);
	});

	test("routes the model-unavailable signal to llm_model_unavailable", () => {
		expect(
			classifyProbeFailure("No endpoints found for openai/bogus-model."),
		).toBe("llm_model_unavailable");
	});

	test("returns null for indeterminate failures (fail-open)", () => {
		expect(classifyProbeFailure("429 Too Many Requests")).toBeNull();
		expect(classifyProbeFailure("connection reset")).toBeNull();
	});
});
