/**
 * Browser-side SSE consumer for
 * `POST .../agents/{a}/conversations/{c}/messages/stream`.
 *
 * Why fetch-streaming and not `EventSource`? Because the server uses
 * `POST` with a JSON body — `EventSource` only supports `GET`. fetch
 * with `Accept: text/event-stream` returns a `ReadableStream<Uint8Array>`
 * that we parse as SSE manually. Same wire format as the spec, just
 * not the same browser API.
 */

import type { ChatMessage } from "@/lib/schemas";
import { ChatMessageRecordSchema } from "@/lib/schemas";

/**
 * A single tool call the model emitted in a `tool-call` SSE event.
 * `arguments` is the raw JSON string the model produced (already a
 * string on the wire — not parsed) so the UI can pretty-print it.
 */
export interface ToolCallRequest {
	readonly id: string;
	readonly name: string;
	readonly arguments: string;
}

/**
 * Events the consumer fires while the stream is in flight. The
 * caller is expected to drive its own state machine off these —
 * `useSendConversationStream` uses them to update the cached message list.
 */
export type ChatStreamUiEvent =
	| { readonly type: "user-message"; readonly message: ChatMessage }
	| { readonly type: "token"; readonly delta: string }
	| { readonly type: "token-reset" }
	| {
			readonly type: "tool-call";
			readonly toolCalls: readonly ToolCallRequest[];
	  }
	| {
			readonly type: "tool-result";
			readonly toolCallId: string;
			readonly name: string;
			readonly content: string;
	  }
	| { readonly type: "done"; readonly assistant: ChatMessage }
	| { readonly type: "error"; readonly assistant: ChatMessage };

export interface SendConversationStreamOptions {
	readonly content: string;
	readonly signal?: AbortSignal;
	readonly onEvent: (event: ChatStreamUiEvent) => void;
}

/**
 * Open the SSE stream and pump events to the caller. Resolves once
 * the stream closes naturally; rejects on transport errors (network,
 * non-2xx response, malformed SSE), and on a `stream-error` SSE
 * event emitted by the server (e.g. control-plane 404 surfacing
 * mid-stream). A `done` or `error` event always fires before
 * resolution when the server-side handler completes normally — see
 * `routes/api-v1/agents.ts`.
 */
export async function sendConversationStream(
	workspaceId: string,
	agentId: string,
	conversationId: string,
	opts: SendConversationStreamOptions,
): Promise<void> {
	const res = await fetch(
		`/api/v1/workspaces/${workspaceId}/agents/${agentId}/conversations/${conversationId}/messages/stream`,
		{
			method: "POST",
			credentials: "include",
			signal: opts.signal,
			headers: {
				"content-type": "application/json",
				accept: "text/event-stream",
			},
			body: JSON.stringify({ content: opts.content }),
		},
	);
	if (!res.ok) {
		const text = await res.text();
		throw new Error(
			`conversation stream failed: ${res.status} ${res.statusText}${text.length > 0 ? ` — ${text}` : ""}`,
		);
	}
	if (!res.body) {
		throw new Error("conversation stream had no response body");
	}

	const reader = res.body.getReader();
	const decoder = new TextDecoder();
	let buffer = "";
	while (true) {
		const { value, done } = await reader.read();
		if (done) break;
		buffer += decoder.decode(value, { stream: true });
		// SSE delimits events by a blank line.
		let boundary = buffer.indexOf("\n\n");
		while (boundary !== -1) {
			const block = buffer.slice(0, boundary);
			buffer = buffer.slice(boundary + 2);
			boundary = buffer.indexOf("\n\n");
			const event = parseSseBlock(block);
			if (event) dispatch(event, opts.onEvent);
		}
	}
	// Flush any trailing event without the final blank line.
	if (buffer.trim().length > 0) {
		const event = parseSseBlock(buffer);
		if (event) dispatch(event, opts.onEvent);
	}
}

interface RawSseEvent {
	readonly event: string;
	readonly data: string;
}

function parseSseBlock(block: string): RawSseEvent | null {
	let event = "message";
	const dataLines: string[] = [];
	for (const line of block.split("\n")) {
		if (line.startsWith("event: ")) event = line.slice("event: ".length);
		else if (line.startsWith("data: "))
			dataLines.push(line.slice("data: ".length));
	}
	if (dataLines.length === 0) return null;
	return { event, data: dataLines.join("\n") };
}

function dispatch(
	raw: RawSseEvent,
	onEvent: (event: ChatStreamUiEvent) => void,
): void {
	if (raw.event === "token") {
		const parsed = JSON.parse(raw.data) as { delta?: unknown };
		if (typeof parsed.delta === "string" && parsed.delta.length > 0) {
			onEvent({ type: "token", delta: parsed.delta });
		}
		return;
	}
	if (raw.event === "token-reset") {
		onEvent({ type: "token-reset" });
		return;
	}
	if (raw.event === "tool-call") {
		// `{ toolCalls: [{ id, name, arguments }] }` — see
		// MessageStreamToolCallEvent in the runtime OpenAPI schemas. Drop
		// entries missing the required string fields rather than crashing
		// the whole stream on a malformed payload.
		const parsed = JSON.parse(raw.data) as { toolCalls?: unknown };
		const toolCalls = Array.isArray(parsed.toolCalls)
			? parsed.toolCalls.filter(
					(t): t is ToolCallRequest =>
						typeof t === "object" &&
						t !== null &&
						typeof (t as ToolCallRequest).id === "string" &&
						typeof (t as ToolCallRequest).name === "string" &&
						typeof (t as ToolCallRequest).arguments === "string",
				)
			: [];
		if (toolCalls.length > 0) onEvent({ type: "tool-call", toolCalls });
		return;
	}
	if (raw.event === "tool-result") {
		// `{ toolCallId, name, content }` — see MessageStreamToolResultEvent.
		const parsed = JSON.parse(raw.data) as {
			toolCallId?: unknown;
			name?: unknown;
			content?: unknown;
		};
		if (
			typeof parsed.toolCallId === "string" &&
			typeof parsed.name === "string" &&
			typeof parsed.content === "string"
		) {
			onEvent({
				type: "tool-result",
				toolCallId: parsed.toolCallId,
				name: parsed.name,
				content: parsed.content,
			});
		}
		return;
	}
	if (raw.event === "stream-error") {
		// Server-side mid-stream failure (e.g. control-plane 404 inside
		// the dispatch loop). Convert to a thrown error so the consumer
		// hook's catch path surfaces it the same way as a transport
		// failure.
		let parsed: { code?: unknown; message?: unknown };
		try {
			parsed = JSON.parse(raw.data) as { code?: unknown; message?: unknown };
		} catch {
			throw new Error("conversation stream failed");
		}
		const message =
			typeof parsed.message === "string" && parsed.message.length > 0
				? parsed.message
				: "conversation stream failed";
		throw new Error(message);
	}
	if (
		raw.event === "user-message" ||
		raw.event === "done" ||
		raw.event === "error"
	) {
		const parsed = ChatMessageRecordSchema.safeParse(JSON.parse(raw.data));
		if (!parsed.success) return;
		if (raw.event === "user-message") {
			onEvent({ type: "user-message", message: parsed.data });
		} else if (raw.event === "done") {
			onEvent({ type: "done", assistant: parsed.data });
		} else {
			onEvent({ type: "error", assistant: parsed.data });
		}
	}
}
