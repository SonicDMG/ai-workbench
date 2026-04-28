/**
 * Route-level coverage for `/api/v1/workspaces/{w}/chats` and the
 * nested message endpoints. Mirrors the harness used by
 * `knowledge-bases.test.ts`: memory control plane + mock driver,
 * drive HTTP through `app.request`, assert on JSON.
 *
 * Only the CRUD surface ships in this PR — phase 4 wires HF + RAG
 * for the assistant reply, phase 5 converts message-send to SSE.
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

function makeApp() {
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
	return createApp({ store, drivers, secrets, auth, embedders });
}

async function createWorkspace(
	app: ReturnType<typeof makeApp>,
): Promise<string> {
	const res = await app.request("/api/v1/workspaces", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ name: "ws", kind: "mock" }),
	});
	expect(res.status).toBe(201);
	return (await json(res)).workspaceId as string;
}

async function createChat(
	app: ReturnType<typeof makeApp>,
	workspaceId: string,
	body: Record<string, unknown> = {},
): Promise<string> {
	const res = await app.request(`/api/v1/workspaces/${workspaceId}/chats`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(body),
	});
	expect(res.status, await res.clone().text()).toBe(201);
	return (await json(res)).chatId as string;
}

describe("chat routes", () => {
	test("POST creates a chat; GET list returns it; GET detail echoes", async () => {
		const app = makeApp();
		const ws = await createWorkspace(app);

		const created = await app.request(`/api/v1/workspaces/${ws}/chats`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				title: "First chat",
				knowledgeBaseIds: [
					"11111111-2222-4333-8444-555555555555",
					"22222222-3333-4444-8555-666666666666",
				],
			}),
		});
		expect(created.status).toBe(201);
		const cBody = await json(created);
		expect(cBody.title).toBe("First chat");
		expect(cBody.knowledgeBaseIds).toEqual([
			"11111111-2222-4333-8444-555555555555",
			"22222222-3333-4444-8555-666666666666",
		]);
		expect(cBody.workspaceId).toBe(ws);
		expect(typeof cBody.chatId).toBe("string");
		expect(typeof cBody.createdAt).toBe("string");
		// agent_id is intentionally not on the wire.
		expect(cBody.agentId).toBeUndefined();

		const list = await app.request(`/api/v1/workspaces/${ws}/chats`);
		expect(list.status).toBe(200);
		const lBody = await json(list);
		expect(lBody.items).toHaveLength(1);
		expect(lBody.items[0].chatId).toBe(cBody.chatId);

		const detail = await app.request(
			`/api/v1/workspaces/${ws}/chats/${cBody.chatId}`,
		);
		expect(detail.status).toBe(200);
		expect((await json(detail)).chatId).toBe(cBody.chatId);
	});

	test("creating with explicit chatId is idempotent on the wire (409 on duplicate)", async () => {
		const app = makeApp();
		const ws = await createWorkspace(app);
		const chatId = randomUUID();
		const ok = await app.request(`/api/v1/workspaces/${ws}/chats`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ chatId, title: "first" }),
		});
		expect(ok.status).toBe(201);
		const dup = await app.request(`/api/v1/workspaces/${ws}/chats`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ chatId, title: "second" }),
		});
		expect(dup.status).toBe(409);
		const eBody = await json(dup);
		expect(eBody.error.code).toBe("conflict");
	});

	test("PATCH updates title and KB filter independently", async () => {
		const app = makeApp();
		const ws = await createWorkspace(app);
		const chatId = await createChat(app, ws, {
			title: "old",
			knowledgeBaseIds: ["11111111-2222-4333-8444-555555555555"],
		});

		const renamed = await app.request(
			`/api/v1/workspaces/${ws}/chats/${chatId}`,
			{
				method: "PATCH",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ title: "new" }),
			},
		);
		expect(renamed.status).toBe(200);
		const rBody = await json(renamed);
		expect(rBody.title).toBe("new");
		expect(rBody.knowledgeBaseIds).toEqual([
			"11111111-2222-4333-8444-555555555555",
		]);

		const refiltered = await app.request(
			`/api/v1/workspaces/${ws}/chats/${chatId}`,
			{
				method: "PATCH",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					knowledgeBaseIds: [
						"11111111-2222-4333-8444-555555555555",
						"22222222-3333-4444-8555-666666666666",
					],
				}),
			},
		);
		expect(refiltered.status).toBe(200);
		const fBody = await json(refiltered);
		expect(fBody.title).toBe("new");
		expect(fBody.knowledgeBaseIds).toEqual([
			"11111111-2222-4333-8444-555555555555",
			"22222222-3333-4444-8555-666666666666",
		]);
	});

	test("DELETE drops chat + cascades messages", async () => {
		const app = makeApp();
		const ws = await createWorkspace(app);
		const chatId = await createChat(app, ws, { title: "t" });

		// Append a message so the cascade has something to clear.
		const msgRes = await app.request(
			`/api/v1/workspaces/${ws}/chats/${chatId}/messages`,
			{
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ content: "hi" }),
			},
		);
		expect(msgRes.status).toBe(201);

		const del = await app.request(`/api/v1/workspaces/${ws}/chats/${chatId}`, {
			method: "DELETE",
		});
		expect(del.status).toBe(204);

		const after = await app.request(`/api/v1/workspaces/${ws}/chats/${chatId}`);
		expect(after.status).toBe(404);

		// And messages are gone — re-creating a chat with the same id starts clean.
		await app.request(`/api/v1/workspaces/${ws}/chats`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ chatId, title: "fresh" }),
		});
		const list = await app.request(
			`/api/v1/workspaces/${ws}/chats/${chatId}/messages`,
		);
		expect(list.status).toBe(200);
		expect((await json(list)).items).toHaveLength(0);
	});

	test("404s on unknown workspace / chat", async () => {
		const app = makeApp();
		const ws = await createWorkspace(app);
		const ghost = "99999999-9999-4999-8999-999999999999";

		const noWs = await app.request(`/api/v1/workspaces/${ghost}/chats`);
		expect(noWs.status).toBe(404);
		expect((await json(noWs)).error.code).toBe("workspace_not_found");

		const noChat = await app.request(`/api/v1/workspaces/${ws}/chats/${ghost}`);
		expect(noChat.status).toBe(404);
		expect((await json(noChat)).error.code).toBe("chat_not_found");

		const noChatPatch = await app.request(
			`/api/v1/workspaces/${ws}/chats/${ghost}`,
			{
				method: "PATCH",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ title: "x" }),
			},
		);
		expect(noChatPatch.status).toBe(404);
	});

	test("POST /messages persists a user turn; GET returns history oldest-first", async () => {
		const app = makeApp();
		const ws = await createWorkspace(app);
		const chatId = await createChat(app, ws, { title: "t" });

		const send1 = await app.request(
			`/api/v1/workspaces/${ws}/chats/${chatId}/messages`,
			{
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ content: "first" }),
			},
		);
		expect(send1.status).toBe(201);
		const m1 = await json(send1);
		expect(m1.role).toBe("user");
		expect(m1.content).toBe("first");
		expect(m1.chatId).toBe(chatId);
		expect(typeof m1.messageId).toBe("string");

		await new Promise((r) => setTimeout(r, 5));
		const send2 = await app.request(
			`/api/v1/workspaces/${ws}/chats/${chatId}/messages`,
			{
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ content: "second" }),
			},
		);
		expect(send2.status).toBe(201);

		const list = await app.request(
			`/api/v1/workspaces/${ws}/chats/${chatId}/messages`,
		);
		expect(list.status).toBe(200);
		const items = (await json(list)).items as Array<{ content: string }>;
		expect(items).toHaveLength(2);
		// Oldest-first per the table cluster ordering.
		expect(items[0]?.content).toBe("first");
		expect(items[1]?.content).toBe("second");
	});

	test("POST /messages rejects an empty body", async () => {
		const app = makeApp();
		const ws = await createWorkspace(app);
		const chatId = await createChat(app, ws, { title: "t" });

		const res = await app.request(
			`/api/v1/workspaces/${ws}/chats/${chatId}/messages`,
			{
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ content: "" }),
			},
		);
		// zod validation triggers a 400.
		expect(res.status).toBe(400);
	});

	test("auth scope: scoped subject can't read another workspace's chats", async () => {
		const app = makeApp();
		const wsA = await createWorkspace(app);
		const wsB = await createWorkspace(app);
		const chatId = await createChat(app, wsA, { title: "secret" });

		// The harness uses anonymous auth (`auth.mode = "disabled"`,
		// `anonymousPolicy = "allow"`), which means workspaceScopes is
		// `null` — full access. So this assertion is a smoke test: the
		// route authority is enforced via `assertWorkspaceAccess`, and
		// the negative case is exercised by the auth-resolver tests.
		// Here we just confirm the route hands off cleanly when
		// anonymous access is allowed.
		const res = await app.request(`/api/v1/workspaces/${wsA}/chats/${chatId}`);
		expect(res.status).toBe(200);
		// And the workspace-id check naturally rejects unknown ones.
		const cross = await app.request(
			`/api/v1/workspaces/${wsB}/chats/${chatId}`,
		);
		expect(cross.status).toBe(404);
	});
});
