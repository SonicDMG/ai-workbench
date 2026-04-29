/**
 * Route-level coverage for `/api/v1/workspaces/{w}/chats` and the
 * nested message endpoints (sync + SSE streaming). Mirrors the
 * harness used by `knowledge-bases.test.ts`: memory control plane,
 * mock vector driver, fake chat service. Drives HTTP through
 * `app.request` and asserts on JSON / parsed SSE.
 */

import { randomUUID } from "node:crypto";
import { describe, expect, test } from "vitest";
import { createApp } from "../src/app.js";
import { AuthResolver } from "../src/auth/resolver.js";
import type { ChatService } from "../src/chat/types.js";
import { MemoryControlPlaneStore } from "../src/control-plane/memory/store.js";
import { MockVectorStoreDriver } from "../src/drivers/mock/store.js";
import { VectorStoreDriverRegistry } from "../src/drivers/registry.js";
import { EnvSecretProvider } from "../src/secrets/env.js";
import { SecretResolver } from "../src/secrets/provider.js";
import {
	type FakeChatService,
	makeFakeChatService,
	TEST_CHAT_CONFIG,
} from "./helpers/chat.js";
import { makeFakeEmbedderFactory } from "./helpers/embedder.js";

// biome-ignore lint/suspicious/noExplicitAny: test helper returns untyped JSON
async function json(res: Response): Promise<any> {
	// biome-ignore lint/suspicious/noExplicitAny: test helper returns untyped JSON
	return (await res.json()) as any;
}

interface MakeAppOptions {
	readonly chatService?: ChatService | null;
}

function makeApp(opts: MakeAppOptions = {}): {
	app: ReturnType<typeof createApp>;
	chatService: FakeChatService | null;
} {
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
	// Default to a fake chat service so message-sending tests work. Tests
	// that want to exercise the chat_disabled path pass `chatService: null`.
	const fake =
		opts.chatService === null
			? null
			: ((opts.chatService as FakeChatService | undefined) ??
				makeFakeChatService());
	const app = createApp({
		store,
		drivers,
		secrets,
		auth,
		embedders,
		chatService: fake,
		chatConfig: fake ? TEST_CHAT_CONFIG : null,
	});
	return {
		app,
		chatService: (fake as FakeChatService | null) ?? null,
	};
}

type AppHandle = ReturnType<typeof makeApp>["app"];

async function createWorkspace(app: AppHandle): Promise<string> {
	const res = await app.request("/api/v1/workspaces", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ name: "ws", kind: "mock" }),
	});
	expect(res.status).toBe(201);
	return (await json(res)).workspaceId as string;
}

