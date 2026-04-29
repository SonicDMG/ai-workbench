/**
 * MCP server façade tests.
 *
 * Two layers:
 *   1. Tool-handler unit tests — hook the server up to an
 *      `InMemoryTransport` linked-pair so we can call tools via the
 *      SDK `Client` without going through HTTP. Fast, deterministic,
 *      covers every tool's contract.
 *   2. Route integration — hit `/api/v1/workspaces/{w}/mcp` via
 *      `app.request` to verify auth, workspace 404, and the
 *      `mcp.enabled: false` gate.
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, test } from "vitest";
import { createApp } from "../src/app.js";
import { AuthResolver } from "../src/auth/resolver.js";
import { MemoryControlPlaneStore } from "../src/control-plane/memory/store.js";
import { MockVectorStoreDriver } from "../src/drivers/mock/store.js";
import { VectorStoreDriverRegistry } from "../src/drivers/registry.js";
import { buildMcpServer } from "../src/mcp/server.js";
import { EnvSecretProvider } from "../src/secrets/env.js";
import { SecretResolver } from "../src/secrets/provider.js";
import {
	type FakeChatService,
	makeFakeChatService,
	TEST_CHAT_CONFIG,
} from "./helpers/chat.js";
import { makeFakeEmbedderFactory } from "./helpers/embedder.js";

interface McpHarness {
	readonly client: Client;
	readonly store: MemoryControlPlaneStore;
	readonly chatService: FakeChatService;
	readonly workspaceId: string;
	readonly cleanup: () => Promise<void>;
}

async function makeMcpHarness(opts?: {
	exposeChat?: boolean;
}): Promise<McpHarness> {
	const store = new MemoryControlPlaneStore();
	const driver = new MockVectorStoreDriver();
	const drivers = new VectorStoreDriverRegistry(new Map([["mock", driver]]));
	const embedders = makeFakeEmbedderFactory();
	const chatService = makeFakeChatService();

	const ws = await store.createWorkspace({ name: "ws", kind: "mock" });

	const server = buildMcpServer(ws.uid, {
		store,
		drivers,
		embedders,
		chatService,
		chatConfig: TEST_CHAT_CONFIG,
		exposeChat: opts?.exposeChat ?? false,
	});

	const [serverTransport, clientTransport] =
		InMemoryTransport.createLinkedPair();
	const client = new Client({ name: "test-client", version: "0" });
	await Promise.all([
		server.connect(serverTransport),
		client.connect(clientTransport),
	]);

	return {
		client,
		store,
		chatService,
		workspaceId: ws.uid,
		cleanup: async () => {
			await client.close();
			await server.close();
		},
	};
}

function textContent(result: {
	content: Array<{ type: string; text?: string }>;
}): string {
	const item = result.content.find((c) => c.type === "text");
	if (!item?.text) throw new Error("expected a text content item");
	return item.text;
}

describe("MCP server tools", () => {
	test("tools/list returns the read-only tools", async () => {
		const h = await makeMcpHarness();
		try {
			const { tools } = await h.client.listTools();
			const names = tools.map((t) => t.name).sort();
			expect(names).toEqual([
				"list_chat_messages",
				"list_chats",
				"list_documents",
				"list_knowledge_bases",
				"search_kb",
			]);
			// chat_send is gated.
			expect(names).not.toContain("chat_send");
		} finally {
			await h.cleanup();
		}
	});

	test("chat_send is registered when exposeChat is on", async () => {
		const h = await makeMcpHarness({ exposeChat: true });
		try {
			const { tools } = await h.client.listTools();
			expect(tools.map((t) => t.name)).toContain("chat_send");
		} finally {
			await h.cleanup();
		}
	});

	test("list_knowledge_bases returns workspace KBs", async () => {
		const h = await makeMcpHarness();
		try {
			const chunk = await h.store.createChunkingService(h.workspaceId, {
				name: "c",
				engine: "fixed",
			});
			const embed = await h.store.createEmbeddingService(h.workspaceId, {
				name: "e",
				provider: "fake",
				modelName: "m",
				embeddingDimension: 4,
			});
			const kb = await h.store.createKnowledgeBase(h.workspaceId, {
				name: "Docs",
				chunkingServiceId: chunk.chunkingServiceId,
				embeddingServiceId: embed.embeddingServiceId,
			});
			const result = await h.client.callTool({
				name: "list_knowledge_bases",
				arguments: {},
			});
			const payload = JSON.parse(textContent(result as never)) as Array<{
				knowledgeBaseId: string;
				name: string;
			}>;
			expect(payload).toHaveLength(1);
			expect(payload[0]?.knowledgeBaseId).toBe(kb.knowledgeBaseId);
			expect(payload[0]?.name).toBe("Docs");
		} finally {
			await h.cleanup();
		}
	});

	test("list_chats returns Bobbie chats", async () => {
		const h = await makeMcpHarness();
		try {
			const chat = await h.store.createChat(h.workspaceId, {
				title: "first",
			});
			const result = await h.client.callTool({
				name: "list_chats",
				arguments: {},
			});
			const payload = JSON.parse(textContent(result as never)) as Array<{
				chatId: string;
				title: string;
			}>;
			expect(payload).toHaveLength(1);
			expect(payload[0]?.chatId).toBe(chat.conversationId);
			expect(payload[0]?.title).toBe("first");
		} finally {
			await h.cleanup();
		}
	});

	test("list_chat_messages returns the chat's history", async () => {
		const h = await makeMcpHarness();
		try {
			const chat = await h.store.createChat(h.workspaceId, { title: "t" });
			await h.store.appendChatMessage(h.workspaceId, chat.conversationId, {
				role: "user",
				content: "hi",
			});
			// Wait a millisecond so the cluster-key ordering is
			// unambiguous (sub-ms timestamps tiebreak by random UUID,
			// which makes ordered assertions flaky).
			await new Promise((r) => setTimeout(r, 5));
			await h.store.appendChatMessage(h.workspaceId, chat.conversationId, {
				role: "agent",
				content: "hi back",
				metadata: { model: "m", finish_reason: "stop" },
			});
			const result = await h.client.callTool({
				name: "list_chat_messages",
				arguments: { chatId: chat.conversationId },
			});
			const payload = JSON.parse(textContent(result as never)) as Array<{
				role: string;
				content: string;
			}>;
			expect(payload.map((m) => `${m.role}:${m.content}`)).toEqual([
				"user:hi",
				"agent:hi back",
			]);
		} finally {
			await h.cleanup();
		}
	});

	test("search_kb requires text or vector", async () => {
		const h = await makeMcpHarness();
		try {
			const result = (await h.client.callTool({
				name: "search_kb",
				arguments: {
					knowledgeBaseId: "11111111-2222-4333-8444-555555555555",
				},
			})) as { isError?: boolean; content: Array<{ text?: string }> };
			expect(result.isError).toBe(true);
			expect(result.content[0]?.text).toContain("text");
		} finally {
			await h.cleanup();
		}
	});

	test("chat_send (when exposed) persists and returns the assistant text", async () => {
		const h = await makeMcpHarness({ exposeChat: true });
		try {
			const chat = await h.store.createChat(h.workspaceId, { title: "t" });
			const result = await h.client.callTool({
				name: "chat_send",
				arguments: { chatId: chat.conversationId, content: "hi" },
			});
			const reply = textContent(result as never);
			expect(reply).toBe("echo: hi");
			expect(h.chatService.calls).toHaveLength(1);
			const messages = await h.store.listChatMessages(
				h.workspaceId,
				chat.conversationId,
			);
			expect(messages).toHaveLength(2);
			expect(messages[0]?.content).toBe("hi");
			expect(messages[1]?.content).toBe("echo: hi");
		} finally {
			await h.cleanup();
		}
	});
});

describe("MCP HTTP route", () => {
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

	test("returns 404 when mcp.enabled is false", async () => {
		const { app, store } = makeApp({ mcpEnabled: false });
		const ws = await store.createWorkspace({ name: "ws", kind: "mock" });
		const res = await app.request(`/api/v1/workspaces/${ws.uid}/mcp`, {
			method: "POST",
			headers: {
				"content-type": "application/json",
				accept: "application/json, text/event-stream",
			},
			body: JSON.stringify({
				jsonrpc: "2.0",
				id: 1,
				method: "tools/list",
			}),
		});
		expect(res.status).toBe(404);
		const body = (await res.json()) as { error: { code: string } };
		expect(body.error.code).toBe("not_found");
	});

	test("returns 404 for unknown workspace when enabled", async () => {
		const { app } = makeApp({ mcpEnabled: true });
		const res = await app.request(
			"/api/v1/workspaces/99999999-9999-4999-8999-999999999999/mcp",
			{
				method: "POST",
				headers: {
					"content-type": "application/json",
					accept: "application/json, text/event-stream",
				},
				body: JSON.stringify({
					jsonrpc: "2.0",
					id: 1,
					method: "tools/list",
				}),
			},
		);
		expect(res.status).toBe(404);
		const body = (await res.json()) as { error: { code: string } };
		expect(body.error.code).toBe("workspace_not_found");
	});

	test("answers a JSON-RPC tools/list when enabled", async () => {
		const { app, store } = makeApp({ mcpEnabled: true });
		const ws = await store.createWorkspace({ name: "ws", kind: "mock" });
		const res = await app.request(`/api/v1/workspaces/${ws.uid}/mcp`, {
			method: "POST",
			headers: {
				"content-type": "application/json",
				accept: "application/json, text/event-stream",
			},
			body: JSON.stringify({
				jsonrpc: "2.0",
				id: 1,
				method: "initialize",
				params: {
					protocolVersion: "2025-06-18",
					capabilities: {},
					clientInfo: { name: "test", version: "0" },
				},
			}),
		});
		// Initialize succeeds — body shape is implementation-defined,
		// but the route is reachable and the transport is wired.
		expect(res.status).toBe(200);
	});

	/**
	 * Regression test for the empty-body SSE bug.
	 *
	 * Before the TransformStream fix, `handleMcpRequest` called
	 * `transport.close()` in a `finally` block that ran synchronously
	 * after `transport.handleRequest()` returned the Response shell.
	 * Closing the transport destroyed every open stream controller
	 * before the SDK had a chance to async-write the JSON-RPC reply,
	 * yielding an empty body on the wire.
	 *
	 * The fix wraps the response body in a passthrough TransformStream
	 * and defers `transport.close()` to the stream's `flush` callback,
	 * which fires only after all bytes have been piped through.
	 *
	 * This test hits the HTTP route end-to-end, drains the SSE body,
	 * and asserts a non-empty JSON-RPC tools/list result. It would
	 * have caught the bug (body would have been empty before the fix).
	 */
	test("body is non-empty and contains a tools/list result (SSE regression)", async () => {
		const { app, store } = makeApp({ mcpEnabled: true });
		const ws = await store.createWorkspace({ name: "ws", kind: "mock" });
		const res = await app.request(`/api/v1/workspaces/${ws.uid}/mcp`, {
			method: "POST",
			headers: {
				"content-type": "application/json",
				accept: "application/json, text/event-stream",
			},
			body: JSON.stringify({
				jsonrpc: "2.0",
				id: 1,
				method: "tools/list",
			}),
		});
		expect(res.status).toBe(200);

		// Drain the full body — an empty body would throw here or
		// produce an empty string, which the assertions below catch.
		const raw = await res.text();
		expect(raw.length).toBeGreaterThan(0);

		// Parse the first `data:` line from the SSE stream.
		const dataLine = raw
			.split(/\r?\n/)
			.map((l) => l.trim())
			.find((l) => l.startsWith("data:"));
		if (!dataLine) throw new Error("expected SSE data line in response");

		const rpc = JSON.parse(dataLine.slice("data:".length).trim()) as {
			result?: { tools: Array<{ name: string }> };
		};
		expect(rpc.result).toBeDefined();
		expect(Array.isArray(rpc.result?.tools)).toBe(true);
		expect(rpc.result?.tools.length).toBeGreaterThan(0);
		const toolNames = rpc.result?.tools.map((t) => t.name).sort();
		expect(toolNames).toContain("list_knowledge_bases");
	});
});
