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

/**
 * Streaming events emitted by {@link ChatService.completeStream}.
 *
 * - `token` — a single delta from the model. Append to the assistant
 *   buffer and re-render. Multiple in flight per call.
 * - `done` — terminal success. Carries the full assembled content and
 *   metadata so the route layer can persist a single canonical row
 *   without re-concatenating tokens itself.
 * - `error` — terminal failure. The route persists the assistant turn
 *   with `finish_reason: "error"` and the supplied message.
 *
 * The stream MUST emit exactly one terminal event (`done` OR
 * `error`) and no further events after it.
 */
export type ChatStreamEvent =
	| { readonly type: "token"; readonly delta: string }
	| {
			readonly type: "done";
			readonly content: string;
			readonly finishReason: ChatFinishReason;
			readonly tokenCount: number | null;
	  }
	| {
			readonly type: "error";
			readonly errorMessage: string;
			readonly tokenCount: number | null;
	  };

export interface ChatStreamOptions {
	/**
	 * Aborts the underlying provider request when the consumer
	 * disconnects. Phase 5 routes wire this to the SSE
	 * `stream.onAbort` callback so the runtime stops paying for
	 * tokens nobody will see.
	 */
	readonly signal?: AbortSignal;
}

export interface ChatService {
	/**
	 * Identifier surfaced on persisted assistant messages
	 * (`metadata.model`). Used by the UI to attribute the reply.
	 */
	readonly modelId: string;
	complete(request: ChatCompletionRequest): Promise<ChatCompletion>;

	/**
	 * Streaming variant. The async iterator yields incremental
	 * `token` events while the model is generating, then exactly one
	 * terminal `done` or `error` event. Optional — providers that
	 * can't stream return their full reply as a single `token` then
	 * `done`. Implementations MUST handle `signal.aborted` by
	 * stopping cleanly.
	 */
	completeStream(
		request: ChatCompletionRequest,
		options?: ChatStreamOptions,
	): AsyncIterable<ChatStreamEvent>;
}