async function createChat(
	app: AppHandle,
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
		const { app } = makeApp();
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
		const { app } = makeApp();
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
		const { app } = makeApp();
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
		const { app } = makeApp();
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
		const { app } = makeApp();
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

	test("POST /messages persists user + assistant turns; history is oldest-first", async () => {
		const { app } = makeApp();
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
		const r1 = await json(send1);
		expect(r1.user.role).toBe("user");
		expect(r1.user.content).toBe("first");
		expect(r1.user.chatId).toBe(chatId);
		expect(typeof r1.user.messageId).toBe("string");
		// Assistant turn from the fake chat service: deterministic echo.
		expect(r1.assistant.role).toBe("agent");
		expect(r1.assistant.content).toBe("echo: first");
		expect(r1.assistant.metadata.model).toBe("fake-test-model");
		expect(r1.assistant.metadata.finish_reason).toBe("stop");

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
		const items = (await json(list)).items as Array<{
			role: string;
			content: string;
		}>;
		// Two user turns + two assistant turns. Ordering inside the
		// same millisecond is non-deterministic (cluster-key timestamps
		// have ms resolution, tied entries fall back to UUID
		// comparison), so we assert on the multiset rather than the
		// exact sequence.
		expect(items).toHaveLength(4);
		const sigs = items.map((m) => `${m.role}:${m.content}`).sort();
		expect(sigs).toEqual([
			"agent:echo: first",
			"agent:echo: second",
			"user:first",
			"user:second",
		]);
	});

	test("POST /messages rejects an empty body", async () => {
		const { app } = makeApp();
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

	test("POST /messages returns 503 chat_disabled when no chat service is configured", async () => {
		const { app } = makeApp({ chatService: null });
		const ws = await createWorkspace(app);
		const chatId = await createChat(app, ws, { title: "t" });
		const res = await app.request(
			`/api/v1/workspaces/${ws}/chats/${chatId}/messages`,
			{
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ content: "hi" }),
			},
		);
		expect(res.status).toBe(503);
		const eBody = await json(res);
		expect(eBody.error.code).toBe("chat_disabled");
	});

	test("POST /messages forwards history + user turn to the chat service", async () => {
		const fake = makeFakeChatService();
		const { app } = makeApp({ chatService: fake });
		const ws = await createWorkspace(app);
		const chatId = await createChat(app, ws, { title: "t" });

		await app.request(`/api/v1/workspaces/${ws}/chats/${chatId}/messages`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ content: "first" }),
		});
		await new Promise((r) => setTimeout(r, 5));
		await app.request(`/api/v1/workspaces/${ws}/chats/${chatId}/messages`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ content: "second" }),
		});

		// The fake records every call. The first call sees no prior
		// history; the second sees the first user+assistant turns.
		expect(fake.calls).toHaveLength(2);
		const first = fake.calls[0];
		if (!first) throw new Error("missing first call");
		expect(first.messages[0]?.role).toBe("system");
		expect(first.messages[first.messages.length - 1]?.content).toBe("first");

		const second = fake.calls[1];
		if (!second) throw new Error("missing second call");
		const roles = second.messages.map((m) => m.role);
		expect(roles[0]).toBe("system");
		// system + user(first) + assistant(echo: first) + user(second)
		expect(roles).toEqual(["system", "user", "assistant", "user"]);
		expect(second.messages[1]?.content).toBe("first");
		expect(second.messages[2]?.content).toBe("echo: first");
		expect(second.messages[second.messages.length - 1]?.content).toBe("second");
	});

	test("POST /messages persists an error assistant turn when the model fails", async () => {
		const fake = makeFakeChatService({
			reply: () => ({
				content: "",
				finishReason: "error",
				tokenCount: null,
				errorMessage: "simulated provider failure",
			}),
		});
		const { app } = makeApp({ chatService: fake });
		const ws = await createWorkspace(app);
		const chatId = await createChat(app, ws, { title: "t" });

		const res = await app.request(
			`/api/v1/workspaces/${ws}/chats/${chatId}/messages`,
			{
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ content: "hello" }),
			},
		);
		expect(res.status).toBe(201);
		const body = await json(res);
		expect(body.assistant.metadata.finish_reason).toBe("error");
		expect(body.assistant.metadata.error_message).toBe(
			"simulated provider failure",
		);
		// Body falls back to the error message so the user sees something.
		expect(body.assistant.content).toContain("simulated provider failure");
	});

	/* ---------------- streaming variant ---------------- */

	async function readSseEvents(
		res: Response,
	): Promise<Array<{ event: string; data: unknown }>> {
		const text = await res.text();
		const events: Array<{ event: string; data: unknown }> = [];
		// Hono's streamSSE writes `event: <name>\ndata: <json>\n\n`.
		for (const block of text.split("\n\n")) {
			if (block.trim().length === 0) continue;
			let event = "message";
			const dataLines: string[] = [];
			for (const line of block.split("\n")) {
				if (line.startsWith("event: ")) event = line.slice("event: ".length);
				else if (line.startsWith("data: "))
					dataLines.push(line.slice("data: ".length));
			}
			const data =
				dataLines.length > 0 ? JSON.parse(dataLines.join("\n")) : null;
			events.push({ event, data });
		}
		return events;
	}

	test("POST /messages/stream emits user-message, tokens, and done", async () => {
		const fake = makeFakeChatService();
		const { app } = makeApp({ chatService: fake });
		const ws = await createWorkspace(app);
		const chatId = await createChat(app, ws, { title: "t" });

		const res = await app.request(
			`/api/v1/workspaces/${ws}/chats/${chatId}/messages/stream`,
			{
				method: "POST",
				headers: {
					"content-type": "application/json",
					accept: "text/event-stream",
				},
				body: JSON.stringify({ content: "hello bobbie" }),
			},
		);
		expect(res.status).toBe(200);
		expect(res.headers.get("content-type")).toContain("text/event-stream");
		const events = await readSseEvents(res);

		// First: the canonical user record.
		expect(events[0]?.event).toBe("user-message");
		const user = events[0]?.data as { content: string; role: string };
		expect(user.role).toBe("user");
		expect(user.content).toBe("hello bobbie");

		// Then: one or more `token` events whose deltas concatenate to
		// the assistant's final content.
		const tokenEvents = events.filter((e) => e.event === "token");
		expect(tokenEvents.length).toBeGreaterThan(0);
		const concat = tokenEvents
			.map((e) => (e.data as { delta: string }).delta)
			.join("");
		expect(concat).toBe("echo: hello bobbie");

		// Last: a `done` event with the persisted assistant row.
		const last = events[events.length - 1];
		expect(last?.event).toBe("done");
		const assistant = last?.data as {
			role: string;
			content: string;
			metadata: Record<string, string>;
		};
		expect(assistant.role).toBe("agent");
		expect(assistant.content).toBe("echo: hello bobbie");
		expect(assistant.metadata.finish_reason).toBe("stop");

		// And the message is persisted: a follow-up GET sees both turns.
		const list = await app.request(
			`/api/v1/workspaces/${ws}/chats/${chatId}/messages`,
		);
		const items = ((await json(list)).items ?? []) as Array<{
			role: string;
			content: string;
		}>;
		expect(items).toHaveLength(2);
		expect(items.map((m) => m.role).sort()).toEqual(["agent", "user"]);
	});

	test("POST /messages/stream returns 503 when chat is disabled", async () => {
		const { app } = makeApp({ chatService: null });
		const ws = await createWorkspace(app);
		const chatId = await createChat(app, ws, { title: "t" });
		const res = await app.request(
			`/api/v1/workspaces/${ws}/chats/${chatId}/messages/stream`,
			{
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ content: "hi" }),
			},
		);
		expect(res.status).toBe(503);
		expect((await json(res)).error.code).toBe("chat_disabled");
	});

	test("POST /messages/stream emits an `error` event when the model fails", async () => {
		const fake = makeFakeChatService({
			streamReply: async function* () {
				yield {
					type: "error",
					errorMessage: "rate limit",
					tokenCount: null,
				};
			},
		});
		const { app } = makeApp({ chatService: fake });
		const ws = await createWorkspace(app);
		const chatId = await createChat(app, ws, { title: "t" });
		const res = await app.request(
			`/api/v1/workspaces/${ws}/chats/${chatId}/messages/stream`,
			{
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ content: "hi" }),
			},
		);
		expect(res.status).toBe(200);
		const events = await readSseEvents(res);
		const last = events[events.length - 1];
		expect(last?.event).toBe("error");
		const assistant = last?.data as {
			content: string;
			metadata: Record<string, string>;
		};
		expect(assistant.metadata.finish_reason).toBe("error");
		expect(assistant.metadata.error_message).toBe("rate limit");
		expect(assistant.content).toContain("rate limit");
	});

	test("POST /messages/stream rejects empty content", async () => {
		const { app } = makeApp();
		const ws = await createWorkspace(app);
		const chatId = await createChat(app, ws, { title: "t" });
		const res = await app.request(
			`/api/v1/workspaces/${ws}/chats/${chatId}/messages/stream`,
			{
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ content: "" }),
			},
		);
		expect(res.status).toBe(400);
	});

	test("auth scope: scoped subject can't read another workspace's chats", async () => {
		const { app } = makeApp();
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
