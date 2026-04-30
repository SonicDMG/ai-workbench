/**
 * Test-only {@link ChatService} that produces deterministic replies
 * without touching the HuggingFace API. The fake records the last
 * request so tests can assert on the assembled prompt (system role,
 * KB context, history, new turn) without parsing model outputs.
 */

import type {
	ChatCompletion,
	ChatCompletionRequest,
	ChatService,
	ChatStreamEvent,
} from "../../src/chat/types.js";
import type { ChatConfig } from "../../src/config/schema.js";

export interface FakeChatServiceOptions {
	readonly modelId?: string;
	/** Override the canned reply. Defaults to the input echo. */
	readonly reply?: (request: ChatCompletionRequest) => ChatCompletion;
	/** Override the streaming reply. Defaults to chunked-echo of `reply`. */
	readonly streamReply?: (
		request: ChatCompletionRequest,
	) => AsyncIterable<ChatStreamEvent>;
}

export interface FakeChatService extends ChatService {
	readonly calls: ChatCompletionRequest[];
	readonly streamCalls: ChatCompletionRequest[];
}

export function makeFakeChatService(
	opts: FakeChatServiceOptions = {},
): FakeChatService {
	const calls: ChatCompletionRequest[] = [];
	const streamCalls: ChatCompletionRequest[] = [];
	const modelId = opts.modelId ?? "fake-test-model";

	function syncReply(request: ChatCompletionRequest): ChatCompletion {
		if (opts.reply) return opts.reply(request);
		const lastUser = [...request.messages]
			.reverse()
			.find((m) => m.role === "user");
		return {
			content: lastUser
				? `echo: ${lastUser.content}`
				: "(no user turn supplied)",
			finishReason: "stop",
			tokenCount: 42,
			errorMessage: null,
			toolCalls: [],
		};
	}

	return {
		modelId,
		calls,
		streamCalls,
		async complete(request) {
			calls.push(request);
			return syncReply(request);
		},
		completeStream(request, options) {
			streamCalls.push(request);
			if (opts.streamReply) return opts.streamReply(request);
			return defaultStream(syncReply(request), options?.signal);
		},
	};
}

async function* defaultStream(
	completion: ChatCompletion,
	signal: AbortSignal | undefined,
): AsyncIterable<ChatStreamEvent> {
	if (completion.finishReason === "error") {
		yield {
			type: "error",
			errorMessage: completion.errorMessage ?? "unknown",
			tokenCount: completion.tokenCount,
		};
		return;
	}
	// Emit one delta per word so tests can assert on multi-token
	// streams without depending on real tokenizer behavior.
	const parts = completion.content.split(/(\s+)/).filter((s) => s.length > 0);
	for (const part of parts) {
		if (signal?.aborted) {
			yield {
				type: "done",
				content: completion.content,
				finishReason: "stop",
				tokenCount: completion.tokenCount,
			};
			return;
		}
		yield { type: "token", delta: part };
	}
	yield {
		type: "done",
		content: completion.content,
		finishReason: completion.finishReason,
		tokenCount: completion.tokenCount,
	};
}

/**
 * A minimally-valid {@link ChatConfig} for tests. The token ref is
 * never actually resolved because tests bypass {@link buildChatService}
 * and inject the {@link FakeChatService} directly.
 */
export const TEST_CHAT_CONFIG: ChatConfig = {
	tokenRef: "env:TEST_HF_TOKEN",
	model: "fake-test-model",
	maxOutputTokens: 256,
	retrievalK: 4,
	systemPrompt: null,
};
