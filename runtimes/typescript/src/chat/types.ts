/**
 * Provider-agnostic chat-completion abstractions for the
 * chat-with-Bobbie feature. The route layer only ever talks to
 * {@link ChatService}; the HuggingFace implementation in
 * {@link ./huggingface.ts} is one consumer, future providers (a
 * fake for tests, a Cohere wrapper, etc.) plug in without changing
 * routes.
 */

/**
 * One turn in the chat history that gets sent to the model. Mirrors
 * the OpenAI / HF chat-completion contract — content-only, no tool
 * calls in v0.
 *
 * `role` semantics are model-facing: `assistant` for Bobbie's prior
 * replies, `user` for human turns, `system` for the persona prompt
 * (added by the prompt-assembler, not the route caller).
 */
export interface ChatTurn {
	readonly role: "system" | "user" | "assistant";
	readonly content: string;
}

/**
 * Reason a model emission ended. Mirrors HF's semantics with
 * `error` added for our own failure persistence.
 */
export type ChatFinishReason = "stop" | "length" | "error";

/**
 * Result of a synchronous {@link ChatService.complete} call.
 *
 * Phase 5 will introduce a streaming variant that emits incremental
 * token events while the model is still generating. The sync result
 * is what the runtime persists in
 * `wb_agentic_messages_by_conversation`.
 */
export interface ChatCompletion {
	readonly content: string;
	readonly finishReason: ChatFinishReason;
	/** Total tokens used by the call, when the provider reports it. */
	readonly tokenCount: number | null;
	/**
	 * Free-form provider-side error detail when `finishReason` is
	 * `error`. Surfaced to the user as the assistant message body so
	 * they can self-diagnose without checking server logs.
	 */
	readonly errorMessage: string | null;
}

export interface ChatCompletionRequest {
	/** Ordered turns to send to the model. */
	readonly messages: readonly ChatTurn[];
}

export interface ChatService {
	/**
	 * Identifier surfaced on persisted assistant messages
	 * (`metadata.model`). Used by the UI to attribute the reply.
	 */
	readonly modelId: string;
	complete(request: ChatCompletionRequest): Promise<ChatCompletion>;
}
