/**
 * Tool-call guardrails (0.4.0, A5). These apply to EVERY agent tool
 * call regardless of source (built-in, native, Astra, remote-MCP):
 *
 *   1. Per-call timeout — a tool that runs past the hard cap collapses
 *      to an `Error: … timed out` string (NOT a thrown exception) with
 *      a `failure` outcome, so the model can recover.
 *   2. Output-size cap — a tool that returns an oversized body is
 *      clipped with a clear marker so it can't blow up the next prompt.
 *   3. Audit — the dispatch path fires `onToolInvoke` once per tool call
 *      with the tool name + outcome (success / failure / denied) but
 *      NEVER the arguments (secrets can live in args).
 */

import { describe, expect, test, vi } from "vitest";
import { dispatchAgentSend } from "../../src/chat/agent-dispatch.js";
import {
	DEFAULT_TOOL_OUTPUT_CAP_CHARS,
	DEFAULT_TOOL_TIMEOUT_MS,
	executeWorkspaceTool,
	type ToolInvokeInfo,
} from "../../src/chat/tools/dispatcher.js";
import type {
	AgentTool,
	AgentToolDeps,
	AgentToolset,
} from "../../src/chat/tools/registry.js";
import type {
	ChatCompletion,
	ChatCompletionRequest,
	ChatService,
	ChatStreamEvent,
	ToolCall,
} from "../../src/chat/types.js";
import { MemoryControlPlaneStore } from "../../src/control-plane/memory/store.js";
import { MockVectorStoreDriver } from "../../src/drivers/mock/store.js";
import { VectorStoreDriverRegistry } from "../../src/drivers/registry.js";
import { logger } from "../../src/lib/logger.js";
import { EnvSecretProvider } from "../../src/secrets/env.js";
import { SecretResolver } from "../../src/secrets/provider.js";
import { makeFakeEmbedderFactory } from "../helpers/embedder.js";

// Exec deps the synthetic tools below ignore — the guardrail logic lives
// entirely in the dispatcher, so a bare stub with a logger is enough.
const stubDeps = { logger } as unknown as AgentToolDeps;

function call(name: string, args = "{}"): ToolCall {
	return { id: "call-1", name, arguments: args };
}

/** Wrap a single synthetic tool into a one-tool toolset. */
function toolsetOf(tool: AgentTool): AgentToolset {
	return {
		tools: [tool],
		resolve: (name) => (name === tool.definition.name ? tool : null),
	};
}

function syntheticTool(name: string, execute: AgentTool["execute"]): AgentTool {
	return {
		definition: {
			name,
			description: `synthetic ${name}`,
			parameters: { type: "object", properties: {} },
		},
		execute,
	};
}

describe("executeWorkspaceTool — per-call timeout", () => {
	test("a tool that never resolves collapses to an Error: … timed out string", async () => {
		vi.useFakeTimers();
		try {
			// A tool whose promise never settles — only the timeout can win.
			const hangs = syntheticTool("hangs", () => new Promise<string>(() => {}));
			const resultPromise = executeWorkspaceTool(
				call("hangs"),
				toolsetOf(hangs),
				stubDeps,
			);
			// Advance past the hard cap; `advanceTimersByTimeAsync` also
			// flushes the microtask queue so the `Promise.race` settles.
			await vi.advanceTimersByTimeAsync(DEFAULT_TOOL_TIMEOUT_MS + 1);
			const result = await resultPromise;
			expect(result.resultText).toMatch(
				new RegExp(
					`^Error: tool 'hangs' timed out after ${DEFAULT_TOOL_TIMEOUT_MS}ms\\.$`,
				),
			);
			// Timeout is audited as a failure (the tool ran; it just didn't
			// finish in time), distinct from an allow-list denial.
			expect(result.outcome).toBe("failure");
			expect(result.reason).toMatch(/timed out/);
		} finally {
			vi.useRealTimers();
		}
	});

	test("a tool that finishes before the cap is not flagged as timed out", async () => {
		const quick = syntheticTool("quick", async () => "done");
		const result = await executeWorkspaceTool(
			call("quick"),
			toolsetOf(quick),
			stubDeps,
		);
		expect(result.resultText).toBe("done");
		expect(result.outcome).toBe("success");
	});
});

describe("executeWorkspaceTool — output-size cap", () => {
	test("an oversized tool result is truncated with a clear marker", async () => {
		const huge = "x".repeat(DEFAULT_TOOL_OUTPUT_CAP_CHARS + 5_000);
		const big = syntheticTool("big", async () => huge);
		const result = await executeWorkspaceTool(
			call("big"),
			toolsetOf(big),
			stubDeps,
		);
		// Never exceeds the cap, and the marker tells the model it's partial.
		expect(result.resultText.length).toBeLessThanOrEqual(
			DEFAULT_TOOL_OUTPUT_CAP_CHARS,
		);
		expect(result.resultText).toContain("[tool result truncated]");
		// The tool itself succeeded; truncation doesn't change the outcome.
		expect(result.outcome).toBe("success");
	});

	test("a result at or under the cap is returned verbatim", async () => {
		const body = "y".repeat(DEFAULT_TOOL_OUTPUT_CAP_CHARS);
		const exact = syntheticTool("exact", async () => body);
		const result = await executeWorkspaceTool(
			call("exact"),
			toolsetOf(exact),
			stubDeps,
		);
		expect(result.resultText).toBe(body);
		expect(result.resultText).not.toContain("[tool result truncated]");
	});
});

