/**
 * Route-level coverage for `/api/v1/workspaces/{w}/mcp-servers` (0.4.0 A2).
 *
 * Two layers:
 *   1. CRUD surface with auth disabled — create / get / list / patch /
 *      delete round-trip, 404s, 409 on duplicate explicit id, and the
 *      SSRF / shape rejection (422) on a blocked server URL.
 *   2. Scope gating with API-key auth — a `read`-only key is refused
 *      (403) on writes; a `write` key is allowed (registering an MCP
 *      server is workspace content, not an admin `manage` op).
 */

import { describe, expect, test } from "vitest";
import { createApp } from "../src/app.js";
import { mintToken } from "../src/auth/apiKey/token.js";
import { ApiKeyVerifier } from "../src/auth/apiKey/verifier.js";
import { AuthResolver } from "../src/auth/resolver.js";
import { MemoryControlPlaneStore } from "../src/control-plane/memory/store.js";
import type { ApiKeyScope } from "../src/control-plane/types.js";
import { MockVectorStoreDriver } from "../src/drivers/mock/store.js";
import { VectorStoreDriverRegistry } from "../src/drivers/registry.js";
import { EnvSecretProvider } from "../src/secrets/env.js";
import { SecretResolver } from "../src/secrets/provider.js";
import { makeFakeEmbedderFactory } from "./helpers/embedder.js";

// biome-ignore lint/suspicious/noExplicitAny: test helper returns untyped JSON
async function json(res: Response): Promise<any> {
	// biome-ignore lint/suspicious/noExplicitAny: test helper returns untyped JSON
	return (await res.json()) as any;
}

function makeApp(): ReturnType<typeof createApp> {
	const store = new MemoryControlPlaneStore();
	const drivers = new VectorStoreDriverRegistry(
		new Map([["mock", new MockVectorStoreDriver()]]),
	);
	const secrets = new SecretResolver({ env: new EnvSecretProvider() });
	const auth = new AuthResolver({
		mode: "disabled",
		anonymousPolicy: "allow",
		verifiers: [],
	});
	return createApp({
		store,
		drivers,
		secrets,
		auth,
		embedders: makeFakeEmbedderFactory(),
	});
}

type AppHandle = ReturnType<typeof createApp>;

async function createWorkspace(app: AppHandle): Promise<string> {
	const res = await app.request("/api/v1/workspaces", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ name: "ws", kind: "mock" }),
	});
	expect(res.status).toBe(201);
	return (await json(res)).workspaceId as string;
}

describe("mcp-servers routes — CRUD", () => {
	test("POST → GET round-trip preserves the record + defaults", async () => {
		const app = makeApp();
		const ws = await createWorkspace(app);
		const post = await app.request(`/api/v1/workspaces/${ws}/mcp-servers`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				label: "Docs MCP",
				url: "https://mcp.example.com/mcp",
				credentialRef: "env:DOCS_MCP_TOKEN",
				allowedTools: ["search", "fetch", "search"],
			}),
		});
		expect(post.status, await post.clone().text()).toBe(201);
		const created = await json(post);
		expect(created.mcpServerId).toMatch(/^[0-9a-f-]{36}$/);
		expect(created.workspaceId).toBe(ws);
		expect(created.label).toBe("Docs MCP");
		expect(created.url).toBe("https://mcp.example.com/mcp");
		expect(created.credentialRef).toBe("env:DOCS_MCP_TOKEN");
		expect(created.enabled).toBe(true);
		expect(created.allowedTools).toEqual(["fetch", "search"]);

		const get = await app.request(
			`/api/v1/workspaces/${ws}/mcp-servers/${created.mcpServerId}`,
		);
		expect(get.status).toBe(200);
		expect((await json(get)).label).toBe("Docs MCP");
	});

	test("defaults: enabled=true, credentialRef=null, allowedTools=null", async () => {
		const app = makeApp();
		const ws = await createWorkspace(app);
		const post = await app.request(`/api/v1/workspaces/${ws}/mcp-servers`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				label: "Bare",
				url: "https://bare.example.com/mcp",
			}),
		});
		expect(post.status).toBe(201);
		const created = await json(post);
		expect(created.enabled).toBe(true);
		expect(created.credentialRef).toBeNull();
		expect(created.allowedTools).toBeNull();
	});

	test("list returns the page envelope", async () => {
		const app = makeApp();
		const ws = await createWorkspace(app);
		await app.request(`/api/v1/workspaces/${ws}/mcp-servers`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ label: "A", url: "https://a.example.com/mcp" }),
		});
		const list = await app.request(`/api/v1/workspaces/${ws}/mcp-servers`);
		expect(list.status).toBe(200);
		const page = await json(list);
		expect(page.items).toHaveLength(1);
		expect(page.items[0].label).toBe("A");
		expect(page).toHaveProperty("nextCursor");
	});

	test("PATCH applies a partial update", async () => {
		const app = makeApp();
		const ws = await createWorkspace(app);
		const created = await json(
			await app.request(`/api/v1/workspaces/${ws}/mcp-servers`, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					label: "Old",
					url: "https://old.example.com/mcp",
				}),
			}),
		);
		const patch = await app.request(
			`/api/v1/workspaces/${ws}/mcp-servers/${created.mcpServerId}`,
			{
				method: "PATCH",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ enabled: false, allowedTools: ["only"] }),
			},
		);
		expect(patch.status, await patch.clone().text()).toBe(200);
		const updated = await json(patch);
		expect(updated.enabled).toBe(false);
		expect(updated.allowedTools).toEqual(["only"]);
		expect(updated.url).toBe("https://old.example.com/mcp");
	});

	test("DELETE removes the row (then 404 on re-fetch + re-delete)", async () => {
		const app = makeApp();
		const ws = await createWorkspace(app);
		const created = await json(
			await app.request(`/api/v1/workspaces/${ws}/mcp-servers`, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					label: "Doomed",
					url: "https://doomed.example.com/mcp",
				}),
			}),
		);
		const del = await app.request(
			`/api/v1/workspaces/${ws}/mcp-servers/${created.mcpServerId}`,
			{ method: "DELETE" },
		);
		expect(del.status).toBe(204);
		const get = await app.request(
			`/api/v1/workspaces/${ws}/mcp-servers/${created.mcpServerId}`,
		);
		expect(get.status).toBe(404);
		const del2 = await app.request(
			`/api/v1/workspaces/${ws}/mcp-servers/${created.mcpServerId}`,
			{ method: "DELETE" },
		);
		expect(del2.status).toBe(404);
	});

	test("GET unknown server → 404", async () => {
		const app = makeApp();
		const ws = await createWorkspace(app);
		// Valid-shape UUID (v4) that simply doesn't exist → the handler's
		// not-found, not a param-validation 400.
		const get = await app.request(
			`/api/v1/workspaces/${ws}/mcp-servers/11111111-1111-4111-8111-111111111111`,
		);
		expect(get.status).toBe(404);
	});

	test("rejects a cloud-metadata server URL at the route (validation_error)", async () => {
		const app = makeApp();
		const ws = await createWorkspace(app);
		const post = await app.request(`/api/v1/workspaces/${ws}/mcp-servers`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				label: "evil",
				url: "http://169.254.169.254/mcp",
			}),
		});
		// Schema-level SSRF guard rejects at config-write time. This app
		// maps Zod refine failures to 400 `validation_error`.
		expect(post.status).toBe(400);
		expect((await json(post)).error.code).toBe("validation_error");
	});
});

