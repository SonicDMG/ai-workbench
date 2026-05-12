/**
 * HTTP-level coverage for the `/connect/snippets` route. The unit
 * file (`connect-snippets.test.ts`) owns the rendered string content;
 * this one owns the wiring — 404 on missing workspace, query-param
 * round-tripping, `mcpEnabled` plumbing, cache headers, and the
 * X-Forwarded-* reverse-proxy path.
 */

import { randomUUID } from "node:crypto";
import { describe, expect, test } from "vitest";
import { createApp } from "../src/app.js";
import { AuthResolver } from "../src/auth/resolver.js";
import { MemoryControlPlaneStore } from "../src/control-plane/memory/store.js";
import { MockVectorStoreDriver } from "../src/drivers/mock/store.js";
import { VectorStoreDriverRegistry } from "../src/drivers/registry.js";
import { mcpTrafficBuffer } from "../src/lib/mcp-traffic-buffer.js";
import { EnvSecretProvider } from "../src/secrets/env.js";
import { SecretResolver } from "../src/secrets/provider.js";
import { makeFakeEmbedderFactory } from "./helpers/embedder.js";

// biome-ignore lint/suspicious/noExplicitAny: test helper returns untyped JSON
async function json(res: Response): Promise<any> {
	// biome-ignore lint/suspicious/noExplicitAny: test helper returns untyped JSON
	return (await res.json()) as any;
}

function makeApp(opts: { mcpEnabled: boolean }) {
	const store = new MemoryControlPlaneStore();
	const driver = new MockVectorStoreDriver();
	const drivers = new VectorStoreDriverRegistry(new Map([["mock", driver]]));
	const secrets = new SecretResolver({ env: new EnvSecretProvider() });
	const auth = new AuthResolver({
		mode: "disabled",
		anonymousPolicy: "allow",
		verifiers: [],
	});
	const embedders = makeFakeEmbedderFactory();
	const app = createApp({
		store,
		drivers,
		secrets,
		auth,
		embedders,
		mcpConfig: { enabled: opts.mcpEnabled, exposeChat: false },
	});
	return { app, store };
}

async function createWorkspace(
	app: ReturnType<typeof makeApp>["app"],
): Promise<string> {
	const res = await app.request("/api/v1/workspaces", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ name: "ws", kind: "mock" }),
	});
	expect(res.status).toBe(201);
	return (await json(res)).workspaceId as string;
}

