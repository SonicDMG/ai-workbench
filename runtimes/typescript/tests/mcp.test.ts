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
import { IngestSemaphore } from "../src/jobs/ingest-semaphore.js";
import { MemoryJobStore } from "../src/jobs/memory-store.js";
import { buildMcpServer } from "../src/mcp/server.js";
import { resolveKb } from "../src/routes/api-v1/kb-descriptor.js";
import { EnvSecretProvider } from "../src/secrets/env.js";
import { SecretResolver } from "../src/secrets/provider.js";
import { createIngestService } from "../src/services/ingest-service.js";
import {
	type FakeChatService,
	makeFakeChatService,
	TEST_CHAT_CONFIG,
} from "./helpers/chat.js";
import { makeFakeEmbedderFactory } from "./helpers/embedder.js";

interface McpHarness {
	readonly client: Client;
	readonly store: MemoryControlPlaneStore;
	readonly driver: MockVectorStoreDriver;
	readonly chatService: FakeChatService;
	readonly workspaceId: string;
	readonly cleanup: () => Promise<void>;
}

async function makeMcpHarness(opts?: {
	exposeChat?: boolean;
	/**
	 * Wire a real ingest service so `ingest_text` is registered. When
	 * false (default), pass `null` and the write tool is absent from
	 * `tools/list` — the existing read-only test still passes.
	 */
	withIngest?: boolean;
	/**
	 * Scope set to project onto the in-process MCP server. `undefined`
	 * defaults to `null` (no scope gate — legacy / pre-scopes
	 * behavior); pass `["read"]` to model a read-only API-key caller
	 * for the new write-tool gate tests.
	 */
	subjectScopes?: readonly string[] | null;
}): Promise<McpHarness> {
	const store = new MemoryControlPlaneStore();
	const driver = new MockVectorStoreDriver();
	const drivers = new VectorStoreDriverRegistry(new Map([["mock", driver]]));
	const embedders = makeFakeEmbedderFactory();
	const chatService = makeFakeChatService();

	const ws = await store.createWorkspace({ name: "ws", kind: "mock" });

	const ingestService = opts?.withIngest
		? createIngestService({
				store,
				drivers,
				embedders,
				jobs: new MemoryJobStore(),
				replicaId: "test",
				ingestSemaphore: new IngestSemaphore(4),
			})
		: null;

	const server = buildMcpServer(ws.uid, {
		store,
		drivers,
		embedders,
		chatService,
		chatConfig: TEST_CHAT_CONFIG,
		exposeChat: opts?.exposeChat ?? false,
		ingestService,
		subjectScopes: opts?.subjectScopes ?? null,
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
		driver,
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

/**
 * Create a KB plus its three bound services AND provision the
 * underlying mock collection — the same chain the HTTP
 * `POST /knowledge-bases` route runs.
 *
 * Direct `store.createKnowledgeBase` calls (used by the read-tool
 * tests above) only patch the control plane; ingest needs the data
 * plane to exist too. Factored out so the three ingest tests below
 * read top-down without redoing the chain inline.
 */
async function makeKbForIngest(
	store: MemoryControlPlaneStore,
	driver: MockVectorStoreDriver,
	workspaceId: string,
): Promise<{ knowledgeBaseId: string }> {
	const chunk = await store.createChunkingService(workspaceId, {
		name: "c",
		engine: "langchain_ts",
	});
	const embed = await store.createEmbeddingService(workspaceId, {
		name: "e",
		provider: "fake",
		modelName: "m",
		embeddingDimension: 4,
	});
	const kb = await store.createKnowledgeBase(workspaceId, {
		name: "Docs",
		chunkingServiceId: chunk.chunkingServiceId,
		embeddingServiceId: embed.embeddingServiceId,
	});
	// Mirror the `KnowledgeBaseService.create` provisioning step so
	// the data plane has a collection to upsert into. Use the same
	// `resolveKb` helper the runtime calls — keeps the descriptor
	// shape in lockstep with production.
	const resolved = await resolveKb(store, workspaceId, kb.knowledgeBaseId);
	await driver.createCollection({
		workspace: resolved.workspace,
		descriptor: resolved.descriptor,
	});
	return { knowledgeBaseId: kb.knowledgeBaseId };
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

	test("list_chats returns the agent's conversations", async () => {
		const h = await makeMcpHarness();
		try {
			const agent = await h.store.createAgent(h.workspaceId, {
				name: "Helper",
			});
			const chat = await h.store.createConversation(
				h.workspaceId,
				agent.agentId,
				{ title: "first" },
			);
			const result = await h.client.callTool({
				name: "list_chats",
				arguments: { agentId: agent.agentId },
			});
			const payload = JSON.parse(textContent(result as never)) as Array<{
				chatId: string;
				agentId: string;
				title: string;
			}>;
			expect(payload).toHaveLength(1);
			expect(payload[0]?.chatId).toBe(chat.conversationId);
			expect(payload[0]?.agentId).toBe(agent.agentId);
			expect(payload[0]?.title).toBe("first");
		} finally {
			await h.cleanup();
		}
	});

	test("list_chat_messages returns the conversation's history", async () => {
		const h = await makeMcpHarness();
		try {
			const agent = await h.store.createAgent(h.workspaceId, {
				name: "Helper",
			});
			const chat = await h.store.createConversation(
				h.workspaceId,
				agent.agentId,
				{ title: "t" },
			);
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

	test("ingest_text is registered only when ingestService is provided", async () => {
		const off = await makeMcpHarness();
		try {
			const names = (await off.client.listTools()).tools.map((t) => t.name);
			expect(names).not.toContain("ingest_text");
		} finally {
			await off.cleanup();
		}

		const on = await makeMcpHarness({ withIngest: true });
		try {
			const names = (await on.client.listTools()).tools.map((t) => t.name);
			expect(names).toContain("ingest_text");
		} finally {
			await on.cleanup();
		}
	});

	test("ingest_text appends a document and returns the completed outcome", async () => {
		const h = await makeMcpHarness({ withIngest: true });
		try {
			const { knowledgeBaseId } = await makeKbForIngest(
				h.store,
				h.driver,
				h.workspaceId,
			);

			const result = await h.client.callTool({
				name: "ingest_text",
				arguments: {
					knowledgeBaseId,
					text: "MCP-ingested doc body — should round-trip through the chunker.",
					sourceFilename: "from-mcp.txt",
					metadata: { source: "mcp-test" },
				},
			});
			const payload = JSON.parse(textContent(result as never)) as {
				outcome: string;
				documentId: string;
				chunks: number;
				sourceFilename: string | null;
				contentHash: string;
			};
			expect(payload.outcome).toBe("completed");
			expect(typeof payload.documentId).toBe("string");
			expect(payload.documentId).toMatch(/[0-9a-f-]{36}/);
			expect(payload.sourceFilename).toBe("from-mcp.txt");
			expect(payload.chunks).toBeGreaterThan(0);
			expect(typeof payload.contentHash).toBe("string");

			// The document should be visible via the existing read tool.
			const docs = JSON.parse(
				textContent(
					(await h.client.callTool({
						name: "list_documents",
						arguments: { knowledgeBaseId },
					})) as never,
				),
			) as Array<{ documentId: string; status: string }>;
			expect(docs).toHaveLength(1);
			expect(docs[0]?.documentId).toBe(payload.documentId);
			expect(docs[0]?.status).toBe("ready");
		} finally {
			await h.cleanup();
		}
	});

	test("ingest_text short-circuits on identical content (duplicate outcome)", async () => {
		const h = await makeMcpHarness({ withIngest: true });
		try {
			const { knowledgeBaseId } = await makeKbForIngest(
				h.store,
				h.driver,
				h.workspaceId,
			);

			const args = {
				knowledgeBaseId,
				text: "identical content — second call must dedup",
			};
			const first = JSON.parse(
				textContent(
					(await h.client.callTool({
						name: "ingest_text",
						arguments: args,
					})) as never,
				),
			) as { outcome: string; documentId: string };
			const second = JSON.parse(
				textContent(
					(await h.client.callTool({
						name: "ingest_text",
						arguments: args,
					})) as never,
				),
			) as { outcome: string; documentId: string };
			expect(first.outcome).toBe("completed");
			expect(second.outcome).toBe("duplicate");
			expect(second.documentId).toBe(first.documentId);
		} finally {
			await h.cleanup();
		}
	});

	test("ingest_text signals name_conflict for a different body under the same filename", async () => {
		const h = await makeMcpHarness({ withIngest: true });
		try {
			const { knowledgeBaseId } = await makeKbForIngest(
				h.store,
				h.driver,
				h.workspaceId,
			);

			await h.client.callTool({
				name: "ingest_text",
				arguments: {
					knowledgeBaseId,
					text: "v1",
					sourceFilename: "policy.md",
				},
			});
			const second = (await h.client.callTool({
				name: "ingest_text",
				arguments: {
					knowledgeBaseId,
					text: "v2 different bytes",
					sourceFilename: "policy.md",
				},
			})) as { isError?: boolean; content: Array<{ text?: string }> };
			expect(second.isError).toBe(true);
			const payload = JSON.parse(second.content[0]?.text ?? "{}") as {
				outcome: string;
			};
			expect(payload.outcome).toBe("name_conflict");
		} finally {
			await h.cleanup();
		}
	});

	test("delete_document is co-gated with ingest_text on the ingest service", async () => {
		const off = await makeMcpHarness();
		try {
			const names = (await off.client.listTools()).tools.map((t) => t.name);
			expect(names).not.toContain("delete_document");
		} finally {
			await off.cleanup();
		}

		const on = await makeMcpHarness({ withIngest: true });
		try {
			const names = (await on.client.listTools()).tools.map((t) => t.name);
			expect(names).toContain("delete_document");
		} finally {
			await on.cleanup();
		}
	});

	test("delete_document removes a previously-ingested document and cascades chunks", async () => {
		const h = await makeMcpHarness({ withIngest: true });
		try {
			const { knowledgeBaseId } = await makeKbForIngest(
				h.store,
				h.driver,
				h.workspaceId,
			);

			// Ingest first so there's something to delete.
			const created = JSON.parse(
				textContent(
					(await h.client.callTool({
						name: "ingest_text",
						arguments: {
							knowledgeBaseId,
							text: "doc to be deleted",
							sourceFilename: "tmp.txt",
						},
					})) as never,
				),
			) as { documentId: string; chunks: number };

			const result = (await h.client.callTool({
				name: "delete_document",
				arguments: {
					knowledgeBaseId,
					documentId: created.documentId,
				},
			})) as { isError?: boolean; content: Array<{ text?: string }> };

			expect(result.isError).toBeFalsy();
			const payload = JSON.parse(result.content[0]?.text ?? "{}") as {
				outcome: string;
				documentId: string;
				chunksDropped: number | null;
			};
			expect(payload.outcome).toBe("deleted");
			expect(payload.documentId).toBe(created.documentId);
			// Mock driver implements `deleteRecords`, so we expect a
			// number rather than null. The exact value equals the chunk
			// count from the prior ingest.
			expect(payload.chunksDropped).toBe(created.chunks);

			// list_documents now shows an empty KB.
			const docs = JSON.parse(
				textContent(
					(await h.client.callTool({
						name: "list_documents",
						arguments: { knowledgeBaseId },
					})) as never,
				),
			) as Array<unknown>;
			expect(docs).toHaveLength(0);
		} finally {
			await h.cleanup();
		}
	});

	test("delete_document is idempotent — re-deleting reports not_found, not isError", async () => {
		const h = await makeMcpHarness({ withIngest: true });
		try {
			const { knowledgeBaseId } = await makeKbForIngest(
				h.store,
				h.driver,
				h.workspaceId,
			);

			const created = JSON.parse(
				textContent(
					(await h.client.callTool({
						name: "ingest_text",
						arguments: {
							knowledgeBaseId,
							text: "ephemeral",
						},
					})) as never,
				),
			) as { documentId: string };

			// First delete succeeds.
			await h.client.callTool({
				name: "delete_document",
				arguments: { knowledgeBaseId, documentId: created.documentId },
			});
			// Second delete returns not_found (without isError) so an
			// agent doing speculative cleanup doesn't have to branch.
			const second = (await h.client.callTool({
				name: "delete_document",
				arguments: { knowledgeBaseId, documentId: created.documentId },
			})) as { isError?: boolean; content: Array<{ text?: string }> };
			expect(second.isError).toBeFalsy();
			const payload = JSON.parse(second.content[0]?.text ?? "{}") as {
				outcome: string;
				documentId: string;
			};
			expect(payload.outcome).toBe("not_found");
			expect(payload.documentId).toBe(created.documentId);
		} finally {
			await h.cleanup();
		}
	});

	test("ingest_text refuses when caller is missing the `write` scope", async () => {
		const h = await makeMcpHarness({
			withIngest: true,
			subjectScopes: ["read"],
		});
		try {
			// No KB needs to exist: the scope gate fires BEFORE the
			// pipeline touches the store, so the tool can refuse a
			// caller using a read-only key even on a fresh workspace.
			const result = (await h.client.callTool({
				name: "ingest_text",
				arguments: {
					knowledgeBaseId: "11111111-2222-4333-8444-555555555555",
					text: "should never persist",
				},
			})) as { isError?: boolean; content: Array<{ text?: string }> };
			expect(result.isError).toBe(true);
			const payload = JSON.parse(result.content[0]?.text ?? "{}") as {
				outcome: string;
				code: string;
				required: string;
				subjectScopes: readonly string[];
			};
			expect(payload.outcome).toBe("denied");
			expect(payload.code).toBe("scope_required");
			expect(payload.required).toBe("write");
			expect(payload.subjectScopes).toEqual(["read"]);
		} finally {
			await h.cleanup();
		}
	});

	test("delete_document refuses when caller is missing the `write` scope", async () => {
		const h = await makeMcpHarness({
			withIngest: true,
			subjectScopes: ["read"],
		});
		try {
			const result = (await h.client.callTool({
				name: "delete_document",
				arguments: {
					knowledgeBaseId: "11111111-2222-4333-8444-555555555555",
					documentId: "11111111-2222-4333-8444-666666666666",
				},
			})) as { isError?: boolean; content: Array<{ text?: string }> };
			expect(result.isError).toBe(true);
			const payload = JSON.parse(result.content[0]?.text ?? "{}") as {
				outcome: string;
				code: string;
				required: string;
			};
			expect(payload.outcome).toBe("denied");
			expect(payload.code).toBe("scope_required");
			expect(payload.required).toBe("write");
		} finally {
			await h.cleanup();
		}
	});

	test("ingest_text passes when the caller carries the `write` scope", async () => {
		const h = await makeMcpHarness({
			withIngest: true,
			subjectScopes: ["read", "write"],
		});
		try {
			const { knowledgeBaseId } = await makeKbForIngest(
				h.store,
				h.driver,
				h.workspaceId,
			);
			const result = await h.client.callTool({
				name: "ingest_text",
				arguments: { knowledgeBaseId, text: "explicit write scope" },
			});
			const payload = JSON.parse(textContent(result as never)) as {
				outcome: string;
				documentId: string;
			};
			expect(payload.outcome).toBe("completed");
			expect(typeof payload.documentId).toBe("string");
		} finally {
			await h.cleanup();
		}
	});

	test("null subjectScopes (OIDC / bootstrap / anonymous dev mode) bypasses the scope gate", async () => {
		// Same posture as the existing ingest tests — they default to
		// `null` and rely on the read tools + write tools all running.
		// This test is the explicit assertion that the no-gate case
		// keeps the legacy behavior so the new gate doesn't break dev.
		const h = await makeMcpHarness({
			withIngest: true,
			subjectScopes: null,
		});
		try {
			const { knowledgeBaseId } = await makeKbForIngest(
				h.store,
				h.driver,
				h.workspaceId,
			);
			const result = await h.client.callTool({
				name: "ingest_text",
				arguments: { knowledgeBaseId, text: "null scopes works" },
			});
			const payload = JSON.parse(textContent(result as never)) as {
				outcome: string;
			};
			expect(payload.outcome).toBe("completed");
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
			const agent = await h.store.createAgent(h.workspaceId, {
				name: "Helper",
			});
			const chat = await h.store.createConversation(
				h.workspaceId,
				agent.agentId,
				{ title: "t" },
			);
			const result = await h.client.callTool({
				name: "chat_send",
				arguments: {
					agentId: agent.agentId,
					chatId: chat.conversationId,
					content: "hi",
				},
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
