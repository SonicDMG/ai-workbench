/**
 * Config-time guard that catches unusable chat models *before* an LLM
 * service referencing one is persisted.
 *
 * Why this exists: a bad model id used to surface only at *send* time
 * as a cryptic runtime error after the operator had already saved the
 * service and wired an agent to it. The most common case on an
 * OpenAI-compatible router (OpenRouter) is a model slug that no
 * upstream serves — the router answers "No endpoints found for
 * <model>". We move that detection to create/update so the operator
 * gets a clear 422 they can act on immediately.
 *
 * The probe is deliberately **fail-open**: it rejects only on a
 * *definitive* signal. Transient failures — network errors, rate
 * limits, auth problems, or any unrecognised error — let the service
 * through. We never block a save because the provider was briefly
 * unreachable; the worst case is the pre-existing send-time error,
 * which is no regression.
 */

import { OpenAIChatService } from "./openai.js";
import { resolveChatProvider } from "./providers.js";

/**
 * True when an error message is the definitive "this model isn't served
 * for chat" signal. Kept narrow on purpose: a false positive here
 * blocks a legitimate save.
 */
export function isNotChatModelError(message: string): boolean {
	return /is not a chat model|not supported for task|does not support chat|conversational[^.]*not (?:supported|available)/i.test(
		message,
	);
}

/**
 * True when an error message is the definitive "no upstream serves this
 * model" signal. Covers OpenRouter's router phrasing ("no endpoints
 * found"), OpenAI's `model_not_found`, and the common "model does not
 * exist" / "is not a valid model" variants compatible gateways emit.
 */
export function isModelUnavailableError(message: string): boolean {
	return /no endpoints found|model_not_found|model not found|does not exist|is not a valid model|not supported by any provider|no (?:inference )?provider (?:serves|available|supports)/i.test(
		message,
	);
}

/** Error code a definitive probe failure maps to. */
export type ProbeRejectCode = "llm_model_not_chat" | "llm_model_unavailable";

/**
 * Classify a provider error message into the error code it should
 * reject with, or `null` when the failure isn't definitive (fail-open).
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
	readonly provider: string;
	readonly modelName: string;
	readonly token: string;
	/** Per-service base-URL override; falls back to the provider default. */
	readonly baseUrl?: string | null;
}

/**
 * A probe implementation. Injected into the LLM-service routes so tests
 * can assert the reject / allow branches without touching the network;
 * production wires {@link probeChatModel}.
 */
export type ChatModelProbe = (
	input: ChatModelProbeInput,
) => Promise<ChatModelProbeOutcome>;

/**
 * Live probe: a single one-output-token chat completion against the
 * configured OpenAI-compatible provider ({@link OpenAIChatService}
 * names the cap field per provider: `max_completion_tokens`, or
 * `max_tokens` for Ollama).
 *
 * {@link OpenAIChatService.complete} already folds every transport / API
 * failure into `finishReason: "error"` with a string `errorMessage`, so
 * we don't need our own try/catch — we just inspect the outcome and
 * classify it. Anything that isn't a definitive failure signal
 * (including a successful or empty completion) is treated as "served".
 */
export const probeChatModel: ChatModelProbe = async ({
	provider,
	modelName,
	token,
	baseUrl,
}) => {
	const resolved = resolveChatProvider({ provider, baseUrl });
	// Unknown provider: nothing to probe against — fail-open and let the
	// route's own provider validation surface the problem.
	if (!resolved) return { kind: "served" };

	const service = new OpenAIChatService({
		apiKey: token,
		modelId: modelName,
		maxOutputTokens: 1,
		baseUrl: resolved.baseUrl,
		providerId: resolved.profile.id,
		defaultHeaders: resolved.defaultHeaders,
		extraBody: resolved.extraBody,
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
