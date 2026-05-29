/**
 * Per-agent tool allow-list (0.4.0, A1).
 *
 *   - `resolveAgentToolset` applies the grandfather rule: empty toolIds
 *     → all built-in workspace tools; non-empty → exactly the named
 *     subset; ids that don't match a known tool are dropped.
 *   - The dispatcher enforces the allow-list at execution time, so a
 *     model that names a tool the agent isn't allowed can't reach it.
 */

import { describe, expect, test } from "vitest";
import { executeWorkspaceTool } from "../../../src/chat/tools/dispatcher.js";
import {
	type AgentToolDeps,
	DEFAULT_AGENT_TOOLS,
	resolveAgentToolset,
} from "../../../src/chat/tools/registry.js";
import type { ToolCall } from "../../../src/chat/types.js";

const ALL_NAMES = DEFAULT_AGENT_TOOLS.map((t) => t.definition.name);

// The reject path returns before touching deps, so a bare stub is fine.
const stubDeps = {} as AgentToolDeps;

function call(name: string): ToolCall {
	return { id: "call-1", name, arguments: "{}" };
}

describe("resolveAgentToolset — allow-list", () => {
	test("empty toolIds grandfathers in all built-in tools", () => {
		const ts = resolveAgentToolset([]);
		expect(ts.tools.map((t) => t.definition.name)).toEqual(ALL_NAMES);
	});

	test("non-empty toolIds selects exactly the named subset", () => {
		const ts = resolveAgentToolset(["search_kb", "list_kbs"]);
		expect(ts.tools.map((t) => t.definition.name).sort()).toEqual(
			["list_kbs", "search_kb"].sort(),
		);
		expect(ts.resolve("search_kb")).not.toBeNull();
		expect(ts.resolve("get_document")).toBeNull();
	});

	test("ids that don't match a known tool are dropped", () => {
		// `native:fetch` isn't wired until A3; an unknown id must not
		// conjure a tool.
		const ts = resolveAgentToolset(["search_kb", "native:fetch"]);
		expect(ts.tools.map((t) => t.definition.name)).toEqual(["search_kb"]);
		expect(ts.resolve("native:fetch")).toBeNull();
	});
});

describe("executeWorkspaceTool — execution-time allow-list gate", () => {
	test("rejects a tool the agent isn't allowed, without executing it", async () => {
		const ts = resolveAgentToolset(["list_kbs"]);
		const result = await executeWorkspaceTool(call("search_kb"), ts, stubDeps);
		expect(result).toMatch(/not available to this agent/);
		// The denial names the allowed tools so the model can self-correct.
		expect(result).toMatch(/list_kbs/);
	});

	test("an agent with no enabled tools reports an empty toolset", async () => {
		const ts = resolveAgentToolset(["does-not-exist"]);
		expect(ts.tools).toEqual([]);
		const result = await executeWorkspaceTool(call("search_kb"), ts, stubDeps);
		expect(result).toMatch(/no tools enabled/);
	});
});
