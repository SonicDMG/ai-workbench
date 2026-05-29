/**
 * Deterministic {@link ChatService} for conformance / tests.
 *
 * Replays a scripted reply (sync) and scripted token stream (async)
 * verbatim. Never reaches the network, never reads `process.env`,
 * never depends on a real provider. Used by the conformance harness
 * to capture stable wire shapes for the chat surface without
 * standing up a fake HF / OpenAI server.
 *
 * Two shapes of script are supported:
 *
 *   - **Single-turn** (the common case): a flat
 *     `{ tokens?, reply?, finishReason?, tokenCount? }`. Every
 *     `complete` / `completeStream` call replays the same answer. This
 *     is all a plain happy-path scenario needs.
 *   - **Multi-turn** (`turns: FixtureChatTurn[]`): drives the agent
 *     dispatcher's tool-call loop deterministically. Call N of the
 *     instance plays `turns[N]`; a `toolCalls` turn makes the
 *     dispatcher execute the named tool and loop, and the next turn
 *     supplies the final answer. The last turn repeats if the loop
 *     somehow asks for more (it shouldn't — the script should end on a
 *     plain answer). One instance per scenario, so the call counter is
 *     scenario-scoped (the harness builds a fresh service per run).
 */

import type {
	ChatCompletion,
	ChatCompletionRequest,
	ChatFinishReason,
	ChatService,
	ChatStreamEvent,
	ChatStreamOptions,
	ToolCall,
} from "./types.js";

/**
 * One scripted model emission. A turn either answers (tokens / reply)
 * or asks to call one or more tools (`toolCalls`). A tool-call turn
 * still streams its `tokens` first (pre-tool-call narration) before the
 * terminal event carries the calls — mirroring how a real provider
 * interleaves narration with a function call.
 */
export interface FixtureChatTurn {
	readonly tokens?: readonly string[];
	readonly reply?: string;
	readonly toolCalls?: readonly ToolCall[];
	readonly finishReason?: ChatFinishReason;
	readonly tokenCount?: number | null;
}

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
	/**
	 * Ordered multi-turn script for exercising the tool-call loop. When
	 * present it takes precedence over the flat `tokens`/`reply` fields:
	 * the Nth `complete`/`completeStream` call replays `turns[N]`.
	 */
	readonly turns?: readonly FixtureChatTurn[];
}

export class FixtureChatService implements ChatService {
	readonly providerId = "fixture";
	readonly modelId: string;
	private readonly script: FixtureChatScript;
	/**
	 * Call counter for the multi-turn path. Each `complete` /
	 * `completeStream` invocation consumes the next scripted turn so a
	 * single instance can drive a full tool-call loop deterministically.
	 */
	private callIndex = 0;

	constructor(script: FixtureChatScript = {}) {
		this.script = script;
		this.modelId = script.modelId ?? "fixture-test-model";
	}

	/**
	 * Resolve the turn to play for this call. Multi-turn scripts advance
	 * a per-instance counter; flat scripts synthesize a single turn from
	 * the top-level fields so both paths share one code path below.
	 */
	private nextTurn(): FixtureChatTurn {
		if (this.script.turns && this.script.turns.length > 0) {
			const idx = Math.min(this.callIndex, this.script.turns.length - 1);
			this.callIndex += 1;
			return this.script.turns[idx] as FixtureChatTurn;
		}
		return {
			tokens: this.script.tokens,
			reply: this.script.reply,
			finishReason: this.script.finishReason,
			tokenCount: this.script.tokenCount,
		};
	}

	async complete(_request: ChatCompletionRequest): Promise<ChatCompletion> {
		const turn = this.nextTurn();
		const toolCalls = turn.toolCalls ?? [];
		const content = turn.reply ?? (turn.tokens ?? []).join("");
		const finishReason: ChatFinishReason =
			turn.finishReason ?? (toolCalls.length > 0 ? "tool_calls" : "stop");
		return {
			content,
			finishReason,
			tokenCount: turn.tokenCount ?? null,
			errorMessage: null,
			toolCalls,
		};
	}

	async *completeStream(
		_request: ChatCompletionRequest,
		options?: ChatStreamOptions,
	): AsyncIterable<ChatStreamEvent> {
		const turn = this.nextTurn();
		const toolCalls = turn.toolCalls ?? [];
		const tokens =
			turn.tokens ?? (turn.reply !== undefined ? [turn.reply] : []);
		for (const token of tokens) {
			if (options?.signal?.aborted) return;
			yield { type: "token", delta: token };
		}
		const content = turn.reply ?? tokens.join("");
		const finishReason: ChatFinishReason =
			turn.finishReason ?? (toolCalls.length > 0 ? "tool_calls" : "stop");
		yield {
			type: "done",
			content,
			finishReason,
			tokenCount: turn.tokenCount ?? null,
			...(toolCalls.length > 0 ? { toolCalls } : {}),
		};
	}
}
