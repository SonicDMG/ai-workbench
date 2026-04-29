/**
 * Shared behavioral contract for {@link ../../src/control-plane/store.ControlPlaneStore}.
 *
 * Every backend's test file imports {@link runContract} and passes a factory.
 * That way `memory`, `file`, and later `astra` all run the same assertions —
 * the only way to keep behavior identical across backends.
 */

import { describe, expect, test } from "vitest";
import {
	ControlPlaneConflictError,
	ControlPlaneNotFoundError,
} from "../../src/control-plane/errors.js";
import type { ControlPlaneStore } from "../../src/control-plane/store.js";

export type ContractFactory = () => Promise<{
	readonly store: ControlPlaneStore;
	readonly cleanup?: () => Promise<void>;
}>;

export function runContract(name: string, factory: ContractFactory): void {
	describe(`ControlPlaneStore contract: ${name}`, () => {
		test("createWorkspace assigns a uid and echoes the input", async () => {
			const { store, cleanup } = await factory();
			try {
				const ws = await store.createWorkspace({
					name: "prod",
					kind: "astra",
					credentials: { token: "env:ASTRA_TOKEN" },
				});
				expect(ws.uid).toMatch(
					/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
				);
				expect(ws.name).toBe("prod");
				expect(ws.kind).toBe("astra");
				expect(ws.credentials.token).toBe("env:ASTRA_TOKEN");
				expect(ws.createdAt).toBe(ws.updatedAt);
			} finally {
				await cleanup?.();
			}
		});

		test("listWorkspaces returns everything created", async () => {
			const { store, cleanup } = await factory();
			try {
				await store.createWorkspace({ name: "a", kind: "mock" });
				await store.createWorkspace({ name: "b", kind: "mock" });
				const all = await store.listWorkspaces();
				expect(all.map((w) => w.name).sort()).toEqual(["a", "b"]);
			} finally {
				await cleanup?.();
			}
		});

		test("listWorkspaces returns rows in createdAt order", async () => {
			const { store, cleanup } = await factory();
			try {
				const a = await store.createWorkspace({ name: "a", kind: "mock" });
				// Ensure clock advance — ISO strings have ms resolution.
				await new Promise((r) => setTimeout(r, 5));
				const b = await store.createWorkspace({ name: "b", kind: "mock" });
				await new Promise((r) => setTimeout(r, 5));
				const c = await store.createWorkspace({ name: "c", kind: "mock" });
				const all = await store.listWorkspaces();
				expect(all.map((w) => w.uid)).toEqual([a.uid, b.uid, c.uid]);
			} finally {
				await cleanup?.();
			}
		});

		test("getWorkspace returns null for unknown uid", async () => {
			const { store, cleanup } = await factory();
			try {
				expect(
					await store.getWorkspace("00000000-0000-0000-0000-000000000000"),
				).toBeNull();
			} finally {
				await cleanup?.();
			}
		});

		test("createWorkspace rejects duplicate uid", async () => {
			const { store, cleanup } = await factory();
			try {
				const ws = await store.createWorkspace({
					name: "a",
					kind: "mock",
				});
				await expect(
					store.createWorkspace({
						uid: ws.uid,
						name: "duplicate",
						kind: "mock",
					}),
				).rejects.toBeInstanceOf(ControlPlaneConflictError);
			} finally {
				await cleanup?.();
			}
		});

		test("updateWorkspace applies the patch and bumps updatedAt", async () => {
			const { store, cleanup } = await factory();
			try {
				const ws = await store.createWorkspace({
					name: "a",
					kind: "mock",
				});
				// Ensure clock advance — ISO strings have ms resolution.
				await new Promise((r) => setTimeout(r, 5));
				const updated = await store.updateWorkspace(ws.uid, {
					name: "renamed",
				});
				expect(updated.name).toBe("renamed");
				expect(updated.kind).toBe("mock"); // untouched
				expect(new Date(updated.updatedAt).getTime()).toBeGreaterThan(
					new Date(ws.updatedAt).getTime(),
				);
			} finally {
				await cleanup?.();
			}
		});

		test("updateWorkspace throws on unknown uid", async () => {
			const { store, cleanup } = await factory();
			try {
				await expect(
					store.updateWorkspace("00000000-0000-0000-0000-000000000000", {
						name: "x",
					}),
				).rejects.toBeInstanceOf(ControlPlaneNotFoundError);
			} finally {
				await cleanup?.();
			}
		});

		test("deleteWorkspace cascades to KBs and api keys", async () => {
			const { store, cleanup } = await factory();
			try {
				const ws = await store.createWorkspace({ name: "a", kind: "mock" });
				await store.deleteWorkspace(ws.uid);
				expect(await store.getWorkspace(ws.uid)).toBeNull();
				await expect(store.listKnowledgeBases(ws.uid)).rejects.toBeInstanceOf(
					ControlPlaneNotFoundError,
				);
				await expect(store.listApiKeys(ws.uid)).rejects.toBeInstanceOf(
					ControlPlaneNotFoundError,
				);
			} finally {
				await cleanup?.();
			}
		});

		test("list/get operations on unknown workspace throw not-found", async () => {
			const { store, cleanup } = await factory();
			try {
				const ghost = "00000000-0000-0000-0000-000000000000";
				await expect(store.listKnowledgeBases(ghost)).rejects.toBeInstanceOf(
					ControlPlaneNotFoundError,
				);
				await expect(store.listApiKeys(ghost)).rejects.toBeInstanceOf(
					ControlPlaneNotFoundError,
				);
			} finally {
				await cleanup?.();
			}
		});

		test("persistApiKey writes a row and findApiKeyByPrefix finds it", async () => {
			const { store, cleanup } = await factory();
			try {
				const ws = await store.createWorkspace({ name: "w", kind: "mock" });
				const rec = await store.persistApiKey(ws.uid, {
					keyId: "00000000-0000-0000-0000-0000000000aa",
					prefix: "abcdef123456",
					hash: "scrypt$deadbeef$cafef00d",
					label: "ci",
				});
				expect(rec.revokedAt).toBeNull();
				expect(rec.lastUsedAt).toBeNull();

				const byPrefix = await store.findApiKeyByPrefix("abcdef123456");
				expect(byPrefix?.keyId).toBe(rec.keyId);
				expect(byPrefix?.workspace).toBe(ws.uid);

				const list = await store.listApiKeys(ws.uid);
				expect(list.map((k) => k.keyId)).toEqual([rec.keyId]);
			} finally {
				await cleanup?.();
			}
		});

		test("persistApiKey rejects duplicate prefix across workspaces", async () => {
			const { store, cleanup } = await factory();
			try {
				const a = await store.createWorkspace({ name: "a", kind: "mock" });
				const b = await store.createWorkspace({ name: "b", kind: "mock" });
				await store.persistApiKey(a.uid, {
					keyId: "00000000-0000-0000-0000-0000000000aa",
					prefix: "samesameaaaa",
					hash: "scrypt$a$a",
					label: "one",
				});
				await expect(
					store.persistApiKey(b.uid, {
						keyId: "00000000-0000-0000-0000-0000000000bb",
						prefix: "samesameaaaa",
						hash: "scrypt$b$b",
						label: "two",
					}),
				).rejects.toBeInstanceOf(ControlPlaneConflictError);
			} finally {
				await cleanup?.();
			}
		});

		test("revokeApiKey stamps revokedAt and the row stays listed", async () => {
			const { store, cleanup } = await factory();
			try {
				const ws = await store.createWorkspace({ name: "w", kind: "mock" });
				const rec = await store.persistApiKey(ws.uid, {
					keyId: "00000000-0000-0000-0000-0000000000aa",
					prefix: "xxxyyyzzzaaa",
					hash: "scrypt$s$h",
					label: "ci",
				});
				const result = await store.revokeApiKey(ws.uid, rec.keyId);
				expect(result.revoked).toBe(true);
				const again = await store.getApiKey(ws.uid, rec.keyId);
				expect(again?.revokedAt).not.toBeNull();

				// Re-revoke is a no-op.
				const noop = await store.revokeApiKey(ws.uid, rec.keyId);
				expect(noop.revoked).toBe(false);

				// Still visible in list.
				const list = await store.listApiKeys(ws.uid);
				expect(list).toHaveLength(1);
			} finally {
				await cleanup?.();
			}
		});

		test("deleteWorkspace cascades to api keys and their prefix index", async () => {
			const { store, cleanup } = await factory();
			try {
				const ws = await store.createWorkspace({ name: "w", kind: "mock" });
				await store.persistApiKey(ws.uid, {
					keyId: "00000000-0000-0000-0000-0000000000aa",
					prefix: "cascadecascad",
					hash: "scrypt$s$h",
					label: "ci",
				});
				await store.deleteWorkspace(ws.uid);
				expect(await store.findApiKeyByPrefix("cascadecascad")).toBeNull();
			} finally {
				await cleanup?.();
			}
		});

		/* ============================================================== */
		/* Knowledge-base schema (issue #98)                              */
		/* ============================================================== */

		test("creating a knowledge base validates referenced services exist", async () => {
			const { store, cleanup } = await factory();
			try {
				const ws = await store.createWorkspace({ name: "w", kind: "mock" });
				// Missing embedding service ⇒ 404.
				await expect(
					store.createKnowledgeBase(ws.uid, {
						name: "kb",
						embeddingServiceId: "00000000-0000-0000-0000-000000000001",
						chunkingServiceId: "00000000-0000-0000-0000-000000000002",
					}),
				).rejects.toBeInstanceOf(ControlPlaneNotFoundError);
			} finally {
				await cleanup?.();
			}
		});

		test("knowledge base CRUD round-trip with auto-provisioned vector collection", async () => {
			const { store, cleanup } = await factory();
			try {
				const ws = await store.createWorkspace({ name: "w", kind: "mock" });
				const emb = await store.createEmbeddingService(ws.uid, {
					name: "openai-3-small",
					provider: "openai",
					modelName: "text-embedding-3-small",
					embeddingDimension: 1536,
				});
				const chunk = await store.createChunkingService(ws.uid, {
					name: "docling-default",
					engine: "docling",
				});
				const rerank = await store.createRerankingService(ws.uid, {
					name: "cohere-rerank-3",
					provider: "cohere",
					modelName: "rerank-english-v3.0",
				});

				const kb = await store.createKnowledgeBase(ws.uid, {
					name: "products",
					description: "product catalog",
					embeddingServiceId: emb.embeddingServiceId,
					chunkingServiceId: chunk.chunkingServiceId,
					rerankingServiceId: rerank.rerankingServiceId,
					language: "en",
				});

				expect(kb.workspaceId).toBe(ws.uid);
				expect(kb.embeddingServiceId).toBe(emb.embeddingServiceId);
				expect(kb.chunkingServiceId).toBe(chunk.chunkingServiceId);
				expect(kb.rerankingServiceId).toBe(rerank.rerankingServiceId);
				// Auto-provisioned collection name follows the wb_vectors_<id>
				// (hyphen-stripped) convention.
				expect(kb.vectorCollection).toMatch(/^wb_vectors_[0-9a-f]+$/);
				expect(kb.vectorCollection).not.toContain("-");
				expect(kb.lexical.enabled).toBe(false);

				const list = await store.listKnowledgeBases(ws.uid);
				expect(list).toHaveLength(1);

				// PATCH does not allow embeddingServiceId / chunkingServiceId
				// (omitted from the input type, enforced at the type system).
				// Reranker, language, status, lexical all swing freely.
				const updated = await store.updateKnowledgeBase(
					ws.uid,
					kb.knowledgeBaseId,
					{
						rerankingServiceId: null,
						language: "fr",
						status: "draft",
					},
				);
				expect(updated.rerankingServiceId).toBeNull();
				expect(updated.language).toBe("fr");
				expect(updated.status).toBe("draft");
				expect(updated.embeddingServiceId).toBe(emb.embeddingServiceId);
			} finally {
				await cleanup?.();
			}
		});

		test("deleting a service that a KB still references is a conflict", async () => {
			const { store, cleanup } = await factory();
			try {
				const ws = await store.createWorkspace({ name: "w", kind: "mock" });
				const emb = await store.createEmbeddingService(ws.uid, {
					name: "openai-3-small",
					provider: "openai",
					modelName: "text-embedding-3-small",
					embeddingDimension: 1536,
				});
				const chunk = await store.createChunkingService(ws.uid, {
					name: "docling-default",
					engine: "docling",
				});
				await store.createKnowledgeBase(ws.uid, {
					name: "products",
					embeddingServiceId: emb.embeddingServiceId,
					chunkingServiceId: chunk.chunkingServiceId,
				});

				await expect(
					store.deleteEmbeddingService(ws.uid, emb.embeddingServiceId),
				).rejects.toBeInstanceOf(ControlPlaneConflictError);
				await expect(
					store.deleteChunkingService(ws.uid, chunk.chunkingServiceId),
				).rejects.toBeInstanceOf(ControlPlaneConflictError);
			} finally {
				await cleanup?.();
			}
		});

		test("knowledge filter CRUD is scoped to a knowledge base", async () => {
			const { store, cleanup } = await factory();
			try {
				const ws = await store.createWorkspace({ name: "w", kind: "mock" });
				const emb = await store.createEmbeddingService(ws.uid, {
					name: "e",
					provider: "mock",
					modelName: "mock",
					embeddingDimension: 4,
				});
				const chunk = await store.createChunkingService(ws.uid, {
					name: "c",
					engine: "docling",
				});
				const kb = await store.createKnowledgeBase(ws.uid, {
					name: "kb",
					embeddingServiceId: emb.embeddingServiceId,
					chunkingServiceId: chunk.chunkingServiceId,
				});

				const filter = await store.createKnowledgeFilter(
					ws.uid,
					kb.knowledgeBaseId,
					{
						name: "Published",
						filter: { status: "published" },
					},
				);
				expect(filter.filter).toEqual({ status: "published" });
				expect(
					await store.listKnowledgeFilters(ws.uid, kb.knowledgeBaseId),
				).toHaveLength(1);

				const updated = await store.updateKnowledgeFilter(
					ws.uid,
					kb.knowledgeBaseId,
					filter.knowledgeFilterId,
					{ filter: { status: "draft" } },
				);
				expect(updated.filter).toEqual({ status: "draft" });

				const { deleted } = await store.deleteKnowledgeFilter(
					ws.uid,
					kb.knowledgeBaseId,
					filter.knowledgeFilterId,
				);
				expect(deleted).toBe(true);
			} finally {
				await cleanup?.();
			}
		});

		test("deleteWorkspace cascades to KBs and services", async () => {
			const { store, cleanup } = await factory();
			try {
				const ws = await store.createWorkspace({ name: "w", kind: "mock" });
				await store.createEmbeddingService(ws.uid, {
					name: "e",
					provider: "openai",
					modelName: "m",
					embeddingDimension: 4,
				});
				await store.createChunkingService(ws.uid, {
					name: "c",
					engine: "docling",
				});
				await store.createRerankingService(ws.uid, {
					name: "r",
					provider: "cohere",
					modelName: "rerank",
				});
				await store.deleteWorkspace(ws.uid);

				// Workspace is gone — listing on it throws.
				await expect(store.listKnowledgeBases(ws.uid)).rejects.toBeInstanceOf(
					ControlPlaneNotFoundError,
				);
				await expect(store.listChunkingServices(ws.uid)).rejects.toBeInstanceOf(
					ControlPlaneNotFoundError,
				);
				await expect(
					store.listEmbeddingServices(ws.uid),
				).rejects.toBeInstanceOf(ControlPlaneNotFoundError);
				await expect(
					store.listRerankingServices(ws.uid),
				).rejects.toBeInstanceOf(ControlPlaneNotFoundError);
			} finally {
				await cleanup?.();
			}
		});

		test("embedding service supportedLanguages round-trips deduped + sorted", async () => {
			const { store, cleanup } = await factory();
			try {
				const ws = await store.createWorkspace({ name: "w", kind: "mock" });
				const created = await store.createEmbeddingService(ws.uid, {
					name: "multi",
					provider: "openai",
					modelName: "m",
					embeddingDimension: 4,
					// Duplicates and unsorted; the store normalises both.
					supportedLanguages: ["fr", "en", "es", "fr"],
					supportedContent: ["text"],
				});
				expect(Array.isArray(created.supportedLanguages)).toBe(true);
				expect(created.supportedLanguages).toEqual(["en", "es", "fr"]);
				expect(created.supportedContent).toEqual(["text"]);

				const reread = await store.getEmbeddingService(
					ws.uid,
					created.embeddingServiceId,
				);
				expect(reread).not.toBeNull();
				expect(reread?.supportedLanguages).toContain("en");
				expect(reread?.supportedLanguages).toHaveLength(3);
			} finally {
				await cleanup?.();
			}
		});

		test("RAG document CRUD round-trip and KB scoping", async () => {
			const { store, cleanup } = await factory();
			try {
				const ws = await store.createWorkspace({ name: "w", kind: "mock" });
				const emb = await store.createEmbeddingService(ws.uid, {
					name: "e",
					provider: "openai",
					modelName: "m",
					embeddingDimension: 4,
				});
				const chunk = await store.createChunkingService(ws.uid, {
					name: "c",
					engine: "docling",
				});
				const kb = await store.createKnowledgeBase(ws.uid, {
					name: "kb",
					embeddingServiceId: emb.embeddingServiceId,
					chunkingServiceId: chunk.chunkingServiceId,
				});

				const doc = await store.createRagDocument(ws.uid, kb.knowledgeBaseId, {
					sourceFilename: "alpha.txt",
					contentHash: "sha-abc",
					metadata: { tag: "x" },
				});
				expect(doc.workspaceId).toBe(ws.uid);
				expect(doc.knowledgeBaseId).toBe(kb.knowledgeBaseId);
				expect(doc.contentHash).toBe("sha-abc");

				const list = await store.listRagDocuments(ws.uid, kb.knowledgeBaseId);
				expect(list).toHaveLength(1);

				const updated = await store.updateRagDocument(
					ws.uid,
					kb.knowledgeBaseId,
					doc.documentId,
					{ status: "ready" },
				);
				expect(updated.status).toBe("ready");

				const got = await store.getRagDocument(
					ws.uid,
					kb.knowledgeBaseId,
					doc.documentId,
				);
				expect(got?.status).toBe("ready");

				const { deleted } = await store.deleteRagDocument(
					ws.uid,
					kb.knowledgeBaseId,
					doc.documentId,
				);
				expect(deleted).toBe(true);
				expect(
					await store.getRagDocument(
						ws.uid,
						kb.knowledgeBaseId,
						doc.documentId,
					),
				).toBeNull();
			} finally {
				await cleanup?.();
			}
		});

		test("RAG document operations 404 on unknown KB", async () => {
			const { store, cleanup } = await factory();
			try {
				const ws = await store.createWorkspace({ name: "w", kind: "mock" });
				await expect(
					store.listRagDocuments(
						ws.uid,
						"00000000-0000-0000-0000-000000000000",
					),
				).rejects.toBeInstanceOf(ControlPlaneNotFoundError);
			} finally {
				await cleanup?.();
			}
		});

		test("deleteKnowledgeBase cascades RAG documents", async () => {
			const { store, cleanup } = await factory();
			try {
				const ws = await store.createWorkspace({ name: "w", kind: "mock" });
				const emb = await store.createEmbeddingService(ws.uid, {
					name: "e",
					provider: "openai",
					modelName: "m",
					embeddingDimension: 4,
				});
				const chunk = await store.createChunkingService(ws.uid, {
					name: "c",
					engine: "docling",
				});
				const kb = await store.createKnowledgeBase(ws.uid, {
					name: "kb",
					embeddingServiceId: emb.embeddingServiceId,
					chunkingServiceId: chunk.chunkingServiceId,
				});
				await store.createRagDocument(ws.uid, kb.knowledgeBaseId, {
					sourceFilename: "f.txt",
				});
				await store.deleteKnowledgeBase(ws.uid, kb.knowledgeBaseId);
				// The KB is gone, so list throws not-found rather than
				// returning a stale row.
				await expect(
					store.listRagDocuments(ws.uid, kb.knowledgeBaseId),
				).rejects.toBeInstanceOf(ControlPlaneNotFoundError);
			} finally {
				await cleanup?.();
			}
		});

		test("touchApiKey bumps lastUsedAt", async () => {
			const { store, cleanup } = await factory();
			try {
				const ws = await store.createWorkspace({ name: "w", kind: "mock" });
				const rec = await store.persistApiKey(ws.uid, {
					keyId: "00000000-0000-0000-0000-0000000000aa",
					prefix: "touchabcdefaa",
					hash: "scrypt$s$h",
					label: "ci",
				});
				await new Promise((r) => setTimeout(r, 5));
				await store.touchApiKey(ws.uid, rec.keyId);
				const fresh = await store.getApiKey(ws.uid, rec.keyId);
				expect(fresh?.lastUsedAt).not.toBeNull();
			} finally {
				await cleanup?.();
			}
		});

		/* ---------------- Chat (workspace-scoped) ---------------- */

		test("ensureBobbieAgent is idempotent and converges on one row", async () => {
			const { store, cleanup } = await factory();
			try {
				const ws = await store.createWorkspace({ name: "w", kind: "mock" });
				const a1 = await store.ensureBobbieAgent(ws.uid);
				const a2 = await store.ensureBobbieAgent(ws.uid);
				expect(a1.agentId).toBe(a2.agentId);
				expect(a1.workspaceId).toBe(ws.uid);
				expect(a1.name).toBe("Bobbie");
				expect(a1.systemPrompt).toContain("Bobbie");
				expect(a1.ragEnabled).toBe(true);
				expect(a1.knowledgeBaseIds).toEqual([]);
			} finally {
				await cleanup?.();
			}
		});

		test("ensureBobbieAgent throws on unknown workspace", async () => {
			const { store, cleanup } = await factory();
			try {
				await expect(
					store.ensureBobbieAgent("00000000-0000-0000-0000-000000000099"),
				).rejects.toBeInstanceOf(ControlPlaneNotFoundError);
			} finally {
				await cleanup?.();
			}
		});

		test("createChat persists title + KB filter; listChats returns it", async () => {
			const { store, cleanup } = await factory();
			try {
				const ws = await store.createWorkspace({ name: "w", kind: "mock" });
				const before = await store.listChats(ws.uid);
				expect(before).toEqual([]);
				const chat = await store.createChat(ws.uid, {
					title: "First chat",
					knowledgeBaseIds: ["kb-2", "kb-1", "kb-2"],
				});
				expect(chat.title).toBe("First chat");
				// Sorted, deduped by the store contract.
				expect(chat.knowledgeBaseIds).toEqual(["kb-1", "kb-2"]);
				expect(chat.workspaceId).toBe(ws.uid);

				const list = await store.listChats(ws.uid);
				expect(list).toHaveLength(1);
				expect(list[0]?.conversationId).toBe(chat.conversationId);

				const fetched = await store.getChat(ws.uid, chat.conversationId);
				expect(fetched).toEqual(chat);
			} finally {
				await cleanup?.();
			}
		});

		test("multiple chats per workspace coexist", async () => {
			const { store, cleanup } = await factory();
			try {
				const ws = await store.createWorkspace({ name: "w", kind: "mock" });
				await store.createChat(ws.uid, { title: "A" });
				await new Promise((r) => setTimeout(r, 5));
				await store.createChat(ws.uid, { title: "B" });
				const list = await store.listChats(ws.uid);
				expect(list).toHaveLength(2);
				// Newest-first matches the table cluster ordering.
				expect(list[0]?.title).toBe("B");
				expect(list[1]?.title).toBe("A");
			} finally {
				await cleanup?.();
			}
		});

		test("updateChat patches title and knowledgeBaseIds independently", async () => {
			const { store, cleanup } = await factory();
			try {
				const ws = await store.createWorkspace({ name: "w", kind: "mock" });
				const chat = await store.createChat(ws.uid, {
					title: "old",
					knowledgeBaseIds: ["kb-1"],
				});
				const renamed = await store.updateChat(ws.uid, chat.conversationId, {
					title: "new",
				});
				expect(renamed.title).toBe("new");
				expect(renamed.knowledgeBaseIds).toEqual(["kb-1"]);
				const refiltered = await store.updateChat(ws.uid, chat.conversationId, {
					knowledgeBaseIds: ["kb-1", "kb-2"],
				});
				expect(refiltered.title).toBe("new");
				expect(refiltered.knowledgeBaseIds).toEqual(["kb-1", "kb-2"]);
			} finally {
				await cleanup?.();
			}
		});

		test("appendChatMessage and listChatMessages round-trip", async () => {
			const { store, cleanup } = await factory();
			try {
				const ws = await store.createWorkspace({ name: "w", kind: "mock" });
				const chat = await store.createChat(ws.uid, { title: "t" });
				const u = await store.appendChatMessage(ws.uid, chat.conversationId, {
					role: "user",
					content: "hello",
				});
				await new Promise((r) => setTimeout(r, 5));
				const a = await store.appendChatMessage(ws.uid, chat.conversationId, {
					role: "agent",
					content: "hi there",
					metadata: {
						context_document_ids: "doc-1,doc-2",
						model: "test-model",
						finish_reason: "stop",
					},
				});
				const msgs = await store.listChatMessages(ws.uid, chat.conversationId);
				expect(msgs).toHaveLength(2);
				// Oldest-first matches the table cluster ordering.
				expect(msgs[0]?.messageId).toBe(u.messageId);
				expect(msgs[0]?.content).toBe("hello");
				expect(msgs[1]?.messageId).toBe(a.messageId);
				expect(msgs[1]?.metadata.finish_reason).toBe("stop");
			} finally {
				await cleanup?.();
			}
		});

		test("updateChatMessage merges metadata key-by-key", async () => {
			const { store, cleanup } = await factory();
			try {
				const ws = await store.createWorkspace({ name: "w", kind: "mock" });
				const chat = await store.createChat(ws.uid, { title: "t" });
				const placeholder = await store.appendChatMessage(
					ws.uid,
					chat.conversationId,
					{ role: "agent", content: "", metadata: { model: "test-model" } },
				);
				const finalized = await store.updateChatMessage(
					ws.uid,
					chat.conversationId,
					placeholder.messageId,
					{
						content: "complete answer",
						metadata: { finish_reason: "stop" },
					},
				);
				expect(finalized.content).toBe("complete answer");
				// Original key preserved, new key added.
				expect(finalized.metadata).toEqual({
					model: "test-model",
					finish_reason: "stop",
				});

				// `undefined` values drop a metadata key.
				const dropped = await store.updateChatMessage(
					ws.uid,
					chat.conversationId,
					placeholder.messageId,
					{ metadata: { model: undefined } },
				);
				expect(dropped.metadata).toEqual({ finish_reason: "stop" });
			} finally {
				await cleanup?.();
			}
		});

		test("appendChatMessage / listChatMessages reject unknown chat", async () => {
			const { store, cleanup } = await factory();
			try {
				const ws = await store.createWorkspace({ name: "w", kind: "mock" });
				await expect(
					store.listChatMessages(
						ws.uid,
						"00000000-0000-0000-0000-0000000000ff",
					),
				).rejects.toBeInstanceOf(ControlPlaneNotFoundError);
				await expect(
					store.appendChatMessage(
						ws.uid,
						"00000000-0000-0000-0000-0000000000ff",
						{ role: "user", content: "x" },
					),
				).rejects.toBeInstanceOf(ControlPlaneNotFoundError);
			} finally {
				await cleanup?.();
			}
		});

		test("createChat rejects duplicate explicit chatId", async () => {
			const { store, cleanup } = await factory();
			try {
				const ws = await store.createWorkspace({ name: "w", kind: "mock" });
				const chatId = "00000000-0000-0000-0000-0000000000c1";
				await store.createChat(ws.uid, { chatId });
				await expect(
					store.createChat(ws.uid, { chatId }),
				).rejects.toBeInstanceOf(ControlPlaneConflictError);
			} finally {
				await cleanup?.();
			}
		});

		test("deleteChat cascades to its messages", async () => {
			const { store, cleanup } = await factory();
			try {
				const ws = await store.createWorkspace({ name: "w", kind: "mock" });
				const chat = await store.createChat(ws.uid, { title: "t" });
				await store.appendChatMessage(ws.uid, chat.conversationId, {
					role: "user",
					content: "hello",
				});
				const { deleted } = await store.deleteChat(ws.uid, chat.conversationId);
				expect(deleted).toBe(true);
				expect(await store.getChat(ws.uid, chat.conversationId)).toBeNull();
				// Re-creating a chat with the same id starts clean.
				await store.createChat(ws.uid, {
					chatId: chat.conversationId,
					title: "fresh",
				});
				const msgs = await store.listChatMessages(ws.uid, chat.conversationId);
				expect(msgs).toEqual([]);
			} finally {
				await cleanup?.();
			}
		});

		test("deleteWorkspace cascades to chats and messages", async () => {
			const { store, cleanup } = await factory();
			try {
				const ws = await store.createWorkspace({ name: "w", kind: "mock" });
				const chat = await store.createChat(ws.uid, { title: "t" });
				await store.appendChatMessage(ws.uid, chat.conversationId, {
					role: "user",
					content: "hi",
				});
				await store.deleteWorkspace(ws.uid);

				// Re-create the workspace with the same uid; chats should be
				// gone, not visible from the previous incarnation.
				const reborn = await store.createWorkspace({
					uid: ws.uid,
					name: "w",
					kind: "mock",
				});
				const list = await store.listChats(reborn.uid);
				expect(list).toEqual([]);
			} finally {
				await cleanup?.();
			}
		});

		test("createAgent persists fields; getAgent / listAgents return it", async () => {
			const { store, cleanup } = await factory();
			try {
				const ws = await store.createWorkspace({ name: "w", kind: "mock" });
				const a = await store.createAgent(ws.uid, {
					name: "Researcher",
					description: "desc",
					systemPrompt: "be careful",
					ragEnabled: true,
					knowledgeBaseIds: ["kb-1", "kb-2"],
				});
				expect(a.name).toBe("Researcher");
				expect(a.description).toBe("desc");
				expect(a.ragEnabled).toBe(true);
				expect([...a.knowledgeBaseIds]).toEqual(["kb-1", "kb-2"]);

				const got = await store.getAgent(ws.uid, a.agentId);
				expect(got).toEqual(a);

				const list = await store.listAgents(ws.uid);
				const ids = list.map((row) => row.agentId);
				expect(ids).toContain(a.agentId);
			} finally {
				await cleanup?.();
			}
		});

		test("updateAgent patches fields and bumps updatedAt", async () => {
			const { store, cleanup } = await factory();
			try {
				const ws = await store.createWorkspace({ name: "w", kind: "mock" });
				const a = await store.createAgent(ws.uid, {
					name: "Old",
					description: "d",
					ragEnabled: false,
				});
				// Sleep a millisecond so updatedAt is strictly later than
				// createdAt — file/astra timestamps have ms resolution.
				await new Promise((r) => setTimeout(r, 5));
				const u = await store.updateAgent(ws.uid, a.agentId, {
					name: "New",
					description: null,
					ragEnabled: true,
				});
				expect(u.name).toBe("New");
				expect(u.description).toBeNull();
				expect(u.ragEnabled).toBe(true);
				expect(Date.parse(u.updatedAt)).toBeGreaterThanOrEqual(
					Date.parse(a.updatedAt),
				);
			} finally {
				await cleanup?.();
			}
		});

		test("deleteAgent cascades conversations + messages", async () => {
			const { store, cleanup } = await factory();
			try {
				const ws = await store.createWorkspace({ name: "w", kind: "mock" });
				const a = await store.createAgent(ws.uid, { name: "X" });
				const conv = await store.createConversation(ws.uid, a.agentId, {
					title: "to-cascade",
				});
				await store.appendChatMessage(ws.uid, conv.conversationId, {
					role: "user",
					content: "hi",
				});
				const { deleted } = await store.deleteAgent(ws.uid, a.agentId);
				expect(deleted).toBe(true);
				expect(await store.getAgent(ws.uid, a.agentId)).toBeNull();
				expect(
					await store.getConversation(ws.uid, a.agentId, conv.conversationId),
				).toBeNull();
				// Re-creating with the same id is fine — the cascade left no
				// orphan conversation rows.
				const reborn = await store.createAgent(ws.uid, {
					agentId: a.agentId,
					name: "X-reborn",
				});
				expect(reborn.agentId).toBe(a.agentId);
			} finally {
				await cleanup?.();
			}
		});

		test("createConversation rejects unknown agent", async () => {
			const { store, cleanup } = await factory();
			try {
				const ws = await store.createWorkspace({ name: "w", kind: "mock" });
				await expect(
					store.createConversation(
						ws.uid,
						"00000000-0000-0000-0000-0000000000aa",
						{ title: "x" },
					),
				).rejects.toBeInstanceOf(ControlPlaneNotFoundError);
			} finally {
				await cleanup?.();
			}
		});

		test("user-defined agent conversations are isolated from Bobbie's chats", async () => {
			const { store, cleanup } = await factory();
			try {
				const ws = await store.createWorkspace({ name: "w", kind: "mock" });
				// Bobbie path.
				const bobbieChat = await store.createChat(ws.uid, {
					title: "bob-chat",
				});
				// User-defined path.
				const a = await store.createAgent(ws.uid, { name: "Helper" });
				const userConv = await store.createConversation(ws.uid, a.agentId, {
					title: "user-conv",
				});

				// listChats only sees Bobbie's; listConversations(agentId)
				// only sees its own.
				const chats = await store.listChats(ws.uid);
				expect(chats.map((c) => c.conversationId)).toEqual([
					bobbieChat.conversationId,
				]);
				const userConvs = await store.listConversations(ws.uid, a.agentId);
				expect(userConvs.map((c) => c.conversationId)).toEqual([
					userConv.conversationId,
				]);
			} finally {
				await cleanup?.();
			}
		});

		test("deleteKnowledgeBase removes the kb id from chat KB filters", async () => {
			const { store, cleanup } = await factory();
			try {
				const ws = await store.createWorkspace({ name: "w", kind: "mock" });
				// Make real KBs so deleteKnowledgeBase can actually run.
				const chunk = await store.createChunkingService(ws.uid, {
					name: "c",
					engine: "fixed",
				});
				const embed = await store.createEmbeddingService(ws.uid, {
					name: "e",
					provider: "fake",
					modelName: "m",
					embeddingDimension: 4,
				});
				const kbA = await store.createKnowledgeBase(ws.uid, {
					name: "A",
					chunkingServiceId: chunk.chunkingServiceId,
					embeddingServiceId: embed.embeddingServiceId,
				});
				const kbB = await store.createKnowledgeBase(ws.uid, {
					name: "B",
					chunkingServiceId: chunk.chunkingServiceId,
					embeddingServiceId: embed.embeddingServiceId,
				});
				const chat = await store.createChat(ws.uid, {
					title: "t",
					knowledgeBaseIds: [kbA.knowledgeBaseId, kbB.knowledgeBaseId],
				});
				await store.deleteKnowledgeBase(ws.uid, kbA.knowledgeBaseId);
				const after = await store.getChat(ws.uid, chat.conversationId);
				expect(after?.knowledgeBaseIds).toEqual([kbB.knowledgeBaseId]);
			} finally {
				await cleanup?.();
			}
		});
	});
}
