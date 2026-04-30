/**
 * OpenAI Chat Completions implementation of {@link ChatService}, with
 * native function-calling support so agents can call the tools defined
 * in {@link ./tools/registry.ts}.
 *
 * Direct `fetch` against `POST /v1/chat/completions` rather than the
 * OpenAI SDK: the wire shape is stable, the SDK isn't already a
 * dependency, and rolling our own keeps the streaming-tool-call
 * accumulation visible in one place.
 *
 * Failures (network, non-2xx, malformed JSON, empty responses) are
 * converted into a `finishReason: "error"` outcome so the route layer
 * persists a row instead of bubbling exceptions to the user, mirroring
 * the HuggingFace adapter's contract.
 */

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

const DEFAULT_BASE_URL = "https://api.openai.com/v1";

export interface OpenAIChatServiceOptions {
	readonly apiKey: string;
	readonly modelId: string;
	readonly maxOutputTokens: number;
	/** Override the API base URL (Azure OpenAI, on-prem proxies, fakes). */
	readonly baseUrl?: string;
	/** Optional fetch override — tests inject a fake transport here. */
	readonly fetchImpl?: typeof fetch;
}

/* OpenAI wire shapes — only the fields we actually read or write. */

interface OAIToolCall {
	readonly id: string;
	readonly type?: "function";
	readonly function: { readonly name: string; readonly arguments: string };
}

interface OAIMessage {
	readonly role: "system" | "user" | "assistant" | "tool";
	readonly content: string | null;
	readonly tool_calls?: readonly OAIToolCall[];
	readonly tool_call_id?: string;
	readonly name?: string;
}

interface OAIChoice {
	readonly index: number;
	readonly message: OAIMessage;
	readonly finish_reason: string | null;
}

interface OAICompletionResponse {
	readonly choices: readonly OAIChoice[];
	readonly usage?: { readonly total_tokens?: number };
}

interface OAIStreamDelta {
	readonly content?: string | null;
	readonly tool_calls?: readonly {
		readonly index: number;
		readonly id?: string;
		readonly type?: "function";
		readonly function?: {
			readonly name?: string;
			readonly arguments?: string;
		};
	}[];
}

interface OAIStreamChunk {
	readonly choices: readonly {
		readonly index: number;
		readonly delta: OAIStreamDelta;
		readonly finish_reason: string | null;
	}[];
	readonly usage?: { readonly total_tokens?: number };
}

export class OpenAIChatService implements ChatService {
	readonly modelId: string;
	private readonly apiKey: string;
	private readonly maxOutputTokens: number;
	private readonly baseUrl: string;
	private readonly fetchImpl: typeof fetch;

	constructor(opts: OpenAIChatServiceOptions) {
		this.modelId = opts.modelId;
		this.apiKey = opts.apiKey;
		this.maxOutputTokens = opts.maxOutputTokens;
		this.baseUrl = opts.baseUrl ?? DEFAULT_BASE_URL;
		this.fetchImpl = opts.fetchImpl ?? fetch;
	}

	async complete(request: ChatCompletionRequest): Promise<ChatCompletion> {
		try {
			const res = await this.fetchImpl(`${this.baseUrl}/chat/completions`, {
				method: "POST",
				headers: {
					"content-type": "application/json",
					authorization: `Bearer ${this.apiKey}`,
				},
				body: JSON.stringify({
					model: this.modelId,
					max_tokens: this.maxOutputTokens,
					messages: toOpenAIMessages(request.messages),
					...toolFields(request.tools),
				}),
			});
			if (!res.ok) {
				const body = await res.text().catch(() => "");
				return errorCompletion(
					`OpenAI returned HTTP ${res.status}: ${body || res.statusText}`,
				);
			}
			const json = (await res.json()) as OAICompletionResponse;
			const choice = json.choices[0];
			if (!choice) return errorCompletion("OpenAI returned no choices.");
			const content = (choice.message.content ?? "").trim();
			const toolCalls = (choice.message.tool_calls ?? []).map(
				(tc): ToolCall => ({
					id: tc.id,
					name: tc.function.name,
					arguments: tc.function.arguments,
				}),
			);
			if (content.length === 0 && toolCalls.length === 0) {
				return errorCompletion(
					"OpenAI returned an empty completion — try again, or pick a different model.",
					json.usage?.total_tokens ?? null,
				);
			}
			return {
				content,
				finishReason: normalizeFinishReason(choice.finish_reason),
				tokenCount: json.usage?.total_tokens ?? null,
				errorMessage: null,
				toolCalls,
			};
		} catch (err) {
			return errorCompletion(`OpenAI request failed: ${safeErrorMessage(err)}`);
		}
	}

