/**
 * Regression test for live token streaming in dispatchAgentSendStream.
 *
 * Before the live-streaming fix, the dispatcher buffered every content
 * delta into a local array and replayed the whole buffer to the SSE
 * consumer only AFTER the iteration finished — defeating the entire
 * point of streaming. This test pins the new behavior: each `token`
 * SSE write must land BEFORE the chat service's stream terminates.
 */

import { describe, expect, test } from "vitest";
import { dispatchAgentSendStream } from "../../src/chat/agent-dispatch.js";
import type {
	ChatCompletion,
	ChatCompletionRequest,
	ChatService,
	ChatStreamEvent,
} from "../../src/chat/types.js";
import { MemoryControlPlaneStore } from "../../src/control-plane/memory/store.js";
import { MockVectorStoreDriver } from "../../src/drivers/mock/store.js";
import { VectorStoreDriverRegistry } from "../../src/drivers/registry.js";
import { logger } from "../../src/lib/logger.js";
import { EnvSecretProvider } from "../../src/secrets/env.js";
import { SecretResolver } from "../../src/secrets/provider.js";
import { makeFakeEmbedderFactory } from "../helpers/embedder.js";

interface Deferred<T> {
	promise: Promise<T>;
	resolve: (v: T) => void;
}
function deferred<T>(): Deferred<T> {
	let resolve!: (v: T) => void;
	const promise = new Promise<T>((r) => {
		resolve = r;
	});
	return { promise, resolve };
}

/**
 * Streaming fake that yields two tokens, then blocks on `gate` before
 * yielding the terminal `done`. Lets the test verify that the tokens
 * have already been written to the SSE consumer while the chat service
 * is still mid-stream.
 */
class GatedStreamingChatService implements ChatService {
	readonly modelId = "fake-stream-gated";
	readonly gate = deferred<void>();
	readonly calls: ChatCompletionRequest[] = [];

	async complete(): Promise<ChatCompletion> {
		throw new Error("not used in streaming test");
	}

	async *completeStream(
		request: ChatCompletionRequest,
	): AsyncIterable<ChatStreamEvent> {
		this.calls.push(request);
		yield { type: "token", delta: "Hello " };
		yield { type: "token", delta: "world." };
		await this.gate.promise;
		yield {
			type: "done",
			content: "Hello world.",
			finishReason: "stop",
			tokenCount: 3,
			toolCalls: [],
		};
	}
}

async function fixture(chatService: ChatService) {
	const store = new MemoryControlPlaneStore();
	const drivers = new VectorStoreDriverRegistry(
		new Map([["mock", new MockVectorStoreDriver()]]),
	);
	const embedders = makeFakeEmbedderFactory();
	const secrets = new SecretResolver({ env: new EnvSecretProvider() });

	const ws = await store.createWorkspace({ name: "ws", kind: "mock" });
	const agent = await store.createAgent(ws.uid, { name: "streamer" });
	const conversation = await store.createConversation(ws.uid, agent.agentId, {
		title: "t",
	});

	return {
		store,
		deps: {
			store,
			drivers,
			embedders,
			secrets,
			logger,
			chatService,
			chatConfig: null,
		},
		ctx: {
			workspaceId: ws.uid,
			agent,
			conversation,
		},
	};
}

interface RecordedEvent {
	readonly event: string;
	readonly data: string;
}

async function waitFor(
	predicate: () => boolean,
	{ timeoutMs = 1000, intervalMs = 5 } = {},
): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	while (!predicate()) {
		if (Date.now() > deadline) {
			throw new Error("waitFor: predicate did not become true within timeout");
		}
		await new Promise((r) => setTimeout(r, intervalMs));
	}
}

/**
 * Streaming fake that ends iteration 1 with a tool call, forcing the
 * dispatcher into the unguarded persistence/SSE branch the recovery
 * test exercises. Iteration 2 (which the test never reaches) would
 * yield the final answer.
 */
class ToolCallingChatService implements ChatService {
	readonly modelId = "fake-tool-calling";
	readonly calls: ChatCompletionRequest[] = [];

	async complete(): Promise<ChatCompletion> {
		throw new Error("not used in streaming test");
	}

	async *completeStream(
		request: ChatCompletionRequest,
	): AsyncIterable<ChatStreamEvent> {
		this.calls.push(request);
		yield { type: "token", delta: "Let me check… " };
		yield {
			type: "done",
			content: "Let me check… ",
			finishReason: "tool_calls",
			tokenCount: 5,
			toolCalls: [{ id: "c1", name: "list_knowledge_bases", arguments: "{}" }],
		};
	}
}

