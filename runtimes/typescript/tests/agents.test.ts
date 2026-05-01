/**
 * Route-level coverage for `/api/v1/workspaces/{w}/agents` and the
 * nested per-agent conversation routes. Uses the memory control
 * plane and a mock vector driver. Synchronous send + list message
 * paths ARE covered here; SSE streaming relies on the same dispatcher
 * exercised by `chats.test.ts` so the additional coverage focuses on
 * route-shape consistency.
 */

import { randomUUID } from "node:crypto";
import { describe, expect, test } from "vitest";
import { createApp } from "../src/app.js";
import { AuthResolver } from "../src/auth/resolver.js";
import type { ChatService } from "../src/chat/types.js";
import { DEFAULT_WORKSPACE_AGENTS } from "../src/control-plane/defaults.js";
import { MemoryControlPlaneStore } from "../src/control-plane/memory/store.js";
import { MockVectorStoreDriver } from "../src/drivers/mock/store.js";
import { VectorStoreDriverRegistry } from "../src/drivers/registry.js";
import { EnvSecretProvider } from "../src/secrets/env.js";
import { SecretResolver } from "../src/secrets/provider.js";
import { makeFakeChatService, TEST_CHAT_CONFIG } from "./helpers/chat.js";
import { makeFakeEmbedderFactory } from "./helpers/embedder.js";

// biome-ignore lint/suspicious/noExplicitAny: test helper returns untyped JSON
async function json(res: Response): Promise<any> {
	// biome-ignore lint/suspicious/noExplicitAny: test helper returns untyped JSON
	return (await res.json()) as any;
}

interface MakeAppOptions {
	readonly chatService?: ChatService | null;
}

function makeApp(opts: MakeAppOptions = {}): ReturnType<typeof createApp> {
	return makeAppAndStore(opts).app;
}

/**
 * Variant that also returns the underlying store so tests can seed
 * scaffolding turns directly (tool-result rows, pre-tool-call
 * placeholders) without driving the full dispatch loop.
 */
