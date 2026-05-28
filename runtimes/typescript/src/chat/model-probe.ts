/**
 * Config-time guard that catches HuggingFace models that aren't served
 * for the chat-completion task *before* an LLM service referencing one
 * is persisted.
 *
 * Why this exists: HF's Inference Providers router serves some
 * instruction-tuned checkpoints for plain text-generation but NOT for
 * the `conversational` (chat-completion) task. Binding an agent to one
 * — e.g. the old default `mistralai/Mistral-7B-Instruct-v0.3` — only
 * failed at *send* time with a cryptic
 * `"<model>" is not a chat model` runtime error, after the operator
 * had already saved the service and wired an agent to it. This moves
 * detection to create/update so the operator gets a clear 422 they can
 * act on immediately.
 *
 * The probe is deliberately **fail-open**: it rejects only on a
 * *definitive* not-a-chat-model signal. Transient failures — network
 * errors, rate limits, auth problems, cold-start ("model is currently
 * loading"), or any unrecognised error — let the service through. We
 * never block a save because HF was briefly unreachable; the worst
 * case is the pre-existing send-time error, which is no regression.
 */

import { HuggingFaceChatService } from "./huggingface.js";

/**
 * True when an HF error message is the definitive "this model isn't
 * served for chat" signal. Kept narrow on purpose: a false positive
 * here blocks a legitimate save, so we only match the router's
 * task-mismatch phrasings, not generic failures.
 */
export function isNotChatModelError(message: string): boolean {
	return /is not a chat model|not supported for task|task ['"]?conversational['"]? is not|conversational[^.]*not (?:supported|available)/i.test(
		message,
	);
}

export type ChatModelProbeOutcome =
	/** Served for chat, OR we couldn't tell (fail-open). Allow the save. */
	| { readonly kind: "served" }
	/** Definitive not-a-chat-model signal. Reject the save. */
	| { readonly kind: "not_chat_model"; readonly detail: string };

export interface ChatModelProbeInput {
	readonly modelName: string;
	readonly token: string;
}

/**
 * A probe implementation. Injected into the LLM-service routes so tests
 * can assert the reject / allow branches without touching the network;
 * production wires {@link probeHuggingFaceChatModel}.
 */
export type ChatModelProbe = (
	input: ChatModelProbeInput,
) => Promise<ChatModelProbeOutcome>;

/**
 * Live probe: a single `max_tokens: 1` chat completion against HF.
 *
 * {@link HuggingFaceChatService.complete} already folds every transport
 * / API failure into `finishReason: "error"` with a string
 * `errorMessage`, so we don't need our own try/catch — we just inspect
 * the outcome and classify it. Anything that isn't a definitive
 * not-a-chat-model signal (including a successful or empty completion)
 * is treated as "served".
 */
export const probeHuggingFaceChatModel: ChatModelProbe = async ({
	modelName,
	token,
}) => {
	const service = new HuggingFaceChatService({
		token,
		modelId: modelName,
		maxOutputTokens: 1,
	});
	const out = await service.complete({
		messages: [{ role: "user", content: "ping" }],
	});
	if (
		out.finishReason === "error" &&
		out.errorMessage &&
		isNotChatModelError(out.errorMessage)
	) {
		return { kind: "not_chat_model", detail: out.errorMessage };
	}
	return { kind: "served" };
};
