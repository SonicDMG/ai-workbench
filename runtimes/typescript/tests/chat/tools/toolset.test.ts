/**
 * Per-agent tool allow-list (0.4.0, A1) and the A2–A4 provider seam.
 *
 *   - `resolveAgentToolset` applies the grandfather rule: empty toolIds
 *     → all built-in workspace tools; non-empty → exactly the named
 *     subset across the full candidate pool (built-in + native + Astra
 *     + remote-MCP); ids that don't match any known tool are dropped.
 *   - The dispatcher enforces the allow-list at execution time, so a
 *     model that names a tool the agent isn't allowed can't reach it.
 */

import { describe, expect, test } from "vitest";
import { executeWorkspaceTool } from "../../../src/chat/tools/dispatcher.js";
import {
	type AgentToolDeps,
	DEFAULT_AGENT_TOOLS,
	resolveAgentToolset,
	type ToolProviderContext,
} from "../../../src/chat/tools/registry.js";
import type { ToolCall } from "../../../src/chat/types.js";
import { MemoryControlPlaneStore } from "../../../src/control-plane/memory/store.js";
import { MockVectorStoreDriver } from "../../../src/drivers/mock/store.js";
import { VectorStoreDriverRegistry } from "../../../src/drivers/registry.js";
import { EnvSecretProvider } from "../../../src/secrets/env.js";
import { SecretResolver } from "../../../src/secrets/provider.js";
import { makeFakeEmbedderFactory } from "../../helpers/embedder.js";

const ALL_NAMES = DEFAULT_AGENT_TOOLS.map((t) => t.definition.name);

// The reject path returns before touching exec deps, so a bare stub is fine.
const stubDeps = {} as AgentToolDeps;

// A real (mock-workspace) provider context, so the test stays robust as
// the native / Astra / remote-MCP providers (A2–A4) come online — they
// see a valid store/workspace and contribute nothing extra for a mock
// workspace with no config or registered MCP servers.
async function makeCtx(): Promise<ToolProviderContext> {
	const store = new MemoryControlPlaneStore();
	const ws = await store.createWorkspace({ name: "ws", kind: "mock" });
	return {
		workspaceId: ws.uid,
		store,
		drivers: new VectorStoreDriverRegistry(
			new Map([["mock", new MockVectorStoreDriver()]]),
		),
		embedders: makeFakeEmbedderFactory(),
		secrets: new SecretResolver({ env: new EnvSecretProvider() }),
		chatConfig: null,
	};
}

function call(name: string): ToolCall {
	return { id: "call-1", name, arguments: "{}" };
}

describe("resolveAgentToolset — allow-list", () => {
	test("empty toolIds grandfathers in all built-in tools", async () => {
		const ts = await resolveAgentToolset([], await makeCtx());
		expect(ts.tools.map((t) => t.definition.name)).toEqual(ALL_NAMES);
	});

	test("non-empty toolIds selects exactly the named subset", async () => {
		const ts = await resolveAgentToolset(
			["search_kb", "list_kbs"],
			await makeCtx(),
		);
		expect(ts.tools.map((t) => t.definition.name).sort()).toEqual(
			["list_kbs", "search_kb"].sort(),
		);
		expect(ts.resolve("search_kb")).not.toBeNull();
		expect(ts.resolve("get_document")).toBeNull();
	});

	test("ids that don't match any known tool are dropped", async () => {
		const ts = await resolveAgentToolset(
			["search_kb", "does-not-exist:nope"],
			await makeCtx(),
		);
		expect(ts.tools.map((t) => t.definition.name)).toEqual(["search_kb"]);
		expect(ts.resolve("does-not-exist:nope")).toBeNull();
	});
});

describe("executeWorkspaceTool — execution-time allow-list gate", () => {
	test("rejects a tool the agent isn't allowed, without executing it", async () => {
		const ts = await resolveAgentToolset(["list_kbs"], await makeCtx());
		const result = await executeWorkspaceTool(call("search_kb"), ts, stubDeps);
		expect(result).toMatch(/not available to this agent/);
		expect(result).toMatch(/list_kbs/);
	});

	test("an agent with no enabled tools reports an empty toolset", async () => {
		const ts = await resolveAgentToolset(["does-not-exist"], await makeCtx());
		expect(ts.tools).toEqual([]);
		const result = await executeWorkspaceTool(call("search_kb"), ts, stubDeps);
		expect(result).toMatch(/no tools enabled/);
	});
});
