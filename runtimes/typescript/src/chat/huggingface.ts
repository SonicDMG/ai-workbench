/**
 * HuggingFace Inference Providers implementation of {@link ChatService}.
 *
 * Wraps `@huggingface/inference`'s `chatCompletion` task — the
 * OpenAI-compatible chat-completion endpoint the HF router exposes.
 * Native function calling is supported: tool definitions are forwarded
 * as the `tools[]` request field and the model's `tool_calls` are
 * parsed back out, so agents can drive the dispatcher's tool loop the
 * same way they do on the OpenAI adapter (provided the chosen model is
 * served for tools — e.g. `openai/gpt-oss-20b`).
 *
 * Token failures, rate limits, and empty / malformed responses are
 * converted into a `finishReason: "error"` outcome so the route layer
 * can persist a row instead of bubbling exceptions to the user.
 */

import { InferenceClient } from "@huggingface/inference";
import { safeErrorMessage } from "../lib/safe-error.js";
import type {
	ChatCompletion,
	ChatCompletionRequest,
	ChatFinishReason,
	ChatService,
	ChatStreamEvent,
	ChatStreamOptions,
	ChatTurn,
	ToolCall,
	ToolDefinition,
} from "./types.js";

export interface HuggingFaceChatServiceOptions {
	readonly token: string;
	readonly modelId: string;
	readonly maxOutputTokens: number;
}

/**
 * OpenAI-compatible message shape the HF router accepts. The index
 * signature mirrors the SDK's `ChatCompletionInputMessage` (which is
 * open-ended) so our objects are structurally assignable to it.
 */
interface HfMessage {
	role: "system" | "user" | "assistant" | "tool";
	content?: string;
	name?: string;
	tool_call_id?: string;
	tool_calls?: {
		id: string;
		type: "function";
		function: { name: string; arguments: string };
	}[];
	[property: string]: unknown;
}

export class HuggingFaceChatService implements ChatService {
	readonly modelId: string;
	readonly providerId = "huggingface";
	private readonly client: InferenceClient;
	private readonly token: string;
	private readonly maxOutputTokens: number;

	constructor(opts: HuggingFaceChatServiceOptions) {
		this.modelId = opts.modelId;
		this.token = opts.token;
		this.client = new InferenceClient(opts.token);
		this.maxOutputTokens = opts.maxOutputTokens;
	}

	async ping(options?: { readonly signal?: AbortSignal }): Promise<void> {
		// `whoami-v2` is HF's cheapest authed call — confirms the token
		// is valid without spending inference budget. Returns 200 with
		// a JSON profile, 401 on revoked / missing token.
		const res = await fetch("https://huggingface.co/api/whoami-v2", {
			headers: { authorization: `Bearer ${this.token}` },
			signal: options?.signal,
		});
		if (!res.ok) {
			throw new Error(`HuggingFace whoami-v2 returned ${res.status}`);
		}
	}