describe("connect snippets route", () => {
	test("404 when the workspace does not exist", async () => {
		const { app } = makeApp({ mcpEnabled: true });
		const res = await app.request(
			"/api/v1/workspaces/00000000-0000-0000-0000-000000000000/connect/snippets",
		);
		expect(res.status).toBe(404);
		const body = await json(res);
		expect(body.error.code).toBe("workspace_not_found");
	});

	test("returns every registered target plus resolved endpoint URLs", async () => {
		const { app } = makeApp({ mcpEnabled: true });
		const ws = await createWorkspace(app);

		const res = await app.request(`/api/v1/workspaces/${ws}/connect/snippets`, {
			headers: {
				// Force a deterministic base URL via the reverse-proxy
				// header so the assertion is stable across environments.
				"x-forwarded-host": "workbench.example",
				"x-forwarded-proto": "https",
			},
		});
		expect(res.status).toBe(200);
		const body = await json(res);

		expect(body.workspaceId).toBe(ws);
		expect(body.publicBaseUrl).toBe("https://workbench.example");
		expect(body.mcpUrl).toBe(
			`https://workbench.example/api/v1/workspaces/${ws}/mcp`,
		);
		expect(body.restBaseUrl).toBe("https://workbench.example/api/v1");
		expect(body.mcpEnabled).toBe(true);
		expect(body.apiKeyEnvVar).toBe("WORKBENCH_API_KEY");
		expect(body.knowledgeBaseId).toBeNull();
		expect(Array.isArray(body.targets)).toBe(true);
		expect(body.targets.length).toBeGreaterThanOrEqual(6);
		// Spot-check one — the deeper rendering tests live in the unit
		// file; here we only verify the route returns the registry.
		const ids = body.targets.map((t: { id: string }) => t.id);
		expect(ids).toContain("langgraph");
		expect(ids).toContain("watsonx");
		expect(ids).toContain("mcp-raw");
	});

	test("threads mcp.enabled: false through to the response", async () => {
		const { app } = makeApp({ mcpEnabled: false });
		const ws = await createWorkspace(app);
		const res = await app.request(`/api/v1/workspaces/${ws}/connect/snippets`);
		expect(res.status).toBe(200);
		const body = await json(res);
		expect(body.mcpEnabled).toBe(false);
		// The MCP-requiring snippets still render — the UI is responsible
		// for warning the user via `requiresMcp + !mcpEnabled`.
		const lg = body.targets.find((t: { id: string }) => t.id === "langgraph");
		expect(lg.requiresMcp).toBe(true);
	});

	test("honours ?apiKeyEnvVar= overrides", async () => {
		const { app } = makeApp({ mcpEnabled: true });
		const ws = await createWorkspace(app);
		const res = await app.request(
			`/api/v1/workspaces/${ws}/connect/snippets?apiKeyEnvVar=DATASTAX_TOKEN`,
		);
		expect(res.status).toBe(200);
		const body = await json(res);
		expect(body.apiKeyEnvVar).toBe("DATASTAX_TOKEN");
		const lg = body.targets.find((t: { id: string }) => t.id === "langgraph");
		expect(lg.code).toContain("DATASTAX_TOKEN");
	});

	test("rejects an invalid env-var name with 400 validation_error", async () => {
		const { app } = makeApp({ mcpEnabled: true });
		const ws = await createWorkspace(app);
		const res = await app.request(
			`/api/v1/workspaces/${ws}/connect/snippets?apiKeyEnvVar=invalid-name`,
		);
		expect(res.status).toBe(400);
		const body = await json(res);
		expect(body.error.code).toBe("validation_error");
	});

	test("sets a short private Cache-Control on the success response", async () => {
		const { app } = makeApp({ mcpEnabled: true });
		const ws = await createWorkspace(app);
		const res = await app.request(`/api/v1/workspaces/${ws}/connect/snippets`);
		expect(res.status).toBe(200);
		expect(res.headers.get("cache-control")).toMatch(/private/);
	});

	test("threads ?knowledgeBaseId= through into the response", async () => {
		const { app } = makeApp({ mcpEnabled: true });
		const ws = await createWorkspace(app);
		// Use a real v4 UUID — Zod's `.uuid()` validates the version /
		// variant bits, so a placeholder like 1111…-5555 would be
		// rejected with 400 and obscure the actual assertion below.
		const kb = randomUUID();
		const res = await app.request(
			`/api/v1/workspaces/${ws}/connect/snippets?knowledgeBaseId=${kb}`,
		);
		expect(res.status).toBe(200);
		const body = await json(res);
		expect(body.knowledgeBaseId).toBe(kb);
	});
});

describe("connect verify route", () => {
	test("404 when the workspace does not exist", async () => {
		const { app } = makeApp({ mcpEnabled: true });
		const res = await app.request(
			"/api/v1/workspaces/00000000-0000-0000-0000-000000000000/connect/verify",
			{ method: "POST" },
		);
		expect(res.status).toBe(404);
		const body = await json(res);
		expect(body.error.code).toBe("workspace_not_found");
	});

	test("returns ok:true with the registered tool list when MCP is on", async () => {
		const { app } = makeApp({ mcpEnabled: true });
		const ws = await createWorkspace(app);
		const res = await app.request(`/api/v1/workspaces/${ws}/connect/verify`, {
			method: "POST",
		});
		expect(res.status).toBe(200);
		const body = await json(res);
		expect(body.ok).toBe(true);
		expect(body.mcpEnabled).toBe(true);
		expect(body.error).toBeNull();
		expect(typeof body.latencyMs).toBe("number");
		expect(body.latencyMs).toBeGreaterThanOrEqual(0);
		// The read tools always register. exposeChat is false here so
		// chat_send is absent; ingestService is wired by the plugin
		// so the `ingest_text` write tool is present. (`delete_document`
		// lands in a follow-up PR — add to this set once that merges.)
		expect(body.tools).toContain("search_kb");
		expect(body.tools).toContain("list_knowledge_bases");
		expect(body.tools).toContain("list_documents");
		expect(body.tools).toContain("list_chats");
		expect(body.tools).toContain("list_chat_messages");
		expect(body.tools).toContain("ingest_text");
		expect(body.tools).not.toContain("chat_send");
		expect(body.toolCount).toBe(body.tools.length);
		// The tool list is sorted for stable rendering in the UI.
		const sorted = [...body.tools].sort((a: string, b: string) =>
			a.localeCompare(b),
		);
		expect(body.tools).toEqual(sorted);
	});

	test("returns ok:false + mcpEnabled:false when MCP is off", async () => {
		const { app } = makeApp({ mcpEnabled: false });
		const ws = await createWorkspace(app);
		const res = await app.request(`/api/v1/workspaces/${ws}/connect/verify`, {
			method: "POST",
		});
		expect(res.status).toBe(200);
		const body = await json(res);
		expect(body.ok).toBe(false);
		expect(body.mcpEnabled).toBe(false);
		expect(body.toolCount).toBe(0);
		expect(body.tools).toEqual([]);
		// MCP-off is a legitimate "not wired" state, not a failure —
		// the UI should render an amber warning, not a red one.
		expect(body.error).toBeNull();
	});
});

