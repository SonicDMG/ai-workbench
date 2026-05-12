/**
 * Integration coverage for `mutatingRouteWriteScope()` — the REST-side
 * gate that refuses POST/PATCH/PUT/DELETE on workspace-scoped routes
 * when the caller's API key is missing the `write` scope.
 *
 * The middleware sits between `workspaceRouteAuthz()` and the route
 * plugins (see `app.ts`), so this file exercises the **mounted**
 * pipeline end-to-end: build a real app in `apiKey` mode, mint two
 * keys (one read-only, one read+write) against a workspace, and
 * exercise representative routes from each surface.
 *
 * Read tools (`GET *`, `POST .../search`, MCP tool calls,
 * `test-connection`, `verify`, chat sends) deliberately stay open to
 * read-only keys — the gate is for KB / agent / service mutations.
 */

import { describe, expect, test } from "vitest";
import { createApp } from "../../src/app.js";
import { mintToken } from "../../src/auth/apiKey/token.js";
import { ApiKeyVerifier } from "../../src/auth/apiKey/verifier.js";
import { AuthResolver } from "../../src/auth/resolver.js";
import { MemoryControlPlaneStore } from "../../src/control-plane/memory/store.js";
import { MockVectorStoreDriver } from "../../src/drivers/mock/store.js";
import { VectorStoreDriverRegistry } from "../../src/drivers/registry.js";
import { EnvSecretProvider } from "../../src/secrets/env.js";
import { SecretResolver } from "../../src/secrets/provider.js";
import { makeFakeEmbedderFactory } from "../helpers/embedder.js";

// biome-ignore lint/suspicious/noExplicitAny: test helper returns untyped JSON
async function json(res: Response): Promise<any> {
	// biome-ignore lint/suspicious/noExplicitAny: test helper returns untyped JSON
	return (await res.json()) as any;
}

interface Harness {
	readonly app: ReturnType<typeof createApp>;
	readonly store: MemoryControlPlaneStore;
	readonly workspace: string;
	readonly readToken: string;
	readonly writeToken: string;
}

async function makeHarness(): Promise<Harness> {
	const store = new MemoryControlPlaneStore();
	const driver = new MockVectorStoreDriver();
	const drivers = new VectorStoreDriverRegistry(new Map([["mock", driver]]));
	const secrets = new SecretResolver({ env: new EnvSecretProvider() });
	const auth = new AuthResolver({
		mode: "apiKey",
		// `reject` so an unauthenticated request gets 401 — keeps the
		// scope test from being silently shadowed by anonymous
		// pass-through.
		anonymousPolicy: "reject",
		verifiers: [new ApiKeyVerifier({ store })],
	});
	const embedders = makeFakeEmbedderFactory();
	const app = createApp({
		store,
		drivers,
		secrets,
		auth,
		embedders,
		mcpConfig: { enabled: true, exposeChat: false },
	});

	const ws = await store.createWorkspace({ name: "ws", kind: "mock" });

	// Mint a read-only key + a full-access key on the workspace via
	// the store directly. The HTTP create route also works but adds a
	// chicken-and-egg: we'd need an existing key to mint another one.
	const readMinted = await mintToken();
	await store.persistApiKey(ws.uid, {
		keyId: "00000000-0000-0000-0000-00000000aaaa",
		prefix: readMinted.prefix,
		hash: readMinted.hash,
		label: "read-only",
		scopes: ["read"],
	});
	const writeMinted = await mintToken();
	await store.persistApiKey(ws.uid, {
		keyId: "00000000-0000-0000-0000-00000000bbbb",
		prefix: writeMinted.prefix,
		hash: writeMinted.hash,
		label: "read+write",
		scopes: ["read", "write"],
	});

	return {
		app,
		store,
		workspace: ws.uid,
		readToken: readMinted.plaintext,
		writeToken: writeMinted.plaintext,
	};
}

function authHeader(token: string): Record<string, string> {
	return { authorization: `Bearer ${token}` };
}