	async complete(request: ChatCompletionRequest): Promise<ChatCompletion> {
		try {
			const out = await this.client.chatCompletion({
				model: this.modelId,
				max_tokens: this.maxOutputTokens,
				messages: toHuggingFaceMessages(request.messages),
				...toolFields(request.tools),
			});
			const choice = out.choices[0];
			const content = choice?.message.content?.trim() ?? "";
			const toolCalls = (choice?.message.tool_calls ?? []).map(
				(tc): ToolCall => ({
					id: tc.id,
					name: tc.function.name,
					arguments: tc.function.arguments,
				}),
			);
			if (content.length === 0 && toolCalls.length === 0) {
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
				toolCalls,
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

	async *completeStream(
		request: ChatCompletionRequest,
		options?: ChatStreamOptions,
	): AsyncIterable<ChatStreamEvent> {
		const buffer: string[] = [];
		// Tool calls arrive incrementally — the first delta carries
		// id+name, subsequent deltas carry argument-string chunks, all
		// keyed by `index`. Accumulate into a sparse array, then collapse
		// to a `ToolCall[]` at the terminal event (mirrors the OpenAI
		// adapter).
		const toolAcc: { id: string; name: string; args: string[] }[] = [];
		let finishRaw: string | undefined;
		let tokenCount: number | null = null;
		try {
			const stream = this.client.chatCompletionStream({
				model: this.modelId,
				max_tokens: this.maxOutputTokens,
				messages: toHuggingFaceMessages(request.messages),
				...toolFields(request.tools),
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
						toolCalls: collapseToolCalls(toolAcc),
					};
				}
				const choice = chunk.choices[0];
				const delta = choice?.delta;
				if (delta?.content && delta.content.length > 0) {
					buffer.push(delta.content);
					yield { type: "token", delta: delta.content };
				}
				if (delta?.tool_calls) {
					for (const tc of delta.tool_calls) {
						let slot = toolAcc[tc.index];
						if (!slot) {
							slot = { id: "", name: "", args: [] };
							toolAcc[tc.index] = slot;
						}
						if (tc.id) slot.id = tc.id;
						if (tc.function?.name) slot.name = tc.function.name;
						if (tc.function?.arguments) slot.args.push(tc.function.arguments);
					}
				}
				if (choice?.finish_reason) finishRaw = choice.finish_reason;
				if (chunk.usage?.total_tokens != null) {
					tokenCount = chunk.usage.total_tokens;
				}
			}
			const content = buffer.join("").trim();
			const toolCalls = collapseToolCalls(toolAcc);
			if (content.length === 0 && toolCalls.length === 0) {
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
				toolCalls,
			};
		} catch (err) {
			return yield {
				type: "error",
				errorMessage: `HuggingFace inference failed: ${safeErrorMessage(err)}`,
				tokenCount,
			};
		}
	}
}

/**
 * Build the OpenAI-compatible `tools[]` + `tool_choice` request fields.
 * Empty / omitted when the agent advertises no tools, so plain-chat
 * models aren't sent a field they don't understand.
 */
function toolFields(
	tools: readonly ToolDefinition[] | undefined,
): Record<string, unknown> {
	if (!tools || tools.length === 0) return {};
	return {
		tools: tools.map((t) => ({
			type: "function",
			function: {
				name: t.name,
				description: t.description,
				parameters: t.parameters,
			},
		})),
		tool_choice: "auto",
	};
}

/**
 * Project our tagged-union {@link ChatTurn}s into the OpenAI-compatible
 * `{role, content, tool_calls?, tool_call_id?}` shape the HF router
 * expects. Assistant turns carry their `tool_calls` so the model sees
 * its own prior tool invocations; `tool` turns become `role: "tool"`
 * messages correlated by `tool_call_id`.
 */
function toHuggingFaceMessages(turns: readonly ChatTurn[]): HfMessage[] {
	const out: HfMessage[] = [];
	for (const turn of turns) {
		if (turn.role === "tool") {
			out.push({
				role: "tool",
				content: turn.content,
				tool_call_id: turn.toolCallId,
				name: turn.name,
			});
			continue;
		}
		if (turn.role === "assistant") {
			const msg: HfMessage = { role: "assistant" };
			if (turn.content.length > 0) msg.content = turn.content;
			if (turn.toolCalls && turn.toolCalls.length > 0) {
				msg.tool_calls = turn.toolCalls.map((tc) => ({
					id: tc.id,
					type: "function",
					function: { name: tc.name, arguments: tc.arguments },
				}));
			} else if (msg.content === undefined) {
				// Some providers reject an assistant message with neither
				// content nor tool_calls; send an empty string.
				msg.content = "";
			}
			out.push(msg);
			continue;
		}
		out.push({ role: turn.role, content: turn.content });
	}
	return out;
}

function collapseToolCalls(
	acc: { id: string; name: string; args: string[] }[],
): readonly ToolCall[] {
	const out: ToolCall[] = [];
	for (const slot of acc) {
		if (!slot?.id || !slot.name) continue;
		out.push({ id: slot.id, name: slot.name, arguments: slot.args.join("") });
	}
	return out;
}

function normalizeFinishReason(raw: string | undefined): ChatFinishReason {
	// HF returns provider-specific tokens — `stop`, `length`,
	// `eos_token`, `tool_calls`, etc. Collapse to the values the
	// persistence layer cares about. `tool_calls` is surfaced so the
	// dispatcher's audit metadata reflects a tool-calling turn.
	if (raw === "length") return "length";
	if (raw === "tool_calls") return "tool_calls";
	return "stop";
}
