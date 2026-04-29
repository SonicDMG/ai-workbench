/**
 * Route-level coverage for `/api/v1/workspaces/{w}/agents` and the
 * nested per-agent conversation routes. Uses the memory control
 * plane and a mock vector driver — chat send paths are NOT covered
 * here (they live on `/chats` and are exercised by `chats.test.ts`).
 */

import { randomUUID } from "node:crypto";
import { describe, expect, test } from "vitest";
import { createApp } from "../src/app.js";
import { AuthResolver } from "../src/auth/resolver.js";
import { MemoryControlPlaneStore } from "../src/control-plane/memory/store.js";
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
	const driver = new MockVectorStoreDriver();
	const drivers = new VectorStoreDriverRegistry(new Map([["mock", driver]]));
	const secrets = new SecretResolver({ env: new EnvSecretProvider() });
	const auth = new AuthResolver({
		mode: "disabled",
		anonymousPolicy: "allow",
		verifiers: [],
	});
	const embedders = makeFakeEmbedderFactory();
	return createApp({
		store,
		drivers,
		secrets,
		auth,
		embedders,
		chatService: null,
		chatConfig: null,
	});
}

type AppHandle = ReturnType<typeof makeApp>;

async function createWorkspace(app: AppHandle): Promise<string> {
	const res = await app.request("/api/v1/workspaces", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ name: "ws", kind: "mock" }),
	});
	expect(res.status).toBe(201);
	return (await json(res)).workspaceId as string;
}

async function createAgent(
	app: AppHandle,
	workspaceId: string,
	body: Record<string, unknown> = { name: "Helper" },
): Promise<string> {
	const res = await app.request(`/api/v1/workspaces/${workspaceId}/agents`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(body),
	});
	expect(res.status, await res.clone().text()).toBe(201);
	return (await json(res)).agentId as string;
}

describe("agent routes", () => {
	test("POST creates; GET list returns it; GET detail echoes", async () => {
		const app = makeApp();
		const ws = await createWorkspace(app);

		const create = await app.request(`/api/v1/workspaces/${ws}/agents`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				name: "Researcher",
				description: "Reads papers",
				systemPrompt: "You are a careful researcher.",
				ragEnabled: true,
				knowledgeBaseIds: ["11111111-2222-4333-8444-555555555555"],
			}),
		});
		expect(create.status).toBe(201);
		const created = await json(create);
		expect(created.name).toBe("Researcher");
		expect(created.ragEnabled).toBe(true);
		expect(created.knowledgeBaseIds).toEqual([
			"11111111-2222-4333-8444-555555555555",
		]);

		const list = await app.request(`/api/v1/workspaces/${ws}/agents`);
		expect(list.status).toBe(200);
		const lBody = await json(list);
		// listAgents returns oldest-first; user-created agent comes after Bobbie
		// only if Bobbie was already ensured. With no chat send yet, Bobbie
		// hasn't been created, so the list contains just the new agent.
		expect(lBody.items.length).toBe(1);
		expect(lBody.items[0].agentId).toBe(created.agentId);

		const detail = await app.request(
			`/api/v1/workspaces/${ws}/agents/${created.agentId}`,
		);
		expect(detail.status).toBe(200);
		expect((await json(detail)).agentId).toBe(created.agentId);
	});

	test("POST honors caller-supplied agentId; rejects duplicates with 409", async () => {
		const app = makeApp();
		const ws = await createWorkspace(app);
		const wantId = randomUUID();

		const first = await app.request(`/api/v1/workspaces/${ws}/agents`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ agentId: wantId, name: "Pinned" }),
		});
		expect(first.status).toBe(201);
		expect((await json(first)).agentId).toBe(wantId);

		const dup = await app.request(`/api/v1/workspaces/${ws}/agents`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ agentId: wantId, name: "Pinned" }),
		});
		expect(dup.status).toBe(409);
	});

	test("PATCH updates fields; null clears nullable fields", async () => {
		const app = makeApp();
		const ws = await createWorkspace(app);
		const aid = await createAgent(app, ws, {
			name: "X",
			description: "old",
			ragEnabled: true,
		});

		const res = await app.request(`/api/v1/workspaces/${ws}/agents/${aid}`, {
			method: "PATCH",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				name: "X-renamed",
				description: null,
				ragEnabled: false,
			}),
		});
		expect(res.status).toBe(200);
		const updated = await json(res);
		expect(updated.name).toBe("X-renamed");
		expect(updated.description).toBeNull();
		expect(updated.ragEnabled).toBe(false);
	});

	test("DELETE 204; cascades the agent's conversations + messages", async () => {
		const app = makeApp();
		const ws = await createWorkspace(app);
		const aid = await createAgent(app, ws);

		// Start a conversation under the agent.
		const conv = await app.request(
			`/api/v1/workspaces/${ws}/agents/${aid}/conversations`,
			{
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ title: "Will be cascaded" }),
			},
		);
		expect(conv.status).toBe(201);
		const convId = (await json(conv)).conversationId as string;

		const del = await app.request(`/api/v1/workspaces/${ws}/agents/${aid}`, {
			method: "DELETE",
		});
		expect(del.status).toBe(204);

		// Conversation is gone with the agent.
		const after = await app.request(
			`/api/v1/workspaces/${ws}/agents/${aid}/conversations/${convId}`,
		);
		// Workspace still exists; conversation lookup falls through to 404.
		expect(after.status).toBe(404);

		// Re-creating the same agent id is fine after delete.
		const reuse = await app.request(`/api/v1/workspaces/${ws}/agents`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ agentId: aid, name: "Reborn" }),
		});
		expect(reuse.status).toBe(201);
	});

	test("404 on missing agent / workspace", async () => {
		const app = makeApp();
		const ws = await createWorkspace(app);
		const missing = randomUUID();

		expect(
			(await app.request(`/api/v1/workspaces/${ws}/agents/${missing}`)).status,
		).toBe(404);

		const patchMissing = await app.request(
			`/api/v1/workspaces/${ws}/agents/${missing}`,
			{
				method: "PATCH",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ name: "x" }),
			},
		);
		expect(patchMissing.status).toBe(404);

		expect(
			(
				await app.request(`/api/v1/workspaces/${ws}/agents/${missing}`, {
					method: "DELETE",
				})
			).status,
		).toBe(404);

		// Missing workspace.
		const noWs = await app.request(`/api/v1/workspaces/${missing}/agents`);
		expect(noWs.status).toBe(404);
	});
});

