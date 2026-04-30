/**
 * Integration test for the agent tool-call loop in
 * `dispatchAgentSend` and `dispatchAgentSendStream`. Uses a scripted
 * fake `ChatService` so the model's behavior is deterministic, then
 * verifies the dispatcher:
 *
 *   - calls the model again after a tool-call response
 *   - executes each tool and persists a `tool` message row per call
 *   - persists the assistant turn that emitted the tool calls (with
 *     toolCallPayload) AND the final answer (without)
 *   - returns the FINAL assistant row to the route
 *   - aborts cleanly when the iteration cap is hit
 */

import { describe, expect, test } from "vitest";
import { dispatchAgentSend } from "../../src/chat/agent-dispatch.js";
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

/**
 * Scripted chat service that replays a list of pre-baked completions
 * in order. The dispatcher unconditionally advertises tools regardless
 * of provider class, so the fake doesn't need any branding — every
 * call sees `tools[]` in `request.tools` and decides what to emit
 * back from the script.
 */
class ScriptedToolChatService implements ChatService {
	readonly modelId = "scripted-tool-test";
	readonly calls: ChatCompletionRequest[] = [];
	private readonly script: ChatCompletion[];

	constructor(script: ChatCompletion[]) {
		this.script = [...script];
	}

	async complete(request: ChatCompletionRequest): Promise<ChatCompletion> {
		this.calls.push(request);
		const next = this.script.shift();
		if (!next)
			throw new Error("scripted chat service ran out of canned replies");
		return next;
	}

	// biome-ignore lint/correctness/useYield: this fake only exists for the sync `complete` path; the streaming dispatcher is exercised by the real openai.ts shim test instead.
	async *completeStream(): AsyncIterable<ChatStreamEvent> {
		throw new Error("not implemented in this fixture");
	}
}

function scripted(script: ChatCompletion[]): ScriptedToolChatService {
	return new ScriptedToolChatService(script);
}

interface Fixture {
	store: MemoryControlPlaneStore;
	workspaceId: string;
	agentId: string;
	conversationId: string;
	deps: Parameters<typeof dispatchAgentSend>[0];
	/**
	 * Bound dispatch-context for the test's agent + conversation. The
	 * non-null look-ups are asserted at fixture-build time so individual
	 * tests can call dispatch without re-loading the records.
	 */
	ctx: Parameters<typeof dispatchAgentSend>[1];
}

