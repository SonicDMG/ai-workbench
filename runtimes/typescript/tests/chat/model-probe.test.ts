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
import {
	classifyProbeFailure,
	isModelUnavailableError,
	isNotChatModelError,
} from "../../src/chat/model-probe.js";

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

	test("does NOT match the not-routable signal (that's a different code)", () => {
		expect(
			isNotChatModelError(
				"The requested model 'Qwen/Qwen2.5-7B-Instruct' is not supported by any provider you have enabled.",
			),
		).toBe(false);
	});
});

describe("isModelUnavailableError", () => {
	test("matches the router's not-supported-by-any-provider phrasing", () => {
		expect(
			isModelUnavailableError(
				"Failed to perform inference: The requested model 'Qwen/Qwen2.5-7B-Instruct' is not supported by any provider you have enabled.",
			),
		).toBe(true);
	});

	test("matches the machine code 'model_not_supported'", () => {
		expect(
			isModelUnavailableError("400 Bad Request (model_not_supported)"),
		).toBe(true);
	});

	test("does NOT match transient transport / rate-limit errors (fail-open)", () => {
		expect(isModelUnavailableError("429 Too Many Requests")).toBe(false);
		expect(isModelUnavailableError("fetch failed: ENOTFOUND")).toBe(false);
		expect(
			isModelUnavailableError("Model is currently loading; retry in 20s"),
		).toBe(false);
	});
});

describe("classifyProbeFailure", () => {
	test("routes the not-a-chat-model signal to llm_model_not_chat", () => {
		expect(classifyProbeFailure('Model "x" is not a chat model.')).toBe(
			"llm_model_not_chat",
		);
	});

	test("routes the not-routable signal to llm_model_unavailable", () => {
		expect(
			classifyProbeFailure(
				"The requested model 'x' is not supported by any provider you have enabled.",
			),
		).toBe("llm_model_unavailable");
	});

	test("returns null for indeterminate failures (fail-open)", () => {
		expect(classifyProbeFailure("429 Too Many Requests")).toBeNull();
		expect(classifyProbeFailure("model is currently loading")).toBeNull();
	});
});
