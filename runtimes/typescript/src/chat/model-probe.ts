/**
 * Config-time guard that catches unusable HuggingFace chat models
 * *before* an LLM service referencing one is persisted.
 *
 * Why this exists: a model can be unusable for chat in two distinct
 * ways, and both used to surface only at *send* time as a cryptic
 * runtime error after the operator had already saved the service and
 * wired an agent to it:
 *
 *   1. **Not a chat model.** HF's router serves some checkpoints for
 *      plain text-generation but not the `conversational` task — e.g.
 *      `mistralai/Mistral-7B-Instruct-v0.3` ("is not a chat model").
 *   2. **Not routable.** HF's Inference Providers router only serves
 *      models a third-party provider has onboarded, and `auto` routing
 *      picks from the providers the caller's account has enabled. A
 *      model no provider serves — e.g. `Qwen/Qwen2.5-7B-Instruct` —
 *      fails with "not supported by any provider you have enabled".
 *
 * This moves both detections to create/update so the operator gets a
 * clear 422 they can act on immediately.
 *
 * The probe is deliberately **fail-open**: it rejects only on a
 * *definitive* signal. Transient failures — network errors, rate
 * limits, auth problems, cold-start ("model is currently loading"), or
 * any unrecognised error — let the service through. We never block a
 * save because HF was briefly unreachable; the worst case is the
 * pre-existing send-time error, which is no regression.
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

/**
 * True when an HF error message is the definitive "no provider serves
 * this model" signal. This is the Inference Providers router rejecting
 * a model that isn't onboarded by any enabled provider — distinct from
 * a transient provider outage, so kept to the router's exact phrasings
 * (`model_not_supported` is its machine code).
 */
export function isModelUnavailableError(message: string): boolean {
	return /not supported by any provider|model_not_supported|no (?:inference )?provider (?:serves|available|supports)/i.test(
		message,
	);
}

/** Error code a definitive probe failure maps to. */
export type ProbeRejectCode = "llm_model_not_chat" | "llm_model_unavailable";

/**
 * Classify an HF error message into the error code it should reject
 * with, or `null` when the failure isn't definitive (fail-open).
 */
export function classifyProbeFailure(message: string): ProbeRejectCode | null {
	if (isNotChatModelError(message)) return "llm_model_not_chat";
	if (isModelUnavailableError(message)) return "llm_model_unavailable";
	return null;
}

export type ChatModelProbeOutcome =
	/** Usable for chat, OR we couldn't tell (fail-open). Allow the save. */
	| { readonly kind: "served" }
	/** Definitive failure. Reject the save with `code`. */
	| {
			readonly kind: "rejected";
			readonly code: ProbeRejectCode;
			readonly detail: string;
	  };

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
 * the outcome and classify it. Anything that isn't a definitive failure
 * signal (including a successful or empty completion) is treated as
 * "served".
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
	if (out.finishReason === "error" && out.errorMessage) {
		const code = classifyProbeFailure(out.errorMessage);
		if (code) return { kind: "rejected", code, detail: out.errorMessage };
	}
	return { kind: "served" };
};