/* ---------------- scope gating ---------------- */

interface ScopeHarness {
	readonly app: AppHandle;
	readonly workspace: string;
	mint(scopes: ApiKeyScope[]): Promise<string>;
}

let keySeq = 0;
async function makeScopeHarness(): Promise<ScopeHarness> {
	const store = new MemoryControlPlaneStore();
	const drivers = new VectorStoreDriverRegistry(
		new Map([["mock", new MockVectorStoreDriver()]]),
	);
	const secrets = new SecretResolver({ env: new EnvSecretProvider() });
	const auth = new AuthResolver({
		mode: "apiKey",
		anonymousPolicy: "reject",
		verifiers: [new ApiKeyVerifier({ store })],
	});
	const app = createApp({
		store,
		drivers,
		secrets,
		auth,
		embedders: makeFakeEmbedderFactory(),
	});
	const ws = await store.createWorkspace({ name: "primary", kind: "mock" });
	return {
		app,
		workspace: ws.uid,
		async mint(scopes: ApiKeyScope[]): Promise<string> {
			const minted = await mintToken();
			keySeq += 1;
			await store.persistApiKey(ws.uid, {
				keyId: `00000000-0000-0000-0000-${String(keySeq).padStart(12, "0")}`,
				prefix: minted.prefix,
				hash: minted.hash,
				label: scopes.join("+"),
				scopes,
			});
			return minted.plaintext;
		},
	};
}

describe("mcp-servers routes — scope gating", () => {
	test("read-only key can list but is refused (403) on create", async () => {
		const h = await makeScopeHarness();
		const reader = await h.mint(["read"]);

		const list = await h.app.request(
			`/api/v1/workspaces/${h.workspace}/mcp-servers`,
			{ headers: { authorization: `Bearer ${reader}` } },
		);
		expect(list.status).toBe(200);

		const create = await h.app.request(
			`/api/v1/workspaces/${h.workspace}/mcp-servers`,
			{
				method: "POST",
				headers: {
					"content-type": "application/json",
					authorization: `Bearer ${reader}`,
				},
				body: JSON.stringify({
					label: "blocked",
					url: "https://blocked.example.com/mcp",
				}),
			},
		);
		expect(create.status).toBe(403);
	});

	test("write key (editor) can register a server — not gated to manage", async () => {
		const h = await makeScopeHarness();
		const editor = await h.mint(["read", "write"]);
		const create = await h.app.request(
			`/api/v1/workspaces/${h.workspace}/mcp-servers`,
			{
				method: "POST",
				headers: {
					"content-type": "application/json",
					authorization: `Bearer ${editor}`,
				},
				body: JSON.stringify({
					label: "ok",
					url: "https://ok.example.com/mcp",
				}),
			},
		);
		expect(create.status, await create.clone().text()).toBe(201);
	});
});
