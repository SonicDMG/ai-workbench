/**
 * HuggingFace Inference API implementation of {@link ChatService}.
 *
 * Wraps `@huggingface/inference`'s `chatCompletion` task — the OpenAI-
 * compatible non-streaming endpoint. Token failures, rate limits,
 * and empty / malformed responses are converted into a
 * `finishReason: "error"` outcome so the route layer can persist a
 * row instead of bubbling exceptions to the user.
 */

import { InferenceClient } from "@huggingface/inference";
import { safeErrorMessage } from "../lib/safe-error.js";
import type {
	ChatCompletion,
	ChatCompletionRequest,
	ChatService,
	ChatStreamEvent,
	ChatStreamOptions,
} from "./types.js";

export interface HuggingFaceChatServiceOptions {
	readonly token: string;
	readonly modelId: string;
	readonly maxOutputTokens: number;
}

export class HuggingFaceChatService implements ChatService {
	readonly modelId: string;
	private readonly client: InferenceClient;
	private readonly maxOutputTokens: number;

	constructor(opts: HuggingFaceChatServiceOptions) {
		this.modelId = opts.modelId;
		this.client = new InferenceClient(opts.token);
		this.maxOutputTokens = opts.maxOutputTokens;
	}

	async complete(request: ChatCompletionRequest): Promise<ChatCompletion> {
		try {
			const out = await this.client.chatCompletion({
				model: this.modelId,
				max_tokens: this.maxOutputTokens,
				messages: toHuggingFaceMessages(request.messages),
			});
			const choice = out.choices[0];
			const content = choice?.message.content?.trim() ?? "";
			if (content.length === 0) {
				return {
					content: "",
					finishReason: "error",
					tokenCount: out.usage?.total_tokens ?? null,
					errorMessage:
						"HuggingFace returned an empty completion — try again, or pick a different model.",
					toolCalls: [],
				};
			}
			return {
				content,
				finishReason: normalizeFinishReason(choice?.finish_reason),
				tokenCount: out.usage?.total_tokens ?? null,
				errorMessage: null,
				toolCalls: [],
			};
		} catch (err) {
			return {
				content: "",
				finishReason: "error",
				tokenCount: null,
				errorMessage: `HuggingFace inference failed: ${safeErrorMessage(err)}`,
				toolCalls: [],
			};
		}
	}
}

/**
 * Project our tagged-union {@link ChatTurn}s into the flat
 * `{role, content}` shape HF's chat-completion API expects. HF doesn't
 * support tool turns at all — when the dispatcher (mistakenly) sends
 * one through this provider, fold it into a system message so the
 * model still sees the tool's output rather than dropping it silently.
 */
function toHuggingFaceMessages(
	turns: readonly ChatCompletionRequest["messages"][number][],
): { role: "system" | "user" | "assistant"; content: string }[] {
	const out: { role: "system" | "user" | "assistant"; content: string }[] = [];
	for (const turn of turns) {
		if (turn.role === "tool") {
			out.push({
				role: "system",
				content: `Tool '${turn.name}' returned: ${turn.content}`,
			});
			continue;
		}
		out.push({ role: turn.role, content: turn.content });
	}
	return out;
}

function normalizeFinishReason(
	raw: string | undefined,
): ChatCompletion["finishReason"] {
	// HF returns provider-specific tokens — `stop`, `length`,
	// `eos_token`, `tool_calls`, etc. Collapse to the three values
	// the persistence layer cares about. `tool_calls` shouldn't
	// happen because we don't send tools in v0, but if it ever does
	// we treat it as a `stop` (the model finished its current turn).
	if (raw === "length") return "length";
	return "stop";
}

// Extend the class declaration in-place rather than as a separate
// edit — keeps the prototype tidy and the file readable top-down.
declare module "./huggingface.js" {
	interface HuggingFaceChatService {
		completeStream(
			request: ChatCompletionRequest,
			options?: ChatStreamOptions,
		): AsyncIterable<ChatStreamEvent>;
	}
}

HuggingFaceChatService.prototype.completeStream = async function* (
	this: HuggingFaceChatService,
	request: ChatCompletionRequest,
	options?: ChatStreamOptions,
): AsyncIterable<ChatStreamEvent> {
	// biome-ignore lint/suspicious/noExplicitAny: structurally accessing private members on `this`
	const self = this as any;
	const client: InferenceClient = self.client;
	const buffer: string[] = [];
	let finishRaw: string | undefined;
	let tokenCount: number | null = null;
	try {
		const stream = client.chatCompletionStream({
			model: this.modelId,
			max_tokens: self.maxOutputTokens,
			messages: toHuggingFaceMessages(request.messages),
		});
		for await (const chunk of stream) {
			if (options?.signal?.aborted) {
				// Treat client disconnect as a clean stop with whatever
				// we've already buffered. Persistence still runs in the
				// route — better to keep the partial reply than to drop
				// it on the floor.
				return yield {
					type: "done",
					content: buffer.join(""),
					finishReason: "stop",
					tokenCount,
				};
			}
			const choice = chunk.choices[0];
			const delta = choice?.delta?.content;
			if (delta && delta.length > 0) {
				buffer.push(delta);
				yield { type: "token", delta };
			}
			if (choice?.finish_reason) finishRaw = choice.finish_reason;
			if (chunk.usage?.total_tokens != null) {
				tokenCount = chunk.usage.total_tokens;
			}
		}
		const content = buffer.join("").trim();
		if (content.length === 0) {
			return yield {
				type: "error",
				errorMessage:
					"HuggingFace returned an empty completion — try again, or pick a different model.",
				tokenCount,
			};
		}
		return yield {
			type: "done",
			content,
			finishReason: normalizeFinishReason(finishRaw),
			tokenCount,
		};
	} catch (err) {
		return yield {
			type: "error",
			errorMessage: `HuggingFace inference failed: ${safeErrorMessage(err)}`,
			tokenCount,
		};
	}
};
