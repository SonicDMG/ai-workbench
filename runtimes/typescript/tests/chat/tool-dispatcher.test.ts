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
import type { AgentToolDeps } from "../../src/chat/tools/registry.js";
import { MemoryControlPlaneStore } from "../../src/control-plane/memory/store.js";
import { MockVectorStoreDriver } from "../../src/drivers/mock/store.js";
import { VectorStoreDriverRegistry } from "../../src/drivers/registry.js";
import { makeFakeEmbedderFactory } from "../helpers/embedder.js";

async function fixture(): Promise<{ deps: AgentToolDeps }> {
	const store = new MemoryControlPlaneStore();
	const driver = new MockVectorStoreDriver();
	const drivers = new VectorStoreDriverRegistry(new Map([["mock", driver]]));
	const embedders = makeFakeEmbedderFactory();
	const ws = await store.createWorkspace({ name: "ws", kind: "mock" });
	return {
		deps: { workspaceId: ws.uid, store, drivers, embedders },
	};
}

describe("executeWorkspaceTool", () => {
	test("returns an Error: string for unknown tool names", async () => {
		const { deps } = await fixture();
		const out = await executeWorkspaceTool(
			{ id: "1", name: "nope", arguments: "{}" },
			deps,
		);
		expect(out).toMatch(/^Error: tool 'nope' is not available/);
	});

	test("returns an Error: string for malformed JSON arguments", async () => {
		const { deps } = await fixture();
		const out = await executeWorkspaceTool(
			{ id: "1", name: "list_kbs", arguments: "{not json" },
			deps,
		);
		expect(out).toMatch(/^Error: tool arguments were not valid JSON/);
	});

	test("returns the tool's result string on success", async () => {
		const { deps } = await fixture();
		const out = await executeWorkspaceTool(
			{ id: "1", name: "list_kbs", arguments: "" },
			deps,
		);
		// Empty workspace → friendly placeholder, not JSON.
		expect(out).toBe("No knowledge bases exist in this workspace yet.");
	});

	test("treats empty arguments as `{}`", async () => {
		const { deps } = await fixture();
		const out = await executeWorkspaceTool(
			{ id: "1", name: "list_kbs", arguments: "" },
			deps,
		);
		expect(out).not.toMatch(/^Error/);
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
