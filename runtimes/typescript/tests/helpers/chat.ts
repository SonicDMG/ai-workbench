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
} from "../../src/chat/types.js";
import type { ChatConfig } from "../../src/config/schema.js";

export interface FakeChatServiceOptions {
	readonly modelId?: string;
	/** Override the canned reply. Defaults to the input echo. */
	readonly reply?: (request: ChatCompletionRequest) => ChatCompletion;
}

export interface FakeChatService extends ChatService {
	readonly calls: ChatCompletionRequest[];
}

export function makeFakeChatService(
	opts: FakeChatServiceOptions = {},
): FakeChatService {
	const calls: ChatCompletionRequest[] = [];
	const modelId = opts.modelId ?? "fake-test-model";
	return {
		modelId,
		calls,
		async complete(request) {
			calls.push(request);
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
			};
		},
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