function makeAppAndStore(opts: MakeAppOptions = {}): {
	app: ReturnType<typeof createApp>;
	store: MemoryControlPlaneStore;
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
	const chatService = opts.chatService === undefined ? null : opts.chatService;
	const app = createApp({
		store,
		drivers,
		secrets,
		auth,
		embedders,
		chatService,
		chatConfig: chatService ? TEST_CHAT_CONFIG : null,
	});
	return { app, store };
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
	test("workspace POST auto-seeds the default Bobby + Heidi agents", async () => {
		const app = makeApp();
		const ws = await createWorkspace(app);

		const list = await app.request(`/api/v1/workspaces/${ws}/agents`);
		expect(list.status).toBe(200);
		const items = (await json(list)).items as Array<{
			name: string;
			description: string | null;
			systemPrompt: string | null;
			llmServiceId: string | null;
		}>;

		expect(items.length).toBe(DEFAULT_WORKSPACE_AGENTS.length);
		const names = items.map((a) => a.name).sort();
		expect(names).toEqual(["Bobby", "Heidi"]);

		// Both agents are wired to the auto-seeded OpenAI chat LLM
		// service so the tool-call loop has a function-calling-capable
		// model out of the box. Confirm they share that same id, and
		// that the id does point at a real LLM service in the workspace.
		const llmIds = new Set(items.map((a) => a.llmServiceId));
		expect(llmIds.size).toBe(1);
		const sharedLlmId = items[0]?.llmServiceId;
		expect(sharedLlmId).toMatch(/^[0-9a-f-]{36}$/);
		const llmList = await app.request(`/api/v1/workspaces/${ws}/llm-services`);
		expect(llmList.status).toBe(200);
		const llmItems = (await json(llmList)).items as Array<{
			llmServiceId: string;
			provider: string;
			modelName: string;
		}>;
		expect(llmItems.find((s) => s.llmServiceId === sharedLlmId)).toMatchObject({
			provider: "openai",
			modelName: "gpt-4o-mini",
		});

		for (const item of items) {
			expect(item.description).toBeTruthy();
			expect(item.systemPrompt).toBeTruthy();
		}
	});

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
		// Workspaces auto-seed DEFAULT_WORKSPACE_AGENTS on POST, so the
		// list contains those defaults plus the agent we just created.
		expect(lBody.items.length).toBe(DEFAULT_WORKSPACE_AGENTS.length + 1);
		const ids = lBody.items.map((a: { agentId: string }) => a.agentId);
		expect(ids).toContain(created.agentId);

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

describe("agent conversation message routes", () => {
	async function createConversation(
		app: AppHandle,
		workspaceId: string,
		agentId: string,
		body: Record<string, unknown> = {},
	): Promise<string> {
		const res = await app.request(
			`/api/v1/workspaces/${workspaceId}/agents/${agentId}/conversations`,
			{
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify(body),
			},
		);
		expect(res.status, await res.clone().text()).toBe(201);
		return (await json(res)).conversationId as string;
	}

	test("GET messages returns an empty page initially", async () => {
		const app = makeApp({ chatService: makeFakeChatService() });
		const ws = await createWorkspace(app);
		const aid = await createAgent(app, ws);
		const cid = await createConversation(app, ws, aid, { title: "fresh" });

		const res = await app.request(
			`/api/v1/workspaces/${ws}/agents/${aid}/conversations/${cid}/messages`,
		);
		expect(res.status).toBe(200);
		const body = await json(res);
		expect(body.items).toEqual([]);
	});

	test("GET messages hides tool-result rows and pre-tool-call placeholders from the wire", async () => {
		// Regression: when an agent uses tools, the dispatcher persists
		// (1) an `agent` turn with empty content + finish_reason
		// "tool_calls" (the model's pre-tool-call placeholder), then
		// (2) one or more `tool` rows with the result payload, then
		// (3) the final `agent` turn with the actual answer. Surfacing
		// (1) and (2) to the UI shows up as blank "agent" speech bubbles
		// when the user reloads the conversation.
		const { app, store } = makeAppAndStore({
			chatService: makeFakeChatService(),
		});
		const ws = await createWorkspace(app);
		const aid = await createAgent(app, ws);
		const cid = await createConversation(app, ws, aid, { title: "trace" });

		// Seed a realistic tool-using exchange directly into the store.
		await store.appendChatMessage(ws, cid, {
			role: "user",
			content: "show me 4 rows",
			messageTs: "2026-05-01T00:00:00.001Z",
		});
		await store.appendChatMessage(ws, cid, {
			role: "agent",
			authorId: aid,
			content: "",
			tokenCount: 100,
			messageTs: "2026-05-01T00:00:00.002Z",
			toolCallPayload: { toolCalls: [{ id: "c1", name: "list_chunks" }] },
			metadata: { model: "fake", finish_reason: "tool_calls" },
		});
		await store.appendChatMessage(ws, cid, {
			role: "tool",
			toolId: "list_chunks",
			messageTs: "2026-05-01T00:00:00.003Z",
			toolResponse: { content: "{...}", toolCallId: "c1" },
		});
		await store.appendChatMessage(ws, cid, {
			role: "agent",
			authorId: aid,
			content: "Here are the 4 rows…",
			tokenCount: 250,
			messageTs: "2026-05-01T00:00:00.004Z",
			metadata: { model: "fake", finish_reason: "stop" },
		});

		const res = await app.request(
			`/api/v1/workspaces/${ws}/agents/${aid}/conversations/${cid}/messages`,
		);
		expect(res.status).toBe(200);
		const body = await json(res);
		// Only the user turn + the final agent answer should reach the
		// wire. Two scaffolding rows (placeholder + tool result) hidden.
		expect(body.items).toHaveLength(2);
		expect(body.items[0]).toMatchObject({
			role: "user",
			content: "show me 4 rows",
		});
		expect(body.items[1]).toMatchObject({
			role: "agent",
			content: "Here are the 4 rows…",
		});
		// Defensive: nothing in the visible page should be a blank bubble.
		for (const item of body.items as Array<{
			role: string;
			content: string | null;
		}>) {
			expect(item.content).not.toBe("");
			expect(item.content).not.toBeNull();
		}
	});

	test("POST /messages 503s when no chat service AND agent has no llmServiceId", async () => {
		const app = makeApp({ chatService: null });
		const ws = await createWorkspace(app);
		const aid = await createAgent(app, ws);
		const cid = await createConversation(app, ws, aid, { title: "no exec" });

		const res = await app.request(
			`/api/v1/workspaces/${ws}/agents/${aid}/conversations/${cid}/messages`,
			{
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ content: "hi" }),
			},
		);
		expect(res.status).toBe(503);
		const body = await json(res);
		expect(body.error.code).toBe("chat_disabled");
	});

	test("message routes 404 when conversation belongs to a different agent", async () => {
		const app = makeApp({ chatService: makeFakeChatService() });
		const ws = await createWorkspace(app);
		const ownerAgent = await createAgent(app, ws, { name: "owner" });
		const otherAgent = await createAgent(app, ws, { name: "other" });
		const cid = await createConversation(app, ws, ownerAgent, {
			title: "owned-by-owner",
		});

		// GET should 404 when accessed via the wrong agent.
		const list = await app.request(
			`/api/v1/workspaces/${ws}/agents/${otherAgent}/conversations/${cid}/messages`,
		);
		expect(list.status).toBe(404);

		// POST should 404 too — even though the chat service is wired,
		// the agent/conversation pair doesn't match.
		const send = await app.request(
			`/api/v1/workspaces/${ws}/agents/${otherAgent}/conversations/${cid}/messages`,
			{
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ content: "wrong owner" }),
			},
		);
		expect(send.status).toBe(404);
	});

	test("POST /messages returns 422 when agent points at a non-huggingface llm service", async () => {
		const app = makeApp({ chatService: makeFakeChatService() });
		const ws = await createWorkspace(app);

		// Create an LLM service with provider="mock" — only "huggingface"
		// is wired in this runtime today, so the dispatcher should reject
		// the request before calling any model.
		const svcRes = await app.request(`/api/v1/workspaces/${ws}/llm-services`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				name: "mock-llm",
				provider: "mock",
				modelName: "mock-model",
			}),
		});
		expect(svcRes.status, await svcRes.clone().text()).toBe(201);
		const llmServiceId = (await json(svcRes)).llmServiceId as string;

		// Bind that service to a fresh agent so the dispatcher pulls it
		// from the agent record at send time.
		const aid = await createAgent(app, ws, {
			name: "with-mock-llm",
			llmServiceId,
		});
		const cid = await createConversation(app, ws, aid, { title: "t" });

		const res = await app.request(
			`/api/v1/workspaces/${ws}/agents/${aid}/conversations/${cid}/messages`,
			{
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ content: "trigger provider gate" }),
			},
		);
		expect(res.status).toBe(422);
		const body = await json(res);
		expect(body.error.code).toBe("llm_provider_unsupported");
	});

	test("POST /messages/stream emits a typed `stream-error` event for in-stream failures", async () => {
		// Same setup as the sync 422 test above, but hit the streaming
		// route so the error surfaces inside `streamSSE` after headers
		// are flushed. The route can no longer return a JSON envelope at
		// that point, so the regression check is that we emit a
		// `stream-error` SSE event whose payload mirrors the global
		// `onError` mapping in app.ts.
		const app = makeApp({ chatService: makeFakeChatService() });
		const ws = await createWorkspace(app);

		const svcRes = await app.request(`/api/v1/workspaces/${ws}/llm-services`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				name: "mock-llm",
				provider: "mock",
				modelName: "mock-model",
			}),
		});
		expect(svcRes.status, await svcRes.clone().text()).toBe(201);
		const llmServiceId = (await json(svcRes)).llmServiceId as string;

		const aid = await createAgent(app, ws, {
			name: "with-mock-llm",
			llmServiceId,
		});
		const cid = await createConversation(app, ws, aid, { title: "stream" });

		const res = await app.request(
			`/api/v1/workspaces/${ws}/agents/${aid}/conversations/${cid}/messages/stream`,
			{
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ content: "trigger provider gate" }),
			},
		);
		// Headers were flushed before the failure point, so the response
		// itself is 200 with text/event-stream — the typed error rides
		// inside the stream.
		expect(res.status).toBe(200);
		expect(res.headers.get("content-type")).toMatch(/text\/event-stream/);
		const body = await res.text();
		expect(body).toContain("event: stream-error");
		const dataLine = body.split("\n").find((line) => line.startsWith("data: "));
		expect(dataLine).toBeDefined();
		const payload = JSON.parse(
			(dataLine ?? "data: {}").slice("data: ".length),
		) as { code: string; status: number; message: string };
		expect(payload.code).toBe("llm_provider_unsupported");
		expect(payload.status).toBe(422);
		expect(payload.message).toContain("provider 'mock'");
	});
});