describe("agent conversation routes", () => {
	test("POST creates; GET list returns it; PATCH updates; DELETE 204", async () => {
		const app = makeApp();
		const ws = await createWorkspace(app);
		const aid = await createAgent(app, ws);

		const create = await app.request(
			`/api/v1/workspaces/${ws}/agents/${aid}/conversations`,
			{
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					title: "First convo",
					knowledgeBaseIds: ["11111111-2222-4333-8444-555555555555"],
				}),
			},
		);
		expect(create.status).toBe(201);
		const created = await json(create);
		expect(created.agentId).toBe(aid);
		expect(created.title).toBe("First convo");
		expect(created.knowledgeBaseIds).toEqual([
			"11111111-2222-4333-8444-555555555555",
		]);

		const list = await app.request(
			`/api/v1/workspaces/${ws}/agents/${aid}/conversations`,
		);
		expect(list.status).toBe(200);
		expect((await json(list)).items.length).toBe(1);

		const patch = await app.request(
			`/api/v1/workspaces/${ws}/agents/${aid}/conversations/${created.conversationId}`,
			{
				method: "PATCH",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ title: "Renamed" }),
			},
		);
		expect(patch.status).toBe(200);
		expect((await json(patch)).title).toBe("Renamed");

		const del = await app.request(
			`/api/v1/workspaces/${ws}/agents/${aid}/conversations/${created.conversationId}`,
			{ method: "DELETE" },
		);
		expect(del.status).toBe(204);

		const gone = await app.request(
			`/api/v1/workspaces/${ws}/agents/${aid}/conversations/${created.conversationId}`,
		);
		expect(gone.status).toBe(404);
	});

	test("POST without agent → 404", async () => {
		const app = makeApp();
		const ws = await createWorkspace(app);
		const ghost = randomUUID();

		const res = await app.request(
			`/api/v1/workspaces/${ws}/agents/${ghost}/conversations`,
			{
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({}),
			},
		);
		expect(res.status).toBe(404);
	});

	test("conversations from different agents in same workspace stay isolated", async () => {
		const app = makeApp();
		const ws = await createWorkspace(app);
		const a1 = await createAgent(app, ws, { name: "A" });
		const a2 = await createAgent(app, ws, { name: "B" });

		await app.request(`/api/v1/workspaces/${ws}/agents/${a1}/conversations`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ title: "for-A" }),
		});

		const listA = await app.request(
			`/api/v1/workspaces/${ws}/agents/${a1}/conversations`,
		);
		const listB = await app.request(
			`/api/v1/workspaces/${ws}/agents/${a2}/conversations`,
		);
		expect((await json(listA)).items.length).toBe(1);
		expect((await json(listB)).items.length).toBe(0);
	});
});