/* ------------------------------------------------------------------ */
/* Audit hook (`onToolInvoke`) through the real dispatch path          */
/* ------------------------------------------------------------------ */

/** Scripted chat service replaying canned completions in order. */
class ScriptedToolChatService implements ChatService {
	readonly modelId = "scripted-guardrails";
	readonly providerId = "scripted";
	private readonly script: ChatCompletion[];
	constructor(script: ChatCompletion[]) {
		this.script = [...script];
	}
	async complete(_request: ChatCompletionRequest): Promise<ChatCompletion> {
		const next = this.script.shift();
		if (!next) throw new Error("scripted chat service ran out of replies");
		return next;
	}
	// biome-ignore lint/correctness/useYield: only the sync `complete` path is exercised here.
	async *completeStream(): AsyncIterable<ChatStreamEvent> {
		throw new Error("not implemented in this fixture");
	}
}

async function dispatchFixture(script: ChatCompletion[]) {
	const store = new MemoryControlPlaneStore();
	const drivers = new VectorStoreDriverRegistry(
		new Map([["mock", new MockVectorStoreDriver()]]),
	);
	const embedders = makeFakeEmbedderFactory();
	const secrets = new SecretResolver({ env: new EnvSecretProvider() });
	const ws = await store.createWorkspace({ name: "ws", kind: "mock" });
	const agent = await store.createAgent(ws.uid, { name: "guardrails" });
	const conversation = await store.createConversation(ws.uid, agent.agentId, {
		title: "t",
	});
	return {
		deps: {
			store,
			drivers,
			embedders,
			secrets,
			logger,
			chatService: new ScriptedToolChatService(script),
			chatConfig: null,
		},
		ctx: { workspaceId: ws.uid, agent, conversation },
	};
}

describe("dispatchAgentSend — onToolInvoke audit hook", () => {
	test("fires once per tool call with success, and the payload carries no arguments", async () => {
		// list_kbs exists in the default (grandfathered) toolset; the
		// empty mock workspace makes it return a friendly placeholder.
		const { deps, ctx } = await dispatchFixture([
			{
				content: "",
				finishReason: "tool_calls",
				tokenCount: 1,
				errorMessage: null,
				toolCalls: [
					{
						id: "c1",
						name: "list_kbs",
						// A secret-looking argument: it must NOT reach the hook.
						arguments: JSON.stringify({ apiKey: "sk-super-secret" }),
					},
				],
			},
			{
				content: "Here is the answer.",
				finishReason: "stop",
				tokenCount: 2,
				errorMessage: null,
				toolCalls: [],
			},
		]);
		const invocations: ToolInvokeInfo[] = [];
		await dispatchAgentSend(deps, ctx, { content: "go" }, (info) => {
			invocations.push(info);
		});

		expect(invocations).toHaveLength(1);
		const [first] = invocations;
		expect(first?.toolName).toBe("list_kbs");
		expect(first?.outcome).toBe("success");
		// The envelope is name + outcome only — no `arguments`, no secret.
		expect(Object.keys(first ?? {}).sort()).toEqual(["outcome", "toolName"]);
		expect(JSON.stringify(first)).not.toContain("sk-super-secret");
		expect(JSON.stringify(first)).not.toContain("apiKey");
	});

	test("a hallucinated tool name surfaces a `denied` outcome", async () => {
		const { deps, ctx } = await dispatchFixture([
			{
				content: "",
				finishReason: "tool_calls",
				tokenCount: 1,
				errorMessage: null,
				toolCalls: [{ id: "c1", name: "not_a_real_tool", arguments: "{}" }],
			},
			{
				content: "I made that up, sorry.",
				finishReason: "stop",
				tokenCount: 2,
				errorMessage: null,
				toolCalls: [],
			},
		]);
		const invocations: ToolInvokeInfo[] = [];
		await dispatchAgentSend(deps, ctx, { content: "go" }, (info) => {
			invocations.push(info);
		});

		expect(invocations).toHaveLength(1);
		expect(invocations[0]?.toolName).toBe("not_a_real_tool");
		// Allow-list rejection → denied (A1 / A5 semantics), with a reason
		// but still no arguments in the envelope.
		expect(invocations[0]?.outcome).toBe("denied");
		expect(invocations[0]?.reason).toMatch(/not available/);
	});
});