describe("mutatingRouteWriteScope on the workspace REST surface", () => {
	test("read-only key gets 403 on PATCH /workspaces/{w}", async () => {
		const h = await makeHarness();
		const res = await h.app.request(`/api/v1/workspaces/${h.workspace}`, {
			method: "PATCH",
			headers: {
				"content-type": "application/json",
				...authHeader(h.readToken),
			},
			body: JSON.stringify({ name: "renamed" }),
		});
		expect(res.status).toBe(403);
		const body = await json(res);
		expect(body.error.code).toBe("forbidden");
		expect(body.error.message).toMatch(/scope/i);
	});

	test("read-only key gets 403 on POST /knowledge-bases", async () => {
		const h = await makeHarness();
		const res = await h.app.request(
			`/api/v1/workspaces/${h.workspace}/knowledge-bases`,
			{
				method: "POST",
				headers: {
					"content-type": "application/json",
					...authHeader(h.readToken),
				},
				body: JSON.stringify({
					name: "kb_blocked",
					chunkingServiceId: "00000000-0000-0000-0000-000000000001",
					embeddingServiceId: "00000000-0000-0000-0000-000000000002",
				}),
			},
		);
		expect(res.status).toBe(403);
	});

	test("read-only key gets 403 on DELETE /workspaces/{w}", async () => {
		const h = await makeHarness();
		const res = await h.app.request(`/api/v1/workspaces/${h.workspace}`, {
			method: "DELETE",
			headers: authHeader(h.readToken),
		});
		expect(res.status).toBe(403);
	});

	test("read-only key gets 403 on POST /api-keys (key issuance is a mutation)", async () => {
		const h = await makeHarness();
		const res = await h.app.request(
			`/api/v1/workspaces/${h.workspace}/api-keys`,
			{
				method: "POST",
				headers: {
					"content-type": "application/json",
					...authHeader(h.readToken),
				},
				body: JSON.stringify({ label: "escalation-attempt" }),
			},
		);
		// A read-only key minting a new key would be a silent
		// privilege escalation — gate it.
		expect(res.status).toBe(403);
	});

	test("read+write key succeeds on PATCH /workspaces/{w}", async () => {
		const h = await makeHarness();
		const res = await h.app.request(`/api/v1/workspaces/${h.workspace}`, {
			method: "PATCH",
			headers: {
				"content-type": "application/json",
				...authHeader(h.writeToken),
			},
			body: JSON.stringify({ name: "renamed" }),
		});
		expect(res.status).toBe(200);
		const body = await json(res);
		expect(body.name).toBe("renamed");
	});

	test("read-only key can still GET (the read floor)", async () => {
		const h = await makeHarness();
		const res = await h.app.request(`/api/v1/workspaces/${h.workspace}`, {
			method: "GET",
			headers: authHeader(h.readToken),
		});
		expect(res.status).toBe(200);
	});

	test("read-only key can POST to /test-connection (read-shaped probe)", async () => {
		const h = await makeHarness();
		const res = await h.app.request(
			`/api/v1/workspaces/${h.workspace}/test-connection`,
			{ method: "POST", headers: authHeader(h.readToken) },
		);
		// Mock workspaces always succeed on the connection probe.
		expect(res.status).toBe(200);
	});

	test("read-only key can POST to /connect/verify (read-shaped smoke test)", async () => {
		const h = await makeHarness();
		const res = await h.app.request(
			`/api/v1/workspaces/${h.workspace}/connect/verify`,
			{ method: "POST", headers: authHeader(h.readToken) },
		);
		expect(res.status).toBe(200);
		const body = await json(res);
		expect(body.ok).toBe(true);
	});

	test("read-only key can POST to /mcp (JSON-RPC; tool-level scope check handles writes)", async () => {
		const h = await makeHarness();
		// The MCP route's scope gate fires at the tool layer, not the
		// route layer — gating /mcp here would block `search_kb`
		// calls from a read-only key. A `tools/list` request models
		// the typical "agent connecting" flow.
		const res = await h.app.request(`/api/v1/workspaces/${h.workspace}/mcp`, {
			method: "POST",
			headers: {
				"content-type": "application/json",
				accept: "application/json, text/event-stream",
				...authHeader(h.readToken),
			},
			body: JSON.stringify({
				jsonrpc: "2.0",
				id: 1,
				method: "tools/list",
			}),
		});
		expect(res.status).toBe(200);
	});

	test("read-only key can POST a chat message (chat session, not KB content)", async () => {
		const h = await makeHarness();
		// Mirror the MCP-side decision: chat sends are session state,
		// not KB content, so they stay open to read-only keys. The
		// runtime needs an agent + conversation to actually exercise
		// the send path — but the gate check happens before the
		// route handler runs, so a synthetic POST is sufficient to
		// confirm the middleware lets the request through. A 404
		// from the route handler (agent / conversation not found) is
		// the "passed the gate" signal we want.
		const fakeAgentId = "00000000-0000-0000-0000-000000000aaa";
		const fakeChatId = "00000000-0000-0000-0000-000000000bbb";
		const res = await h.app.request(
			`/api/v1/workspaces/${h.workspace}/agents/${fakeAgentId}/conversations/${fakeChatId}/messages`,
			{
				method: "POST",
				headers: {
					"content-type": "application/json",
					...authHeader(h.readToken),
				},
				body: JSON.stringify({ content: "hello" }),
			},
		);
		// Pass the scope gate → handler runs → 404 for the missing
		// agent. Crucially NOT 403.
		expect(res.status).not.toBe(403);
	});

	test("read-only key can POST to /search (query, not write)", async () => {
		const h = await makeHarness();
		// Same posture as the chat test: confirm the gate passes by
		// asserting the response is not 403. The handler returns 404
		// for the unknown KB, which is fine for this assertion.
		const fakeKbId = "11111111-2222-4333-8444-555555555555";
		const res = await h.app.request(
			`/api/v1/workspaces/${h.workspace}/knowledge-bases/${fakeKbId}/search`,
			{
				method: "POST",
				headers: {
					"content-type": "application/json",
					...authHeader(h.readToken),
				},
				body: JSON.stringify({ text: "anything" }),
			},
		);
		expect(res.status).not.toBe(403);
	});
});