describe("dispatchAgentSendStream live token forwarding", () => {
	test("writes `token` SSE events before the chat stream terminates", async () => {
		const chat = new GatedStreamingChatService();
		const f = await fixture(chat);

		const writes: RecordedEvent[] = [];
		const sse = {
			writeSSE: async (event: RecordedEvent) => {
				writes.push(event);
			},
			onAbort: () => {},
		};
		const serializer = {
			serializeUserMessage: (r: { messageId: string }) =>
				JSON.stringify({ messageId: r.messageId }),
			serializeAssistantMessage: (r: { messageId: string }) =>
				JSON.stringify({ messageId: r.messageId }),
		};

		const dispatchPromise = dispatchAgentSendStream(
			f.deps,
			f.ctx,
			{ content: "stream me" },
			sse,
			serializer,
		);

		// Both tokens should arrive before the chat service is allowed to
		// emit `done`. If the dispatcher were buffering, neither token
		// would have been written yet — the wait would time out.
		await waitFor(() => writes.filter((w) => w.event === "token").length === 2);
		expect(writes.find((w) => w.event === "done")).toBeUndefined();

		// Release the chat service so it can emit the terminal event.
		chat.gate.resolve();
		await dispatchPromise;

		expect(writes.map((w) => w.event)).toEqual([
			"user-message",
			"token",
			"token",
			"done",
		]);
		const tokenDeltas = writes
			.filter((w) => w.event === "token")
			.map((w) => JSON.parse(w.data).delta as string);
		expect(tokenDeltas.join("")).toBe("Hello world.");
	});
});

/**
 * Recovery contract for the streaming dispatcher: a throw inside the
 * tool-call iteration body (persisting the scaffolding row, executing
 * a tool, writing tool-* SSE) must NOT leave the wire half-formed.
 * The dispatcher must persist exactly one terminal assistant row with
 * `finish_reason: "error"` and emit exactly one terminal SSE event so
 * the SPA can swap the live preview for a real bubble. Without this,
 * the route layer's outer `stream-error` envelope fires but tool-result
 * rows already on the wire stay orphaned.
 */
describe("dispatchAgentSendStream failure recovery", () => {
	test("emits terminal `error` SSE + persists error row when the store throws mid-iteration", async () => {
		const chat = new ToolCallingChatService();
		const f = await fixture(chat);

		// Make the third `appendChatMessage` throw — that's the
		// `persistAssistantToolCallTurn` write (after user + retrieval-
		// free path: 1 = user). Iteration 1 finishes, the dispatcher
		// emits `token-reset`, then tries to persist the scaffolding row
		// and fails. The expected behavior is one terminal `error` SSE.
		const realAppend = f.store.appendChatMessage.bind(f.store);
		let appendCalls = 0;
		f.store.appendChatMessage = (async (...args: unknown[]) => {
			appendCalls += 1;
			if (appendCalls === 2) {
				throw new Error("simulated control-plane outage");
			}
			// biome-ignore lint/suspicious/noExplicitAny: spy passthrough
			return await (realAppend as any)(...args);
		}) as typeof f.store.appendChatMessage;

		const writes: RecordedEvent[] = [];
		const sse = {
			writeSSE: async (event: RecordedEvent) => {
				writes.push(event);
			},
			onAbort: () => {},
		};
		const serializer = {
			serializeUserMessage: (r: { messageId: string }) =>
				JSON.stringify({ messageId: r.messageId }),
			serializeAssistantMessage: (r: {
				messageId: string;
				content: string | null;
				metadata: Record<string, string>;
			}) =>
				JSON.stringify({
					messageId: r.messageId,
					content: r.content,
					metadata: r.metadata,
				}),
		};

		await dispatchAgentSendStream(
			f.deps,
			f.ctx,
			{ content: "diagnose me" },
			sse,
			serializer,
		);

		const events = writes.map((w) => w.event);
		// Exactly one terminal event, and it's `error` (not `done`).
		expect(events.filter((e) => e === "done" || e === "error")).toEqual([
			"error",
		]);
		// The error event must carry a serialized assistant row with
		// finish_reason: "error", not a generic transport message — the
		// SPA renders this as a real bubble.
		const errorWrite = writes.find((w) => w.event === "error");
		expect(errorWrite).toBeDefined();
		const parsed = JSON.parse(errorWrite?.data ?? "{}") as {
			content: string | null;
			metadata: Record<string, string>;
		};
		expect(parsed.metadata.finish_reason).toBe("error");
		expect(parsed.content).toContain("simulated control-plane outage");
	});

	test("does not throw out of the dispatcher when SSE writes fail (client gone)", async () => {
		const chat = new ToolCallingChatService();
		const f = await fixture(chat);

		// SSE writer throws on the `token-reset` event — i.e. the client
		// disconnected just as iteration 1 ended. The dispatcher should
		// swallow the SSE failure (there's nobody to tell) but still
		// resolve cleanly so the route layer's finalizer runs.
		const writes: RecordedEvent[] = [];
		const sse = {
			writeSSE: async (event: RecordedEvent) => {
				if (event.event === "token-reset") {
					throw new Error("client disconnected");
				}
				writes.push(event);
			},
			onAbort: () => {},
		};
		const serializer = {
			serializeUserMessage: (r: { messageId: string }) =>
				JSON.stringify({ messageId: r.messageId }),
			serializeAssistantMessage: (r: { messageId: string }) =>
				JSON.stringify({ messageId: r.messageId }),
		};

		// Must not throw — the route layer awaits this; an uncaught
		// throw would skip its `streamSSE` finalizer and orphan the
		// connection.
		await expect(
			dispatchAgentSendStream(
				f.deps,
				f.ctx,
				{ content: "drop me" },
				sse,
				serializer,
			),
		).resolves.toBeUndefined();
	});
});
