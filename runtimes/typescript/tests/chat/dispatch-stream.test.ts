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
		await waitFor(
			() => writes.filter((w) => w.event === "token").length === 2,
		);
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