describe("connect traffic route", () => {
	test("404 when the workspace does not exist", async () => {
		const { app } = makeApp({ mcpEnabled: true });
		const res = await app.request(
			"/api/v1/workspaces/00000000-0000-0000-0000-000000000000/connect/traffic",
		);
		expect(res.status).toBe(404);
		const body = await json(res);
		expect(body.error.code).toBe("workspace_not_found");
	});

	test("starts empty for a fresh workspace", async () => {
		mcpTrafficBuffer.reset();
		const { app } = makeApp({ mcpEnabled: true });
		const ws = await createWorkspace(app);
		const res = await app.request(`/api/v1/workspaces/${ws}/connect/traffic`);
		expect(res.status).toBe(200);
		const body = await json(res);
		expect(body.workspaceId).toBe(ws);
		expect(body.mcpEnabled).toBe(true);
		expect(body.entries).toEqual([]);
		expect(body.summary).toEqual({ total: 0, successes: 0, failures: 0 });
	});

	test("captures MCP tool calls from the audit pipeline", async () => {
		mcpTrafficBuffer.reset();
		const { app } = makeApp({ mcpEnabled: true });
		const ws = await createWorkspace(app);

		// Drive the MCP route over HTTP to exercise the full audit
		// path — `mcpRoutes` calls `audit(..., { action: "mcp.invoke" })`
		// in the `onToolInvoke` hook, which in turn pushes into the
		// traffic buffer.
		const mcp = await app.request(`/api/v1/workspaces/${ws}/mcp`, {
			method: "POST",
			headers: {
				"content-type": "application/json",
				accept: "application/json, text/event-stream",
			},
			body: JSON.stringify({
				jsonrpc: "2.0",
				id: 1,
				method: "tools/call",
				params: {
					name: "list_knowledge_bases",
					arguments: {},
				},
			}),
		});
		expect(mcp.status).toBe(200);

		const res = await app.request(`/api/v1/workspaces/${ws}/connect/traffic`);
		expect(res.status).toBe(200);
		const body = await json(res);
		expect(body.entries).toHaveLength(1);
		expect(body.entries[0].toolName).toBe("list_knowledge_bases");
		expect(body.entries[0].outcome).toBe("success");
		expect(body.summary.total).toBe(1);
		expect(body.summary.successes).toBe(1);
		expect(body.summary.failures).toBe(0);
		// No-store so the strip stays live in the UI.
		expect(res.headers.get("cache-control")).toMatch(/no-store/);
	});

	test("honours ?limit= and caps it server-side", async () => {
		mcpTrafficBuffer.reset();
		const { app } = makeApp({ mcpEnabled: true });
		const ws = await createWorkspace(app);

		// Seed the buffer directly to avoid the per-call MCP HTTP
		// overhead for this assertion.
		for (let i = 0; i < 5; i += 1) {
			mcpTrafficBuffer.record({
				workspaceId: ws,
				action: "mcp.invoke",
				outcome: "success",
				toolName: `tool-${i}`,
				subjectType: "anonymous",
				subjectLabel: null,
				reason: null,
			});
		}

		const res = await app.request(
			`/api/v1/workspaces/${ws}/connect/traffic?limit=2`,
		);
		expect(res.status).toBe(200);
		const body = await json(res);
		expect(body.entries).toHaveLength(2);
		expect(body.entries[0].toolName).toBe("tool-4");
		expect(body.entries[1].toolName).toBe("tool-3");

		// summary still counts the whole window, not the limited
		// page — the UI's header counter should not collapse to
		// `limit` artificially.
		expect(body.summary.total).toBe(5);
	});

	test("rejects limit above the server-side cap with 400", async () => {
		const { app } = makeApp({ mcpEnabled: true });
		const ws = await createWorkspace(app);
		const res = await app.request(
			`/api/v1/workspaces/${ws}/connect/traffic?limit=9999`,
		);
		expect(res.status).toBe(400);
		const body = await json(res);
		expect(body.error.code).toBe("validation_error");
	});
});
