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
				messages: request.messages.map((turn) => ({
					role: turn.role,
					content: turn.content,
				})),
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
				};
			}
			return {
				content,
				finishReason: normalizeFinishReason(choice?.finish_reason),
				tokenCount: out.usage?.total_tokens ?? null,
				errorMessage: null,
			};
		} catch (err) {
			return {
				content: "",
				finishReason: "error",
				tokenCount: null,
				errorMessage: `HuggingFace inference failed: ${safeErrorMessage(err)}`,
			};
		}
	}
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
