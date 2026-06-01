/**
 * Tests for the shared single-call dispatcher in
 * `src/chat/tools/dispatcher.ts`. The dispatcher is the unified
 * primitive the agent loop and (in future) MCP both delegate to —
 * these tests pin the recovery semantics so neither surface drifts.
 */

import { describe, expect, test } from "vitest";
import {
	executeWorkspaceTool,
	executeWorkspaceToolByName,
} from "../../src/chat/tools/dispatcher.js";
import {
	type AgentTool,
	type AgentToolDeps,
	type AgentToolset,
	resolveAgentToolset,
} from "../../src/chat/tools/registry.js";
import { MemoryControlPlaneStore } from "../../src/control-plane/memory/store.js";
import { MockVectorStoreDriver } from "../../src/drivers/mock/store.js";
import { VectorStoreDriverRegistry } from "../../src/drivers/registry.js";
import { EnvSecretProvider } from "../../src/secrets/env.js";
import { SecretResolver } from "../../src/secrets/provider.js";
import { makeFakeEmbedderFactory } from "../helpers/embedder.js";

async function fixture(): Promise<{
	deps: AgentToolDeps;
	toolset: AgentToolset;
}> {
	const store = new MemoryControlPlaneStore();
	const driver = new MockVectorStoreDriver();
	const drivers = new VectorStoreDriverRegistry(new Map([["mock", driver]]));
	const embedders = makeFakeEmbedderFactory();
	const ws = await store.createWorkspace({ name: "ws", kind: "mock" });
	const deps: AgentToolDeps = {
		workspaceId: ws.uid,
		store,
		drivers,
		embedders,
	};
	// All built-in tools available (empty allow-list = grandfathered).
	const toolset = await resolveAgentToolset([], {
		workspaceId: ws.uid,
		store,
		drivers,
		embedders,
		secrets: new SecretResolver({ env: new EnvSecretProvider() }),
		chatConfig: null,
	});
	return { deps, toolset };
}

describe("executeWorkspaceTool", () => {
	test("returns an Error: string + denied outcome for unknown tool names", async () => {
		const { deps, toolset } = await fixture();
		const out = await executeWorkspaceTool(
			{ id: "1", name: "nope", arguments: "{}" },
			toolset,
			deps,
		);
		expect(out.resultText).toMatch(/^Error: tool 'nope' is not available/);
		// Not on the allow-list → denied (A1 / A5 audit semantics).
		expect(out.outcome).toBe("denied");
	});

	test("returns an Error: string + failure outcome for malformed JSON arguments", async () => {
		const { deps, toolset } = await fixture();
		const out = await executeWorkspaceTool(
			{ id: "1", name: "list_kbs", arguments: "{not json" },
			toolset,
			deps,
		);
		expect(out.resultText).toMatch(
			/^Error: tool arguments were not valid JSON/,
		);
		expect(out.outcome).toBe("failure");
	});

	test("returns the tool's result string + success outcome on success", async () => {
		const { deps, toolset } = await fixture();
		const out = await executeWorkspaceTool(
			{ id: "1", name: "list_kbs", arguments: "" },
			toolset,
			deps,
		);
		// Empty workspace → friendly placeholder, not JSON.
		expect(out.resultText).toBe(
			"No knowledge bases exist in this workspace yet.",
		);
		expect(out.outcome).toBe("success");
	});

	test("treats empty arguments as `{}`", async () => {
		const { deps, toolset } = await fixture();
		const out = await executeWorkspaceTool(
			{ id: "1", name: "list_kbs", arguments: "" },
			toolset,
			deps,
		);
		expect(out.resultText).not.toMatch(/^Error/);
		expect(out.outcome).toBe("success");
	});
});

describe("executeWorkspaceToolByName", () => {
	test("skips JSON.parse and runs against pre-parsed args", async () => {
		const { deps } = await fixture();
		const out = await executeWorkspaceToolByName("list_kbs", {}, deps);
		expect(out).toBe("No knowledge bases exist in this workspace yet.");
	});

	test("returns an Error: string for unknown tool names", async () => {
		const { deps } = await fixture();
		const out = await executeWorkspaceToolByName("nope", {}, deps);
		expect(out).toMatch(/^Error: tool 'nope' is not available/);
	});
});

describe("executeWorkspaceTool — tools:invoke gate (MCP P3)", () => {
	// Fake tools so the gate can be exercised without a live MCP server:
	// the dispatcher keys off the `mcp:` name prefix + `toolInvokeAllowed`.
	const params = {
		type: "object" as const,
		properties: {},
		additionalProperties: false,
	};
	const mcpTool: AgentTool = {
		definition: {
			name: "mcp:srv-1:echo",
			description: "echo",
			parameters: params,
		},
		execute: async () => "ran",
	};
	const builtinTool: AgentTool = {
		definition: {
			name: "search_kb",
			description: "search",
			parameters: params,
		},
		execute: async () => "ran",
	};
	const toolset: AgentToolset = {
		tools: [mcpTool, builtinTool],
		resolve: (n) =>
			[mcpTool, builtinTool].find((t) => t.definition.name === n) ?? null,
	};
	const mcpCall = { id: "1", name: "mcp:srv-1:echo", arguments: "{}" };

	test("denies an mcp:-source call when toolInvokeAllowed is false", async () => {
		const { deps } = await fixture();
		const out = await executeWorkspaceTool(mcpCall, toolset, {
			...deps,
			toolInvokeAllowed: false,
		});
		expect(out.outcome).toBe("denied");
		expect(out.reason).toBe("missing tools:invoke scope");
		expect(out.resultText).toContain("tools:invoke");
		expect(out.resultText).not.toContain("ran"); // never executed
	});

	test("allows the mcp call when toolInvokeAllowed is true", async () => {
		const { deps } = await fixture();
		const out = await executeWorkspaceTool(mcpCall, toolset, {
			...deps,
			toolInvokeAllowed: true,
		});
		expect(out.outcome).toBe("success");
		expect(out.resultText).toBe("ran");
	});

	test("absent toolInvokeAllowed means allowed (non-gated callers + MCP run-agent)", async () => {
		const { deps } = await fixture();
		const out = await executeWorkspaceTool(mcpCall, toolset, deps);
		expect(out.outcome).toBe("success");
	});

	test("the gate is mcp-only — a built-in runs even when invocation is denied", async () => {
		const { deps } = await fixture();
		const out = await executeWorkspaceTool(
			{ id: "1", name: "search_kb", arguments: "{}" },
			toolset,
			{ ...deps, toolInvokeAllowed: false },
		);
		expect(out.outcome).toBe("success");
		expect(out.resultText).toBe("ran");
	});
});
