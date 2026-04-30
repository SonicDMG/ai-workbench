/**
 * Provider-agnostic chat-completion abstractions for the agent chat
 * surface. The route layer only ever talks to {@link ChatService};
 * the HuggingFace implementation in {@link ./huggingface.ts} is one
 * consumer, future providers (a fake for tests, a Cohere wrapper,
 * etc.) plug in without changing routes.
 */

/**
 * Definition of a tool the model is allowed to call. Mirrors the
 * OpenAI `tools[]` / `function` shape so we can pass it straight
 * through to providers that support native function calling, and
 * translate to whatever JSON-output prompting we want for providers
 * that don't.
 *
 * `parameters` is a JSON Schema object (the OpenAI contract) describing
 * the tool's argument shape. Keeping it as a free `Record<string,
 * unknown>` avoids dragging a JSON-Schema lib in just for typing — the
 * tool registry validates the actual call payload against a Zod schema
 * before invoking the handler.
 */
export interface ToolDefinition {
	readonly name: string;
	readonly description: string;
	readonly parameters: Readonly<Record<string, unknown>>;
}

/**
 * A single tool invocation the model emitted on an assistant turn.
 *
 * `id` is the provider's correlation id; the runtime threads it back
 * through to the matching `tool` turn so multi-tool turns stay paired.
 * `arguments` is the raw JSON payload as a string — providers emit it
 * that way, and we keep it as-is so the tool registry can validate
 * it once at the call site rather than twice (here and at execution).
 */
export interface ToolCall {
	readonly id: string;
	readonly name: string;
	readonly arguments: string;
}

/**
 * One turn in the chat history that gets sent to the model. Mirrors
 * the OpenAI / HF chat-completion contract.
 *
 * `role` semantics are model-facing:
 *  - `system`: the persona prompt (added by the prompt-assembler,
 *    not the route caller).
 *  - `user`: human turns.
 *  - `assistant`: the agent's prior replies. Either carries `content`,
 *    `toolCalls`, or both.
 *  - `tool`: a tool result echoed back to the model so it can finish
 *    the user's original turn. `toolCallId` correlates with the
 *    matching `assistant.toolCalls[].id`.
 */
export type ChatTurn =
	| {
			readonly role: "system" | "user";
			readonly content: string;
	  }
	| {
			readonly role: "assistant";
			readonly content: string;
			readonly toolCalls?: readonly ToolCall[];
	  }
	| {
			readonly role: "tool";
			readonly toolCallId: string;
			readonly name: string;
			readonly content: string;
	  };

/**
 * Reason a model emission ended. Mirrors HF/OpenAI semantics with
 * `error` added for our own failure persistence and `tool_calls`
 * surfaced when the model decided to call a tool instead of replying.
 */
export type ChatFinishReason = "stop" | "length" | "error" | "tool_calls";

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
	/**
	 * Tool calls the model emitted on this turn. Empty when the model
	 * answered directly (or when the provider doesn't support tools).
	 * When non-empty, `finishReason` is `"tool_calls"` and the
	 * dispatcher is expected to execute each tool, append a matching
	 * `tool` turn for each, and call the model again.
	 */
	readonly toolCalls: readonly ToolCall[];
}

export interface ChatCompletionRequest {
	/** Ordered turns to send to the model. */
	readonly messages: readonly ChatTurn[];
	/**
	 * Tool definitions advertised to the model. Providers that support
	 * native function calling forward these straight through; providers
	 * that don't either fall back to JSON-output prompting or ignore
	 * them and answer without tools. Empty / omitted = no tools.
	 */
	readonly tools?: readonly ToolDefinition[];
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
			/**
			 * Tool calls the model emitted on this turn. Empty when the
			 * model answered directly. When non-empty, the dispatcher
			 * executes the tools and re-invokes the stream with the
			 * results appended to the prompt.
			 */
			readonly toolCalls?: readonly ToolCall[];
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
