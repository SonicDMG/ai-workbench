/**
 * Deterministic {@link ChatService} for conformance / tests.
 *
 * Replays a scripted reply (sync) and scripted token stream (async)
 * verbatim. Never reaches the network, never reads `process.env`,
 * never depends on a real provider. Used by the conformance harness
 * to capture stable wire shapes for the chat surface without
 * standing up a fake HF / OpenAI server.
 *
 * Intentionally simple: one script per service instance. Scenarios
 * that need different replies for different turns get different
 * instances (the harness builds one per scenario).
 */

import type {
	ChatCompletion,
	ChatCompletionRequest,
	ChatFinishReason,
	ChatService,
	ChatStreamEvent,
	ChatStreamOptions,
} from "./types.js";

export interface FixtureChatScript {
	/**
	 * Tokens emitted in order on the streaming path. The sync path
	 * concatenates them when `reply` is omitted.
	 */
	readonly tokens?: readonly string[];
	/**
	 * Sync reply. Defaults to `tokens.join("")` when omitted.
	 */
	readonly reply?: string;
	readonly finishReason?: ChatFinishReason;
	readonly tokenCount?: number | null;
	readonly modelId?: string;
}

export class FixtureChatService implements ChatService {
	readonly providerId = "fixture";
	readonly modelId: string;
	private readonly script: FixtureChatScript;

	constructor(script: FixtureChatScript = {}) {
		this.script = script;
		this.modelId = script.modelId ?? "fixture-test-model";
	}

	async complete(_request: ChatCompletionRequest): Promise<ChatCompletion> {
		const content = this.script.reply ?? (this.script.tokens ?? []).join("");
		return {
			content,
			finishReason: this.script.finishReason ?? "stop",
			tokenCount: this.script.tokenCount ?? null,
			errorMessage: null,
			toolCalls: [],
		};
	}

	async *completeStream(
		_request: ChatCompletionRequest,
		options?: ChatStreamOptions,
	): AsyncIterable<ChatStreamEvent> {
		const tokens =
			this.script.tokens ??
			(this.script.reply !== undefined ? [this.script.reply] : []);
		for (const token of tokens) {
			if (options?.signal?.aborted) return;
			yield { type: "token", delta: token };
		}
		const content = this.script.reply ?? tokens.join("");
		yield {
			type: "done",
			content,
			finishReason: this.script.finishReason ?? "stop",
			tokenCount: this.script.tokenCount ?? null,
		};
	}
}