	async *completeStream(
		request: ChatCompletionRequest,
		options?: ChatStreamOptions,
	): AsyncIterable<ChatStreamEvent> {
		const buffer: string[] = [];
		// Tool calls arrive incrementally — first delta carries id+name,
		// subsequent deltas carry argument-string chunks, all keyed by
		// `index`. Accumulate into a sparse array indexed by the OpenAI
		// `index`, then collapse to a `ToolCall[]` at the terminal event.
		const toolAcc: { id: string; name: string; args: string[] }[] = [];
		let finishRaw: string | null = null;
		let tokenCount: number | null = null;

		try {
			const res = await this.fetchImpl(`${this.baseUrl}/chat/completions`, {
				method: "POST",
				headers: {
					"content-type": "application/json",
					authorization: `Bearer ${this.apiKey}`,
				},
				body: JSON.stringify({
					model: this.modelId,
					max_tokens: this.maxOutputTokens,
					messages: toOpenAIMessages(request.messages),
					stream: true,
					stream_options: { include_usage: true },
					...toolFields(request.tools),
				}),
				signal: options?.signal,
			});
			if (!res.ok || !res.body) {
				const body = await res.text().catch(() => "");
				yield {
					type: "error",
					errorMessage: `OpenAI returned HTTP ${res.status}: ${body || res.statusText}`,
					tokenCount: null,
				};
				return;
			}

			for await (const chunk of parseSse(res.body)) {
				if (options?.signal?.aborted) {
					yield {
						type: "done",
						content: buffer.join(""),
						finishReason: "stop",
						tokenCount,
						toolCalls: collapseToolCalls(toolAcc),
					};
					return;
				}
				const data = chunk;
				if (data === "[DONE]") break;
				let parsed: OAIStreamChunk;
				try {
					parsed = JSON.parse(data) as OAIStreamChunk;
				} catch {
					// Skip non-JSON keep-alives without aborting the stream.
					continue;
				}
				if (parsed.usage?.total_tokens != null) {
					tokenCount = parsed.usage.total_tokens;
				}
				const choice = parsed.choices[0];
				if (!choice) continue;
				if (choice.finish_reason) finishRaw = choice.finish_reason;
				const delta = choice.delta;
				if (delta.content) {
					buffer.push(delta.content);
					yield { type: "token", delta: delta.content };
				}
				if (delta.tool_calls) {
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
			}

			const content = buffer.join("").trim();
			const toolCalls = collapseToolCalls(toolAcc);
			if (content.length === 0 && toolCalls.length === 0) {
				yield {
					type: "error",
					errorMessage:
						"OpenAI returned an empty completion — try again, or pick a different model.",
					tokenCount,
				};
				return;
			}
			yield {
				type: "done",
				content,
				finishReason: normalizeFinishReason(finishRaw),
				tokenCount,
				toolCalls,
			};
		} catch (err) {
			yield {
				type: "error",
				errorMessage: `OpenAI request failed: ${safeErrorMessage(err)}`,
				tokenCount,
			};
		}
	}
}

function errorCompletion(
	errorMessage: string,
	tokenCount: number | null = null,
): ChatCompletion {
	return {
		content: "",
		finishReason: "error",
		tokenCount,
		errorMessage,
		toolCalls: [],
	};
}

function normalizeFinishReason(raw: string | null): ChatFinishReason {
	if (raw === "length") return "length";
	if (raw === "tool_calls") return "tool_calls";
	return "stop";
}

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

function toOpenAIMessages(turns: readonly ChatTurn[]): OAIMessage[] {
	return turns.map((turn): OAIMessage => {
		if (turn.role === "tool") {
			return {
				role: "tool",
				content: turn.content,
				tool_call_id: turn.toolCallId,
				name: turn.name,
			};
		}
		if (turn.role === "assistant") {
			const out: OAIMessage = {
				role: "assistant",
				// OpenAI requires `content` to be present — null is the
				// canonical "no text, only tool calls" marker. An empty
				// string would cause some compatible servers (Azure,
				// gateways) to reject the request.
				content: turn.content.length > 0 ? turn.content : null,
			};
			if (turn.toolCalls && turn.toolCalls.length > 0) {
				return {
					...out,
					tool_calls: turn.toolCalls.map((tc) => ({
						id: tc.id,
						type: "function",
						function: { name: tc.name, arguments: tc.arguments },
					})),
				};
			}
			return out;
		}
		return { role: turn.role, content: turn.content };
	});
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

/**
 * Yield each `data: ...` line from an SSE stream as its raw payload
 * (without the `data: ` prefix). Comments (`: keep-alive`) and blank
 * lines are dropped. The reader handles UTF-8 multi-byte boundaries
 * across chunks.
 */
async function* parseSse(
	body: ReadableStream<Uint8Array>,
): AsyncIterable<string> {
	const reader = body.getReader();
	const decoder = new TextDecoder();
	let buffer = "";
	while (true) {
		const { value, done } = await reader.read();
		if (done) break;
		buffer += decoder.decode(value, { stream: true });
		// SSE events are terminated by a blank line (\n\n). Process all
		// completed events and keep the trailing incomplete fragment in
		// the buffer.
		let idx = buffer.indexOf("\n\n");
		while (idx >= 0) {
			const event = buffer.slice(0, idx);
			buffer = buffer.slice(idx + 2);
			for (const line of event.split("\n")) {
				if (line.startsWith("data: ")) yield line.slice(6);
				else if (line.startsWith("data:")) yield line.slice(5);
			}
			idx = buffer.indexOf("\n\n");
		}
	}
}