async function fixture(
	chatService: ChatService,
	{ ragEnabled = false }: { ragEnabled?: boolean } = {},
): Promise<Fixture> {
	const store = new MemoryControlPlaneStore();
	const drivers = new VectorStoreDriverRegistry(
		new Map([["mock", new MockVectorStoreDriver()]]),
	);
	const embedders = makeFakeEmbedderFactory();
	const secrets = new SecretResolver({ env: new EnvSecretProvider() });

	const ws = await store.createWorkspace({ name: "ws", kind: "mock" });
	const agent = await store.createAgent(ws.uid, {
		name: "tool-tester",
		ragEnabled,
	});
	const conversation = await store.createConversation(ws.uid, agent.agentId, {
		title: "t",
	});

	return {
		store,
		workspaceId: ws.uid,
		agentId: agent.agentId,
		conversationId: conversation.conversationId,
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

describe("dispatchAgentSend tool-call loop", () => {
	test("executes tool calls, then returns the final assistant answer", async () => {
		const chat = scripted([
			// Iteration 1: model wants to call list_kbs
			{
				content: "",
				finishReason: "tool_calls",
				tokenCount: 10,
				errorMessage: null,
				toolCalls: [{ id: "call_1", name: "list_kbs", arguments: "{}" }],
			},
			// Iteration 2: model gives a final answer
			{
				content: "You have no knowledge bases yet.",
				finishReason: "stop",
				tokenCount: 12,
				errorMessage: null,
				toolCalls: [],
			},
		]);
		const f = await fixture(chat);

		const out = await dispatchAgentSend(f.deps, f.ctx, {
			content: "what's in my data?",
		});

		expect(out.assistant.content).toBe("You have no knowledge bases yet.");
		expect(out.user.content).toBe("what's in my data?");

		// Two LLM round-trips happened.
		expect(chat.calls).toHaveLength(2);
		// Second call's prompt includes the tool result and the
		// preceding assistant(toolCalls) turn.
		const secondCall = chat.calls[1];
		expect(secondCall).toBeDefined();
		const roles = (secondCall?.messages ?? []).map((m) => m.role);
		expect(roles).toContain("tool");
		expect(roles).toContain("assistant");

		// Persistence: user, assistant(tool_calls), tool, assistant(final)
		const all = await f.store.listChatMessages(f.workspaceId, f.conversationId);
		expect(all.map((m) => m.role)).toEqual(["user", "agent", "tool", "agent"]);
		expect(all[1]?.toolCallPayload).not.toBeNull();
		expect(all[3]?.toolCallPayload).toBeNull();
		expect(all[3]?.content).toBe("You have no knowledge bases yet.");
	});

	test("aborts after MAX_TOOL_ITERATIONS without convergence", async () => {
		// Always emit a tool call; never converge.
		const looper: ChatCompletion = {
			content: "",
			finishReason: "tool_calls",
			tokenCount: 1,
			errorMessage: null,
			toolCalls: [{ id: "call_x", name: "list_kbs", arguments: "{}" }],
		};
		const chat = scripted(Array.from({ length: 20 }, () => looper));
		const f = await fixture(chat);

		const out = await dispatchAgentSend(f.deps, f.ctx, {
			content: "loop forever",
		});
		expect(out.assistant.content).toMatch(/iteration cap/i);
		expect(out.assistant.metadata.finish_reason).toBe("error");
		// Should have tried exactly the iteration cap (not more).
		expect(chat.calls.length).toBeLessThanOrEqual(6);
		expect(chat.calls.length).toBeGreaterThan(1);
	});

	test("unknown tool name surfaces as an Error: tool result, not an exception", async () => {
		const chat = scripted([
			{
				content: "",
				finishReason: "tool_calls",
				tokenCount: 1,
				errorMessage: null,
				toolCalls: [{ id: "call_1", name: "nope_not_a_tool", arguments: "{}" }],
			},
			{
				content: "Sorry, I made up a tool. Asking the user instead.",
				finishReason: "stop",
				tokenCount: 5,
				errorMessage: null,
				toolCalls: [],
			},
		]);
		const f = await fixture(chat);

		const out = await dispatchAgentSend(f.deps, f.ctx, {
			content: "trigger unknown tool",
		});

		expect(out.assistant.content).toMatch(/Sorry/);
		const all = await f.store.listChatMessages(f.workspaceId, f.conversationId);
		const toolRow = all.find((m) => m.role === "tool");
		expect(toolRow).toBeDefined();
		const tr = toolRow?.toolResponse as { content: string } | null;
		expect(tr?.content).toMatch(
			/^Error: tool 'nope_not_a_tool' is not available/,
		);
	});

	test("the resolved chat service always sees the workspace's tools advertised", async () => {
		const chat = scripted([
			{
				content: "no tools needed, here's the answer",
				finishReason: "stop",
				tokenCount: 1,
				errorMessage: null,
				toolCalls: [],
			},
		]);
		const f = await fixture(chat);
		await dispatchAgentSend(f.deps, f.ctx, { content: "answer please" });
		const advertised = chat.calls[0]?.tools;
		expect(advertised).toBeDefined();
		const names = (advertised ?? []).map((t) => t.name).sort();
		expect(names).toEqual([
			"count_documents",
			"get_document",
			"list_documents",
			"list_kbs",
			"search_kb",
			"summarize_kb",
		]);
	});
});
