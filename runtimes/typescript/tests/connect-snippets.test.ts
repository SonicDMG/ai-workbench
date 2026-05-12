/**
 * Unit coverage for the per-framework snippet generators.
 *
 * The route-layer integration test (`connect-route.test.ts`) covers
 * the HTTP surface. This file owns the *content* of each snippet —
 * the things that would silently rot if a generator regressed:
 *   - the rendered URL points at the right workspace
 *   - no plaintext secret is ever embedded
 *   - the API-key env-var name flows through
 *   - the install command and docsUrl are present
 *
 * Each `describe` block is one framework; new targets get their own
 * block at the bottom.
 */

import { describe, expect, test } from "vitest";
import {
	buildAllSnippets,
	buildSingleSnippet,
	CONNECT_TARGET_IDS,
} from "../src/connect/snippets/index.js";
import type { SnippetContext } from "../src/connect/types.js";

function makeCtx(overrides: Partial<SnippetContext> = {}): SnippetContext {
	return {
		workspaceId: "ws-abc",
		knowledgeBaseId: null,
		publicBaseUrl: "https://workbench.example",
		mcpEnabled: true,
		apiKeyEnvVar: "WORKBENCH_API_KEY",
		...overrides,
	};
}

const EXPECTED_MCP_URL =
	"https://workbench.example/api/v1/workspaces/ws-abc/mcp";

describe("buildAllSnippets", () => {
	test("renders one entry per registered target id, in stable order", () => {
		const snippets = buildAllSnippets(makeCtx());
		expect(snippets.map((s) => s.id)).toEqual(CONNECT_TARGET_IDS);
		expect(new Set(snippets.map((s) => s.id)).size).toBe(snippets.length);
	});

	test("every snippet has the required surface fields populated", () => {
		const snippets = buildAllSnippets(makeCtx());
		for (const snippet of snippets) {
			expect(snippet.displayName.length).toBeGreaterThan(0);
			expect(snippet.tagline.length).toBeGreaterThan(0);
			expect(snippet.code.length).toBeGreaterThan(0);
			expect(snippet.docsUrl.startsWith("https://")).toBe(true);
		}
	});

	test("no snippet body embeds a plaintext secret", () => {
		// The env-var indirection is the contract — if a generator ever
		// inlines a bearer token directly, this catches it.
		const snippets = buildAllSnippets(
			makeCtx({ apiKeyEnvVar: "WORKBENCH_API_KEY" }),
		);
		for (const snippet of snippets) {
			expect(snippet.code).not.toMatch(/Bearer\s+wb_sk_[a-zA-Z0-9]+/);
			expect(snippet.code).not.toMatch(/Bearer\s+sk-[a-zA-Z0-9]+/);
		}
	});

	test("custom apiKeyEnvVar threads through every code-bearing snippet", () => {
		const snippets = buildAllSnippets(
			makeCtx({ apiKeyEnvVar: "DATASTAX_TOKEN" }),
		);
		const withCode = snippets.filter((s) => s.transport !== "manual");
		for (const snippet of withCode) {
			expect(snippet.code).toContain("DATASTAX_TOKEN");
			expect(snippet.code).not.toContain("WORKBENCH_API_KEY");
		}
	});
});

describe("buildSingleSnippet", () => {
	test("returns the matching generator output", () => {
		const got = buildSingleSnippet("langgraph", makeCtx());
		expect(got?.id).toBe("langgraph");
	});

	test("returns null for unknown ids so the route can map to 404", () => {
		// @ts-expect-error — exercising the runtime guard, not the type.
		expect(buildSingleSnippet("does-not-exist", makeCtx())).toBeNull();
	});
});

describe("langgraph snippet", () => {
	test("uses streamable_http transport and the workspace MCP URL", () => {
		const snippet = buildSingleSnippet("langgraph", makeCtx());
		expect(snippet).not.toBeNull();
		if (!snippet) return;
		expect(snippet.transport).toBe("mcp");
		expect(snippet.requiresMcp).toBe(true);
		expect(snippet.code).toContain('"transport": "streamable_http"');
		expect(snippet.code).toContain(EXPECTED_MCP_URL);
	});

	test("install command references the three required pip packages", () => {
		const snippet = buildSingleSnippet("langgraph", makeCtx());
		if (!snippet) throw new Error("expected snippet");
		expect(snippet.install).toContain("langgraph");
		expect(snippet.install).toContain("langchain-mcp-adapters");
		expect(snippet.install).toContain("langchain-openai");
	});
});

describe("crewai snippet", () => {
	test("uses streamable-http (hyphen) — crewai's spelling", () => {
		const snippet = buildSingleSnippet("crewai", makeCtx());
		if (!snippet) throw new Error("expected snippet");
		// CrewAI's MCPServerAdapter accepts "streamable-http" (hyphen),
		// distinct from LangChain's "streamable_http" (underscore).
		// Regression test for the easy-to-miss naming inconsistency.
		expect(snippet.code).toContain('"transport": "streamable-http"');
	});
});

describe("google-adk snippet", () => {
	test("uses StreamableHTTPConnectionParams and gemini model", () => {
		const snippet = buildSingleSnippet("google-adk", makeCtx());
		if (!snippet) throw new Error("expected snippet");
		expect(snippet.code).toContain("StreamableHTTPConnectionParams");
		expect(snippet.code).toContain("gemini-");
	});
});

describe("microsoft-agent-framework snippet", () => {
	test("uses MCPStreamableHTTPTool and async-with context manager", () => {
		const snippet = buildSingleSnippet("microsoft-agent-framework", makeCtx());
		if (!snippet) throw new Error("expected snippet");
		expect(snippet.code).toContain("MCPStreamableHTTPTool");
		expect(snippet.code).toContain("async with");
	});
});

describe("watsonx snippet", () => {
	test("is manual (transport=manual, no install) and references both options", () => {
		const snippet = buildSingleSnippet("watsonx", makeCtx());
		if (!snippet) throw new Error("expected snippet");
		expect(snippet.transport).toBe("manual");
		expect(snippet.requiresMcp).toBe(false);
		expect(snippet.install).toBeNull();
		expect(snippet.code).toContain("Option A");
		expect(snippet.code).toContain("Option B");
		expect(snippet.code).toContain(EXPECTED_MCP_URL);
		expect(snippet.code).toContain("/api/v1/openapi.json");
	});
});

describe("mcp-raw snippet", () => {
	test("is a curl tools/list call against the workspace MCP URL", () => {
		const snippet = buildSingleSnippet("mcp-raw", makeCtx());
		if (!snippet) throw new Error("expected snippet");
		expect(snippet.language).toBe("bash");
		expect(snippet.code).toContain(`curl -sN '${EXPECTED_MCP_URL}'`);
		expect(snippet.code).toContain('"method":"tools/list"');
	});
});
