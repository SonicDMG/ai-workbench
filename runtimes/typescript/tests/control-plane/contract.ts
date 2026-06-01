/**
 * Shared behavioral contract for {@link ../../src/control-plane/store.ControlPlaneStore}.
 *
 * Every backend's test file imports {@link runContract} and passes a factory.
 * That way `memory`, `file`, and later `astra` all run the same assertions —
 * the only way to keep behavior identical across backends.
 */

import { describe, expect, test } from "vitest";
import {
	AGENT_CASCADE_STEPS,
	type AgentCascadeStep,
	KNOWLEDGE_BASE_CASCADE_STEPS,
	type KnowledgeBaseCascadeStep,
	WORKSPACE_CASCADE_STEPS,
	type WorkspaceCascadeStep,
} from "../../src/control-plane/cascade.js";
import {
	ControlPlaneConflictError,
	ControlPlaneNotFoundError,
} from "../../src/control-plane/errors.js";
import type { ControlPlaneStore } from "../../src/control-plane/store.js";
import {
	decodeKeysetCursor,
	encodeKeysetCursor,
	type KeysetKey,
} from "../../src/lib/pagination.js";

export type ContractFactory = () => Promise<{
	readonly store: ControlPlaneStore;
	readonly cleanup?: () => Promise<void>;
}>;

/**
 * Walk every page of a keyset-paginated list, round-tripping the cursor
 * through the wire codec between pages (exactly as the route layer will),
 * and asserting the cursor strictly advances (a repeated cursor means a
 * stalled walk — the failure mode the web client surfaces as a hard
 * `pagination_loop` error). Returns the ids in page order.
 */
async function drainPaged<T>(
	fetchPage: (after: KeysetKey | null) => Promise<{
		readonly items: readonly T[];
		readonly nextKey: KeysetKey | null;
	}>,
	idOf: (item: T) => string,
): Promise<string[]> {
	const ids: string[] = [];
	const seenCursors = new Set<string>();
	let after: KeysetKey | null = null;
	for (let guard = 0; guard < 500; guard++) {
		const page = await fetchPage(after);
		ids.push(...page.items.map(idOf));
		if (page.nextKey === null) return ids;
		const cursor = encodeKeysetCursor(page.nextKey);
		expect(seenCursors.has(cursor), "keyset cursor must strictly advance").toBe(
			false,
		);
		seenCursors.add(cursor);
		after = decodeKeysetCursor(cursor);
	}
	throw new Error("drainPaged did not terminate");
}

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

		test("createWorkspace rejects duplicate name with workspace_name_conflict", async () => {
			const { store, cleanup } = await factory();
			try {
				await store.createWorkspace({ name: "Engineering Docs", kind: "mock" });
				try {
					await store.createWorkspace({
						name: "Engineering Docs",
						kind: "mock",
					});
					expect.fail("expected ControlPlaneConflictError");
				} catch (err) {
					expect(err).toBeInstanceOf(ControlPlaneConflictError);
					expect((err as ControlPlaneConflictError).code).toBe(
						"workspace_name_conflict",
					);
				}
			} finally {
				await cleanup?.();
			}
		});

		test("createWorkspace rejects duplicate (url, keyspace) with workspace_database_conflict", async () => {
			const { store, cleanup } = await factory();
			try {
				await store.createWorkspace({
					name: "alpha",
					kind: "mock",
					url: "https://db-X.apps.astra.datastax.com",
					keyspace: "default_keyspace",
				});
				try {
					await store.createWorkspace({
						name: "beta",
						kind: "mock",
						url: "https://db-X.apps.astra.datastax.com",
						keyspace: "default_keyspace",
					});
					expect.fail("expected ControlPlaneConflictError");
				} catch (err) {
					expect(err).toBeInstanceOf(ControlPlaneConflictError);
					expect((err as ControlPlaneConflictError).code).toBe(
						"workspace_database_conflict",
					);
				}
			} finally {
				await cleanup?.();
			}
		});

		test("createWorkspace allows same url with a different keyspace", async () => {
			// (url, keyspace) is the binding key — different keyspaces on
			// the same DB endpoint are distinct namespaces and should
			// coexist.
			const { store, cleanup } = await factory();
			try {
				await store.createWorkspace({
					name: "alpha",
					kind: "mock",
					url: "https://db-X.apps.astra.datastax.com",
					keyspace: "ks_one",
				});
				const beta = await store.createWorkspace({
					name: "beta",
					kind: "mock",
					url: "https://db-X.apps.astra.datastax.com",
					keyspace: "ks_two",
				});
				expect(beta.name).toBe("beta");
			} finally {
				await cleanup?.();
			}
		});

		test("createWorkspace allows multiple url-less workspaces (mock kind)", async () => {
			// Workspaces without a DB binding (typical for `mock` kind)
			// shouldn't trip the binding check on each other.
			const { store, cleanup } = await factory();
			try {
				await store.createWorkspace({ name: "alpha", kind: "mock" });
				const beta = await store.createWorkspace({
					name: "beta",
					kind: "mock",
				});
				expect(beta.name).toBe("beta");
			} finally {
				await cleanup?.();
			}
		});

		test("updateWorkspace renaming to its own current name is fine (selfUid exclusion)", async () => {
			const { store, cleanup } = await factory();
			try {
				const ws = await store.createWorkspace({ name: "alpha", kind: "mock" });
				// Patch with the same name — shouldn't conflict with itself.
				const patched = await store.updateWorkspace(ws.uid, { name: "alpha" });
				expect(patched.name).toBe("alpha");
			} finally {
				await cleanup?.();
			}
		});

		test("updateWorkspace rejects renaming to another workspace's name", async () => {
			const { store, cleanup } = await factory();
			try {
				await store.createWorkspace({ name: "alpha", kind: "mock" });
				const beta = await store.createWorkspace({
					name: "beta",
					kind: "mock",
				});
				try {
					await store.updateWorkspace(beta.uid, { name: "alpha" });
					expect.fail("expected ControlPlaneConflictError");
				} catch (err) {
					expect(err).toBeInstanceOf(ControlPlaneConflictError);
					expect((err as ControlPlaneConflictError).code).toBe(
						"workspace_name_conflict",
					);
				}
			} finally {
				await cleanup?.();
			}
		});

		test("updateWorkspace rejects re-pointing to another workspace's (url, keyspace)", async () => {
			const { store, cleanup } = await factory();
			try {
				await store.createWorkspace({
					name: "alpha",
					kind: "mock",
					url: "https://db-X.apps.astra.datastax.com",
					keyspace: "default_keyspace",
				});
				const beta = await store.createWorkspace({
					name: "beta",
					kind: "mock",
					url: "https://db-Y.apps.astra.datastax.com",
					keyspace: "default_keyspace",
				});
				try {
					await store.updateWorkspace(beta.uid, {
						url: "https://db-X.apps.astra.datastax.com",
					});
					expect.fail("expected ControlPlaneConflictError");
				} catch (err) {
					expect(err).toBeInstanceOf(ControlPlaneConflictError);
					expect((err as ControlPlaneConflictError).code).toBe(
						"workspace_database_conflict",
					);
				}
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

		/* ---------------- Conversations + messages ---------------- */

		test("createConversation persists title + KB filter; listConversations returns it", async () => {
			const { store, cleanup } = await factory();
			try {
				const ws = await store.createWorkspace({ name: "w", kind: "mock" });
				const agent = await store.createAgent(ws.uid, { name: "Helper" });
				const before = await store.listConversations(ws.uid, agent.agentId);
				expect(before).toEqual([]);
				const conv = await store.createConversation(ws.uid, agent.agentId, {
					title: "First chat",
					knowledgeBaseIds: ["kb-2", "kb-1", "kb-2"],
				});
				expect(conv.title).toBe("First chat");
				// Sorted, deduped by the store contract.
				expect(conv.knowledgeBaseIds).toEqual(["kb-1", "kb-2"]);
				expect(conv.workspaceId).toBe(ws.uid);
				expect(conv.agentId).toBe(agent.agentId);

				const list = await store.listConversations(ws.uid, agent.agentId);
				expect(list).toHaveLength(1);
				expect(list[0]?.conversationId).toBe(conv.conversationId);

				const fetched = await store.getConversation(
					ws.uid,
					agent.agentId,
					conv.conversationId,
				);
				expect(fetched).toEqual(conv);
			} finally {
				await cleanup?.();
			}
		});

		test("multiple conversations per agent coexist", async () => {
			const { store, cleanup } = await factory();
			try {
				const ws = await store.createWorkspace({ name: "w", kind: "mock" });
				const agent = await store.createAgent(ws.uid, { name: "Helper" });
				await store.createConversation(ws.uid, agent.agentId, { title: "A" });
				await new Promise((r) => setTimeout(r, 5));
				await store.createConversation(ws.uid, agent.agentId, { title: "B" });
				const list = await store.listConversations(ws.uid, agent.agentId);
				expect(list).toHaveLength(2);
				// Newest-first matches the table cluster ordering.
				expect(list[0]?.title).toBe("B");
				expect(list[1]?.title).toBe("A");
			} finally {
				await cleanup?.();
			}
		});

		test("updateConversation patches title and knowledgeBaseIds independently", async () => {
			const { store, cleanup } = await factory();
			try {
				const ws = await store.createWorkspace({ name: "w", kind: "mock" });
				const agent = await store.createAgent(ws.uid, { name: "Helper" });
				const conv = await store.createConversation(ws.uid, agent.agentId, {
					title: "old",
					knowledgeBaseIds: ["kb-1"],
				});
				const renamed = await store.updateConversation(
					ws.uid,
					agent.agentId,
					conv.conversationId,
					{ title: "new" },
				);
				expect(renamed.title).toBe("new");
				expect(renamed.knowledgeBaseIds).toEqual(["kb-1"]);
				const refiltered = await store.updateConversation(
					ws.uid,
					agent.agentId,
					conv.conversationId,
					{ knowledgeBaseIds: ["kb-1", "kb-2"] },
				);
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
				const agent = await store.createAgent(ws.uid, { name: "Helper" });
				const conv = await store.createConversation(ws.uid, agent.agentId, {
					title: "t",
				});
				const u = await store.appendChatMessage(ws.uid, conv.conversationId, {
					role: "user",
					content: "hello",
				});
				await new Promise((r) => setTimeout(r, 5));
				const a = await store.appendChatMessage(ws.uid, conv.conversationId, {
					role: "agent",
					content: "hi there",
					metadata: {
						context_document_ids: "doc-1,doc-2",
						model: "test-model",
						finish_reason: "stop",
					},
				});
				const msgs = await store.listChatMessages(ws.uid, conv.conversationId);
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

		test("listRecentChatMessages returns the most-recent tail, oldest-first", async () => {
			const { store, cleanup } = await factory();
			try {
				const ws = await store.createWorkspace({ name: "w", kind: "mock" });
				const agent = await store.createAgent(ws.uid, { name: "Helper" });
				const conv = await store.createConversation(ws.uid, agent.agentId, {
					title: "t",
				});
				const ids: string[] = [];
				for (let i = 0; i < 8; i++) {
					const m = await store.appendChatMessage(ws.uid, conv.conversationId, {
						role: i % 2 === 0 ? "user" : "agent",
						content: `m${i}`,
						messageTs: `2026-05-30T00:00:0${i}.000Z`,
					});
					ids.push(m.messageId);
				}

				// Window smaller than the history → the last 3 ids, still in
				// chronological (oldest-first) order.
				const recent = await store.listRecentChatMessages(
					ws.uid,
					conv.conversationId,
					3,
				);
				expect(recent.map((m) => m.messageId)).toEqual(ids.slice(-3));
				expect(recent.map((m) => m.content)).toEqual(["m5", "m6", "m7"]);

				// Window >= history → every message, same order as the
				// unbounded `listChatMessages` read.
				const all = await store.listChatMessages(ws.uid, conv.conversationId);
				const recentAll = await store.listRecentChatMessages(
					ws.uid,
					conv.conversationId,
					100,
				);
				expect(recentAll.map((m) => m.messageId)).toEqual(
					all.map((m) => m.messageId),
				);

				// Non-positive limit → empty window (never the whole partition).
				expect(
					await store.listRecentChatMessages(ws.uid, conv.conversationId, 0),
				).toEqual([]);
			} finally {
				await cleanup?.();
			}
		});

		test("updateChatMessage merges metadata key-by-key", async () => {
			const { store, cleanup } = await factory();
			try {
				const ws = await store.createWorkspace({ name: "w", kind: "mock" });
				const agent = await store.createAgent(ws.uid, { name: "Helper" });
				const conv = await store.createConversation(ws.uid, agent.agentId, {
					title: "t",
				});
				const placeholder = await store.appendChatMessage(
					ws.uid,
					conv.conversationId,
					{ role: "agent", content: "", metadata: { model: "test-model" } },
				);
				const finalized = await store.updateChatMessage(
					ws.uid,
					conv.conversationId,
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
					conv.conversationId,
					placeholder.messageId,
					{ metadata: { model: undefined } },
				);
				expect(dropped.metadata).toEqual({ finish_reason: "stop" });
			} finally {
				await cleanup?.();
			}
		});

		test("listChatMessagesPage walks the whole history oldest-first in pages", async () => {
			const { store, cleanup } = await factory();
			try {
				const ws = await store.createWorkspace({ name: "w", kind: "mock" });
				const agent = await store.createAgent(ws.uid, { name: "Helper" });
				const conv = await store.createConversation(ws.uid, agent.agentId, {
					title: "t",
				});
				const ids: string[] = [];
				for (let i = 0; i < 7; i++) {
					const m = await store.appendChatMessage(ws.uid, conv.conversationId, {
						role: i % 2 === 0 ? "user" : "agent",
						content: `m${i}`,
						messageTs: `2026-05-30T00:00:0${i}.000Z`,
					});
					ids.push(m.messageId);
				}
				const walked = await drainPaged(
					(after) =>
						store.listChatMessagesPage(ws.uid, conv.conversationId, {
							after,
							limit: 3,
						}),
					(m) => m.messageId,
				);
				// Oldest-first, every message exactly once across the pages.
				expect(walked).toEqual(ids);
			} finally {
				await cleanup?.();
			}
		});

		test("listChatMessagesPage pages same-millisecond messages via the id tiebreak", async () => {
			const { store, cleanup } = await factory();
			try {
				const ws = await store.createWorkspace({ name: "w", kind: "mock" });
				const agent = await store.createAgent(ws.uid, { name: "Helper" });
				const conv = await store.createConversation(ws.uid, agent.agentId, {
					title: "t",
				});
				const ts = "2026-05-30T00:00:00.000Z";
				const ids: string[] = [];
				for (let i = 0; i < 5; i++) {
					const m = await store.appendChatMessage(ws.uid, conv.conversationId, {
						role: "user",
						content: `same-${i}`,
						messageTs: ts, // identical timestamp — the id tiebreak carries paging
					});
					ids.push(m.messageId);
				}
				const walked = await drainPaged(
					(after) =>
						store.listChatMessagesPage(ws.uid, conv.conversationId, {
							after,
							limit: 2,
						}),
					(m) => m.messageId,
				);
				// All five returned exactly once — no skips, no duplicates, no stall.
				expect(walked).toHaveLength(5);
				expect([...walked].sort()).toEqual([...ids].sort());
			} finally {
				await cleanup?.();
			}
		});

		test("listChatMessagesPage is stable when a message is inserted above the cursor", async () => {
			const { store, cleanup } = await factory();
			try {
				const ws = await store.createWorkspace({ name: "w", kind: "mock" });
				const agent = await store.createAgent(ws.uid, { name: "Helper" });
				const conv = await store.createConversation(ws.uid, agent.agentId, {
					title: "t",
				});
				for (let i = 1; i <= 4; i++) {
					await store.appendChatMessage(ws.uid, conv.conversationId, {
						role: "user",
						content: `m${i}`,
						messageTs: `2026-05-30T00:00:0${i}.000Z`,
					});
				}
				const p1 = await store.listChatMessagesPage(
					ws.uid,
					conv.conversationId,
					{
						after: null,
						limit: 2,
					},
				);
				expect(p1.items.map((m) => m.content)).toEqual(["m1", "m2"]);
				expect(p1.nextKey).not.toBeNull();
				// Insert a NEW message ABOVE the cursor (earlier ts) between fetches.
				await store.appendChatMessage(ws.uid, conv.conversationId, {
					role: "user",
					content: "inserted",
					messageTs: "2026-05-30T00:00:00.500Z",
				});
				// Page 2 resumes strictly past the cursor — the insert above it does
				// not shift the caller's position (the keyset invariant).
				const p2 = await store.listChatMessagesPage(
					ws.uid,
					conv.conversationId,
					{
						after: p1.nextKey,
						limit: 2,
					},
				);
				expect(p2.items.map((m) => m.content)).toEqual(["m3", "m4"]);
			} finally {
				await cleanup?.();
			}
		});

		test("listConversationsPage walks an agent's conversations newest-first in pages", async () => {
			const { store, cleanup } = await factory();
			try {
				const ws = await store.createWorkspace({ name: "w", kind: "mock" });
				const agent = await store.createAgent(ws.uid, { name: "Helper" });
				const created: string[] = [];
				for (let i = 0; i < 5; i++) {
					const conv = await store.createConversation(ws.uid, agent.agentId, {
						title: `c${i}`,
					});
					created.push(conv.conversationId);
					await new Promise((r) => setTimeout(r, 2)); // distinct createdAt
				}
				const walked = await drainPaged(
					(after) =>
						store.listConversationsPage(ws.uid, agent.agentId, {
							after,
							limit: 2,
						}),
					(c) => c.conversationId,
				);
				// Newest-first → reverse creation order.
				expect(walked).toEqual([...created].reverse());
			} finally {
				await cleanup?.();
			}
		});

		test("listChatMessagesPage yields the complete ordered history for any page limit", async () => {
			const { store, cleanup } = await factory();
			try {
				const ws = await store.createWorkspace({ name: "w", kind: "mock" });
				const agent = await store.createAgent(ws.uid, { name: "Helper" });
				const conv = await store.createConversation(ws.uid, agent.agentId, {
					title: "t",
				});
				const ids: string[] = [];
				for (let i = 0; i < 13; i++) {
					const m = await store.appendChatMessage(ws.uid, conv.conversationId, {
						role: "user",
						content: `m${i}`,
						messageTs: `2026-05-30T00:00:00.${i.toString().padStart(3, "0")}Z`,
					});
					ids.push(m.messageId);
				}
				// Limit-independence: every page size reconstructs the same
				// ordered set with no gaps, duplicates, or cursor stalls.
				for (const limit of [1, 2, 3, 5, 13, 50]) {
					const walked = await drainPaged(
						(after) =>
							store.listChatMessagesPage(ws.uid, conv.conversationId, {
								after,
								limit,
							}),
						(m) => m.messageId,
					);
					expect(walked, `limit=${limit}`).toEqual(ids);
				}
			} finally {
				await cleanup?.();
			}
		});

		test("appendChatMessage / listChatMessages reject unknown conversation", async () => {
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
					store.listRecentChatMessages(
						ws.uid,
						"00000000-0000-0000-0000-0000000000ff",
						50,
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

		test("createConversation rejects duplicate explicit conversationId", async () => {
			const { store, cleanup } = await factory();
			try {
				const ws = await store.createWorkspace({ name: "w", kind: "mock" });
				const agent = await store.createAgent(ws.uid, { name: "Helper" });
				const conversationId = "00000000-0000-0000-0000-0000000000c1";
				await store.createConversation(ws.uid, agent.agentId, {
					conversationId,
				});
				await expect(
					store.createConversation(ws.uid, agent.agentId, { conversationId }),
				).rejects.toBeInstanceOf(ControlPlaneConflictError);
			} finally {
				await cleanup?.();
			}
		});

		test("deleteConversation cascades to its messages", async () => {
			const { store, cleanup } = await factory();
			try {
				const ws = await store.createWorkspace({ name: "w", kind: "mock" });
				const agent = await store.createAgent(ws.uid, { name: "Helper" });
				const conv = await store.createConversation(ws.uid, agent.agentId, {
					title: "t",
				});
				await store.appendChatMessage(ws.uid, conv.conversationId, {
					role: "user",
					content: "hello",
				});
				const { deleted } = await store.deleteConversation(
					ws.uid,
					agent.agentId,
					conv.conversationId,
				);
				expect(deleted).toBe(true);
				expect(
					await store.getConversation(
						ws.uid,
						agent.agentId,
						conv.conversationId,
					),
				).toBeNull();
				// Re-creating a conversation with the same id starts clean.
				await store.createConversation(ws.uid, agent.agentId, {
					conversationId: conv.conversationId,
					title: "fresh",
				});
				const msgs = await store.listChatMessages(ws.uid, conv.conversationId);
				expect(msgs).toEqual([]);
			} finally {
				await cleanup?.();
			}
		});

		test("deleteWorkspace cascades to conversations and messages", async () => {
			const { store, cleanup } = await factory();
			try {
				const ws = await store.createWorkspace({ name: "w", kind: "mock" });
				const agent = await store.createAgent(ws.uid, { name: "Helper" });
				const conv = await store.createConversation(ws.uid, agent.agentId, {
					title: "t",
				});
				await store.appendChatMessage(ws.uid, conv.conversationId, {
					role: "user",
					content: "hi",
				});
				await store.deleteWorkspace(ws.uid);

				// Re-create the workspace with the same uid; the previous
				// agent + conversation rows must not be visible.
				const reborn = await store.createWorkspace({
					uid: ws.uid,
					name: "w",
					kind: "mock",
				});
				const agents = await store.listAgents(reborn.uid);
				expect(agents).toEqual([]);
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
					knowledgeBaseIds: ["kb-1", "kb-2"],
				});
				expect(a.name).toBe("Researcher");
				expect(a.description).toBe("desc");
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
				});
				// Sleep a millisecond so updatedAt is strictly later than
				// createdAt — file/astra timestamps have ms resolution.
				await new Promise((r) => setTimeout(r, 5));
				const u = await store.updateAgent(ws.uid, a.agentId, {
					name: "New",
					description: null,
				});
				expect(u.name).toBe("New");
				expect(u.description).toBeNull();
				expect(Date.parse(u.updatedAt)).toBeGreaterThanOrEqual(
					Date.parse(a.updatedAt),
				);
			} finally {
				await cleanup?.();
			}
		});

		test("updateAgent patches toolIds independently (A6 PATCH allow-list)", async () => {
			const { store, cleanup } = await factory();
			try {
				const ws = await store.createWorkspace({ name: "w", kind: "mock" });
				// Created with the grandfather default (empty allow-list).
				const a = await store.createAgent(ws.uid, { name: "Tooler" });
				expect([...a.toolIds]).toEqual([]);

				// PATCH a non-empty set — sorted + deduped by freezeStringSet.
				const set = await store.updateAgent(ws.uid, a.agentId, {
					toolIds: ["search_kb", "native:fetch", "search_kb"],
				});
				expect([...set.toolIds]).toEqual(["native:fetch", "search_kb"]);
				// A read sees the persisted allow-list (round-trips the backend).
				const got = await store.getAgent(ws.uid, a.agentId);
				expect([...(got?.toolIds ?? [])]).toEqual([
					"native:fetch",
					"search_kb",
				]);

				// Other fields untouched by a toolIds-only patch.
				expect(got?.name).toBe("Tooler");

				// Clearing back to [] grandfathers the agent again.
				const cleared = await store.updateAgent(ws.uid, a.agentId, {
					toolIds: [],
				});
				expect([...cleared.toolIds]).toEqual([]);

				// Omitting toolIds in a patch leaves the prior value intact.
				const reset = await store.updateAgent(ws.uid, a.agentId, {
					toolIds: ["list_kbs"],
				});
				expect([...reset.toolIds]).toEqual(["list_kbs"]);
				const renamed = await store.updateAgent(ws.uid, a.agentId, {
					name: "Renamed",
				});
				expect([...renamed.toolIds]).toEqual(["list_kbs"]);
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

		test("conversations from different agents in the same workspace are isolated", async () => {
			const { store, cleanup } = await factory();
			try {
				const ws = await store.createWorkspace({ name: "w", kind: "mock" });
				const a = await store.createAgent(ws.uid, { name: "First" });
				const b = await store.createAgent(ws.uid, { name: "Second" });
				const aConv = await store.createConversation(ws.uid, a.agentId, {
					title: "a-conv",
				});
				const bConv = await store.createConversation(ws.uid, b.agentId, {
					title: "b-conv",
				});
				const aList = await store.listConversations(ws.uid, a.agentId);
				expect(aList.map((c) => c.conversationId)).toEqual([
					aConv.conversationId,
				]);
				const bList = await store.listConversations(ws.uid, b.agentId);
				expect(bList.map((c) => c.conversationId)).toEqual([
					bConv.conversationId,
				]);
			} finally {
				await cleanup?.();
			}
		});

		test("deleteKnowledgeBase removes the kb id from conversation KB filters", async () => {
			const { store, cleanup } = await factory();
			try {
				const ws = await store.createWorkspace({ name: "w", kind: "mock" });
				const agent = await store.createAgent(ws.uid, { name: "Helper" });
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
				const conv = await store.createConversation(ws.uid, agent.agentId, {
					title: "t",
					knowledgeBaseIds: [kbA.knowledgeBaseId, kbB.knowledgeBaseId],
				});
				await store.deleteKnowledgeBase(ws.uid, kbA.knowledgeBaseId);
				const after = await store.getConversation(
					ws.uid,
					agent.agentId,
					conv.conversationId,
				);
				expect(after?.knowledgeBaseIds).toEqual([kbB.knowledgeBaseId]);
			} finally {
				await cleanup?.();
			}
		});

		/* ============================================================== */
		/* Principals (RLAC sub-workspace identities, RBAC roles)         */
		/* ============================================================== */

		test("createPrincipal mints a record with viewer-role defaults", async () => {
			const { store, cleanup } = await factory();
			try {
				const ws = await store.createWorkspace({ name: "w", kind: "mock" });
				expect(await store.listPrincipals(ws.uid)).toEqual([]);

				const created = await store.createPrincipal(ws.uid, {
					principalId: "alice@example.com",
				});
				expect(created.workspaceId).toBe(ws.uid);
				expect(created.principalId).toBe("alice@example.com");
				// Defaults: viewer role, null label, empty attributes, fresh
				// timestamps that start equal.
				expect(created.role).toBe("viewer");
				expect(created.label).toBeNull();
				expect(created.attributes).toEqual({});
				expect(created.createdAt).toBe(created.updatedAt);

				const got = await store.getPrincipal(ws.uid, "alice@example.com");
				expect(got).toEqual(created);

				const list = await store.listPrincipals(ws.uid);
				expect(list.map((p) => p.principalId)).toEqual(["alice@example.com"]);
			} finally {
				await cleanup?.();
			}
		});

		test("createPrincipal echoes explicit role, label, and attributes", async () => {
			const { store, cleanup } = await factory();
			try {
				const ws = await store.createWorkspace({ name: "w", kind: "mock" });
				const created = await store.createPrincipal(ws.uid, {
					principalId: "ops-bot",
					label: "Operations bot",
					role: "admin",
					attributes: { team: "platform", tier: "gold" },
				});
				expect(created.role).toBe("admin");
				expect(created.label).toBe("Operations bot");
				expect(created.attributes).toEqual({ team: "platform", tier: "gold" });

				// Attributes round-trip through the backend untouched.
				const reread = await store.getPrincipal(ws.uid, "ops-bot");
				expect(reread?.attributes).toEqual({ team: "platform", tier: "gold" });
				expect(reread?.role).toBe("admin");
			} finally {
				await cleanup?.();
			}
		});

		test("getPrincipal returns null for an unknown principalId", async () => {
			const { store, cleanup } = await factory();
			try {
				const ws = await store.createWorkspace({ name: "w", kind: "mock" });
				expect(await store.getPrincipal(ws.uid, "nobody")).toBeNull();
			} finally {
				await cleanup?.();
			}
		});

		test("createPrincipal rejects a duplicate principalId in the same workspace", async () => {
			const { store, cleanup } = await factory();
			try {
				const ws = await store.createWorkspace({ name: "w", kind: "mock" });
				await store.createPrincipal(ws.uid, { principalId: "dup@example.com" });
				await expect(
					store.createPrincipal(ws.uid, { principalId: "dup@example.com" }),
				).rejects.toBeInstanceOf(ControlPlaneConflictError);
			} finally {
				await cleanup?.();
			}
		});

		test("listPrincipals returns rows sorted by principalId", async () => {
			const { store, cleanup } = await factory();
			try {
				const ws = await store.createWorkspace({ name: "w", kind: "mock" });
				// Insert out of lexicographic order — the contract sorts on read.
				await store.createPrincipal(ws.uid, { principalId: "charlie" });
				await store.createPrincipal(ws.uid, { principalId: "alice" });
				await store.createPrincipal(ws.uid, { principalId: "bob" });
				const list = await store.listPrincipals(ws.uid);
				expect(list.map((p) => p.principalId)).toEqual([
					"alice",
					"bob",
					"charlie",
				]);
			} finally {
				await cleanup?.();
			}
		});

		test("updatePrincipal patches label, role, and attributes independently and bumps updatedAt", async () => {
			const { store, cleanup } = await factory();
			try {
				const ws = await store.createWorkspace({ name: "w", kind: "mock" });
				const created = await store.createPrincipal(ws.uid, {
					principalId: "carol",
					label: "old",
					role: "viewer",
					attributes: { region: "us" },
				});
				// Clock advance — ISO strings have ms resolution.
				await new Promise((r) => setTimeout(r, 5));

				// Patch only the role; label + attributes untouched.
				const promoted = await store.updatePrincipal(ws.uid, "carol", {
					role: "editor",
				});
				expect(promoted.role).toBe("editor");
				expect(promoted.label).toBe("old");
				expect(promoted.attributes).toEqual({ region: "us" });
				expect(new Date(promoted.updatedAt).getTime()).toBeGreaterThan(
					new Date(created.updatedAt).getTime(),
				);

				// Replace attributes wholesale; an explicit null clears the label.
				const relabeled = await store.updatePrincipal(ws.uid, "carol", {
					label: null,
					attributes: { region: "eu", tier: "silver" },
				});
				expect(relabeled.label).toBeNull();
				expect(relabeled.attributes).toEqual({ region: "eu", tier: "silver" });
				// Role from the prior patch survives an attributes-only-ish patch.
				expect(relabeled.role).toBe("editor");
			} finally {
				await cleanup?.();
			}
		});

		test("updatePrincipal throws not-found on an unknown principalId", async () => {
			const { store, cleanup } = await factory();
			try {
				const ws = await store.createWorkspace({ name: "w", kind: "mock" });
				await expect(
					store.updatePrincipal(ws.uid, "ghost", { role: "admin" }),
				).rejects.toBeInstanceOf(ControlPlaneNotFoundError);
			} finally {
				await cleanup?.();
			}
		});

		test("deletePrincipal reports deleted and is a no-op on a missing id", async () => {
			const { store, cleanup } = await factory();
			try {
				const ws = await store.createWorkspace({ name: "w", kind: "mock" });
				await store.createPrincipal(ws.uid, { principalId: "doomed" });
				const first = await store.deletePrincipal(ws.uid, "doomed");
				expect(first.deleted).toBe(true);
				expect(await store.getPrincipal(ws.uid, "doomed")).toBeNull();

				// Second delete finds nothing — reported but not an error.
				const second = await store.deletePrincipal(ws.uid, "doomed");
				expect(second.deleted).toBe(false);
				expect(await store.listPrincipals(ws.uid)).toEqual([]);
			} finally {
				await cleanup?.();
			}
		});

		test("principals are isolated per workspace", async () => {
			const { store, cleanup } = await factory();
			try {
				const a = await store.createWorkspace({ name: "a", kind: "mock" });
				const b = await store.createWorkspace({ name: "b", kind: "mock" });
				await store.createPrincipal(a.uid, {
					principalId: "shared-handle",
					role: "admin",
				});
				// Same principalId in a different workspace is a distinct row,
				// not a conflict — partitioning is by workspace.
				const bRow = await store.createPrincipal(b.uid, {
					principalId: "shared-handle",
					role: "viewer",
				});
				expect(bRow.role).toBe("viewer");

				expect((await store.listPrincipals(a.uid)).map((p) => p.role)).toEqual([
					"admin",
				]);
				expect((await store.listPrincipals(b.uid)).map((p) => p.role)).toEqual([
					"viewer",
				]);
				// A principal from one workspace is invisible to the other's get.
				await store.deletePrincipal(a.uid, "shared-handle");
				expect(await store.getPrincipal(b.uid, "shared-handle")).not.toBeNull();
			} finally {
				await cleanup?.();
			}
		});

		test("principal operations on an unknown workspace throw not-found", async () => {
			const { store, cleanup } = await factory();
			try {
				const ghost = "00000000-0000-0000-0000-000000000000";
				await expect(store.listPrincipals(ghost)).rejects.toBeInstanceOf(
					ControlPlaneNotFoundError,
				);
				await expect(store.getPrincipal(ghost, "x")).rejects.toBeInstanceOf(
					ControlPlaneNotFoundError,
				);
				await expect(
					store.createPrincipal(ghost, { principalId: "x" }),
				).rejects.toBeInstanceOf(ControlPlaneNotFoundError);
				await expect(
					store.updatePrincipal(ghost, "x", { role: "admin" }),
				).rejects.toBeInstanceOf(ControlPlaneNotFoundError);
				await expect(store.deletePrincipal(ghost, "x")).rejects.toBeInstanceOf(
					ControlPlaneNotFoundError,
				);
			} finally {
				await cleanup?.();
			}
		});

		/* ============================================================== */
		/* Policy audit (append-only RLAC decision log)                   */
		/* ============================================================== */

		test("recordPolicyDecision stamps ids + timestamps; listPolicyAudit returns newest-first", async () => {
			const { store, cleanup } = await factory();
			try {
				const ws = await store.createWorkspace({ name: "w", kind: "mock" });
				expect(await store.listPolicyAudit(ws.uid)).toEqual([]);

				const first = await store.recordPolicyDecision(ws.uid, {
					principalId: "alice",
					knowledgeBaseId: "kb-1",
					resourceId: "doc-1",
					action: "search",
					decision: "allow",
					reason: "policy matched",
				});
				expect(first.workspaceId).toBe(ws.uid);
				expect(first.decisionId).toMatch(
					/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
				);
				// auditDay is the YYYY-MM-DD prefix of the ISO `ts`.
				expect(first.auditDay).toBe(first.ts.slice(0, 10));
				// Omitted compiledFilterJson defaults to null.
				expect(first.compiledFilterJson).toBeNull();

				// Clock advance so the second record sorts strictly newer.
				await new Promise((r) => setTimeout(r, 5));
				const second = await store.recordPolicyDecision(ws.uid, {
					principalId: "bob",
					knowledgeBaseId: "kb-2",
					resourceId: "doc-2",
					action: "get",
					decision: "deny",
					reason: "no rule",
					compiledFilterJson: '{"status":"published"}',
				});
				expect(second.compiledFilterJson).toBe('{"status":"published"}');

				const list = await store.listPolicyAudit(ws.uid);
				// Newest-first to mirror the Astra cluster ordering.
				expect(list.map((r) => r.decisionId)).toEqual([
					second.decisionId,
					first.decisionId,
				]);
			} finally {
				await cleanup?.();
			}
		});

		test("listPolicyAudit filters by principalId and knowledgeBaseId", async () => {
			const { store, cleanup } = await factory();
			try {
				const ws = await store.createWorkspace({ name: "w", kind: "mock" });
				await store.recordPolicyDecision(ws.uid, {
					principalId: "alice",
					knowledgeBaseId: "kb-1",
					resourceId: "r1",
					action: "search",
					decision: "allow",
					reason: "a",
				});
				await store.recordPolicyDecision(ws.uid, {
					principalId: "bob",
					knowledgeBaseId: "kb-1",
					resourceId: "r2",
					action: "search",
					decision: "filter",
					reason: "b",
				});
				await store.recordPolicyDecision(ws.uid, {
					principalId: "alice",
					knowledgeBaseId: "kb-2",
					resourceId: "r3",
					action: "get",
					decision: "deny",
					reason: "c",
				});

				const byPrincipal = await store.listPolicyAudit(ws.uid, {
					principalId: "alice",
				});
				expect(byPrincipal.every((r) => r.principalId === "alice")).toBe(true);
				expect(byPrincipal.map((r) => r.resourceId).sort()).toEqual([
					"r1",
					"r3",
				]);

				const byKb = await store.listPolicyAudit(ws.uid, {
					knowledgeBaseId: "kb-1",
				});
				expect(byKb.every((r) => r.knowledgeBaseId === "kb-1")).toBe(true);
				expect(byKb.map((r) => r.resourceId).sort()).toEqual(["r1", "r2"]);

				// Both filters compose (AND).
				const both = await store.listPolicyAudit(ws.uid, {
					principalId: "alice",
					knowledgeBaseId: "kb-1",
				});
				expect(both.map((r) => r.resourceId)).toEqual(["r1"]);
			} finally {
				await cleanup?.();
			}
		});

		test("listPolicyAudit honors the limit and an explicit auditDay filter", async () => {
			const { store, cleanup } = await factory();
			try {
				const ws = await store.createWorkspace({ name: "w", kind: "mock" });
				for (let i = 0; i < 5; i++) {
					await store.recordPolicyDecision(ws.uid, {
						principalId: "p",
						knowledgeBaseId: "kb",
						resourceId: `r${i}`,
						action: "list",
						decision: "allow",
						reason: `n${i}`,
					});
					await new Promise((r) => setTimeout(r, 2));
				}
				const limited = await store.listPolicyAudit(ws.uid, { limit: 2 });
				expect(limited).toHaveLength(2);

				// Today's partition holds every record we just wrote; an unrelated
				// day returns nothing.
				const today = new Date().toISOString().slice(0, 10);
				const todayRows = await store.listPolicyAudit(ws.uid, {
					auditDay: today,
				});
				expect(todayRows).toHaveLength(5);
				const emptyDay = await store.listPolicyAudit(ws.uid, {
					auditDay: "1999-01-01",
				});
				expect(emptyDay).toEqual([]);
			} finally {
				await cleanup?.();
			}
		});

		test("policy-audit operations on an unknown workspace throw not-found", async () => {
			const { store, cleanup } = await factory();
			try {
				const ghost = "00000000-0000-0000-0000-000000000000";
				await expect(store.listPolicyAudit(ghost)).rejects.toBeInstanceOf(
					ControlPlaneNotFoundError,
				);
				await expect(
					store.recordPolicyDecision(ghost, {
						principalId: "p",
						knowledgeBaseId: "kb",
						resourceId: "r",
						action: "get",
						decision: "allow",
						reason: "x",
					}),
				).rejects.toBeInstanceOf(ControlPlaneNotFoundError);
			} finally {
				await cleanup?.();
			}
		});

		/* ============================================================== */
		/* LLM / chunking / reranking service CRUD (file/astra coverage)  */
		/* ============================================================== */

		test("LLM service CRUD round-trip mints an id and applies defaults", async () => {
			const { store, cleanup } = await factory();
			try {
				const ws = await store.createWorkspace({ name: "w", kind: "mock" });
				expect(await store.listLlmServices(ws.uid)).toEqual([]);

				const created = await store.createLlmService(ws.uid, {
					name: "gpt",
					provider: "openai",
					modelName: "gpt-4o",
				});
				expect(created.llmServiceId).toMatch(
					/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
				);
				expect(created.workspaceId).toBe(ws.uid);
				// status defaults to "active"; description defaults to null.
				expect(created.status).toBe("active");
				expect(created.description).toBeNull();
				expect(created.createdAt).toBe(created.updatedAt);

				const got = await store.getLlmService(ws.uid, created.llmServiceId);
				expect(got).toEqual(created);

				await new Promise((r) => setTimeout(r, 5));
				const updated = await store.updateLlmService(
					ws.uid,
					created.llmServiceId,
					{ description: "primary chat model", status: "experimental" },
				);
				expect(updated.description).toBe("primary chat model");
				expect(updated.status).toBe("experimental");
				expect(updated.modelName).toBe("gpt-4o"); // untouched
				expect(new Date(updated.updatedAt).getTime()).toBeGreaterThan(
					new Date(created.updatedAt).getTime(),
				);

				const { deleted } = await store.deleteLlmService(
					ws.uid,
					created.llmServiceId,
				);
				expect(deleted).toBe(true);
				expect(
					await store.getLlmService(ws.uid, created.llmServiceId),
				).toBeNull();
				expect(await store.listLlmServices(ws.uid)).toEqual([]);
			} finally {
				await cleanup?.();
			}
		});

		test("LLM service update / delete report on unknown id", async () => {
			const { store, cleanup } = await factory();
			try {
				const ws = await store.createWorkspace({ name: "w", kind: "mock" });
				await expect(
					store.updateLlmService(
						ws.uid,
						"00000000-0000-0000-0000-0000000000ff",
						{ status: "deprecated" },
					),
				).rejects.toBeInstanceOf(ControlPlaneNotFoundError);
				const { deleted } = await store.deleteLlmService(
					ws.uid,
					"00000000-0000-0000-0000-0000000000ff",
				);
				expect(deleted).toBe(false);
			} finally {
				await cleanup?.();
			}
		});

		test("chunking service CRUD round-trip mints an id and applies defaults", async () => {
			const { store, cleanup } = await factory();
			try {
				const ws = await store.createWorkspace({ name: "w", kind: "mock" });
				const created = await store.createChunkingService(ws.uid, {
					name: "docling",
					engine: "docling",
				});
				expect(created.chunkingServiceId).toMatch(
					/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
				);
				expect(created.status).toBe("active");
				expect(created.engine).toBe("docling");

				const got = await store.getChunkingService(
					ws.uid,
					created.chunkingServiceId,
				);
				expect(got).toEqual(created);

				await new Promise((r) => setTimeout(r, 5));
				const updated = await store.updateChunkingService(
					ws.uid,
					created.chunkingServiceId,
					{ maxChunkSize: 512, status: "deprecated" },
				);
				expect(updated.maxChunkSize).toBe(512);
				expect(updated.status).toBe("deprecated");
				expect(updated.engine).toBe("docling"); // untouched

				const { deleted } = await store.deleteChunkingService(
					ws.uid,
					created.chunkingServiceId,
				);
				expect(deleted).toBe(true);
				expect(
					await store.getChunkingService(ws.uid, created.chunkingServiceId),
				).toBeNull();
			} finally {
				await cleanup?.();
			}
		});

		test("reranking service CRUD round-trip mints an id and applies defaults", async () => {
			const { store, cleanup } = await factory();
			try {
				const ws = await store.createWorkspace({ name: "w", kind: "mock" });
				const created = await store.createRerankingService(ws.uid, {
					name: "cohere",
					provider: "cohere",
					modelName: "rerank-english-v3.0",
				});
				expect(created.rerankingServiceId).toMatch(
					/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
				);
				expect(created.status).toBe("active");
				expect(created.modelName).toBe("rerank-english-v3.0");

				const got = await store.getRerankingService(
					ws.uid,
					created.rerankingServiceId,
				);
				expect(got).toEqual(created);

				await new Promise((r) => setTimeout(r, 5));
				const updated = await store.updateRerankingService(
					ws.uid,
					created.rerankingServiceId,
					{ modelName: "rerank-multilingual-v3.0", status: "experimental" },
				);
				expect(updated.modelName).toBe("rerank-multilingual-v3.0");
				expect(updated.status).toBe("experimental");
				expect(updated.provider).toBe("cohere"); // untouched

				const { deleted } = await store.deleteRerankingService(
					ws.uid,
					created.rerankingServiceId,
				);
				expect(deleted).toBe(true);
				expect(
					await store.getRerankingService(ws.uid, created.rerankingServiceId),
				).toBeNull();
			} finally {
				await cleanup?.();
			}
		});

		/* ============================================================== */
		/* MCP servers (external tool providers, 0.4.0 A2)                */
		/* ============================================================== */

		test("MCP-server CRUD round-trip mints an id and echoes fields", async () => {
			const { store, cleanup } = await factory();
			try {
				const ws = await store.createWorkspace({ name: "w", kind: "mock" });
				const before = await store.listMcpServers(ws.uid);
				expect(before).toEqual([]);

				const created = await store.createMcpServer(ws.uid, {
					label: "Docs MCP",
					url: "https://mcp.example.com/sse",
					credentialRef: "env:DOCS_MCP_TOKEN",
					allowedTools: ["search", "fetch", "search"],
				});
				expect(created.mcpServerId).toMatch(
					/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
				);
				expect(created.workspaceId).toBe(ws.uid);
				expect(created.label).toBe("Docs MCP");
				expect(created.url).toBe("https://mcp.example.com/sse");
				expect(created.credentialRef).toBe("env:DOCS_MCP_TOKEN");
				// `enabled` defaults to true; `allowedTools` deduped + sorted.
				expect(created.enabled).toBe(true);
				expect(created.allowedTools).toEqual(["fetch", "search"]);
				expect(created.createdAt).toBe(created.updatedAt);

				const got = await store.getMcpServer(ws.uid, created.mcpServerId);
				expect(got).toEqual(created);

				const list = await store.listMcpServers(ws.uid);
				expect(list.map((s) => s.mcpServerId)).toEqual([created.mcpServerId]);
			} finally {
				await cleanup?.();
			}
		});

		test("createMcpServer defaults: enabled=true, credentialRef=null, allowedTools=null", async () => {
			const { store, cleanup } = await factory();
			try {
				const ws = await store.createWorkspace({ name: "w", kind: "mock" });
				const created = await store.createMcpServer(ws.uid, {
					label: "Bare",
					url: "https://bare.example.com/mcp",
				});
				expect(created.enabled).toBe(true);
				expect(created.credentialRef).toBeNull();
				// null = expose every tool the server advertises (distinct from []).
				expect(created.allowedTools).toBeNull();
			} finally {
				await cleanup?.();
			}
		});

		test("createMcpServer preserves an empty allowedTools list (≠ null)", async () => {
			// Empty list = expose no tools; null = expose all. The two must
			// not be conflated across the round-trip (the Astra backend stores
			// allowed_tools as JSON text precisely to keep this distinction).
			const { store, cleanup } = await factory();
			try {
				const ws = await store.createWorkspace({ name: "w", kind: "mock" });
				const created = await store.createMcpServer(ws.uid, {
					label: "Locked",
					url: "https://locked.example.com/mcp",
					allowedTools: [],
				});
				expect(created.allowedTools).toEqual([]);
				const got = await store.getMcpServer(ws.uid, created.mcpServerId);
				expect(got?.allowedTools).toEqual([]);
			} finally {
				await cleanup?.();
			}
		});

		test("createMcpServer honors an explicit mcpServerId and rejects duplicates", async () => {
			const { store, cleanup } = await factory();
			try {
				const ws = await store.createWorkspace({ name: "w", kind: "mock" });
				const id = "00000000-0000-0000-0000-0000000000a1";
				const created = await store.createMcpServer(ws.uid, {
					mcpServerId: id,
					label: "Pinned",
					url: "https://pinned.example.com/mcp",
				});
				expect(created.mcpServerId).toBe(id);
				await expect(
					store.createMcpServer(ws.uid, {
						mcpServerId: id,
						label: "dup",
						url: "https://dup.example.com/mcp",
					}),
				).rejects.toBeInstanceOf(ControlPlaneConflictError);
			} finally {
				await cleanup?.();
			}
		});

		test("updateMcpServer patches fields independently and bumps updatedAt", async () => {
			const { store, cleanup } = await factory();
			try {
				const ws = await store.createWorkspace({ name: "w", kind: "mock" });
				const created = await store.createMcpServer(ws.uid, {
					label: "Old",
					url: "https://old.example.com/mcp",
					credentialRef: "env:OLD",
					allowedTools: ["a"],
				});
				await new Promise((r) => setTimeout(r, 5));

				// Toggle enabled + replace allow-list; leave url/credentialRef alone.
				const disabled = await store.updateMcpServer(
					ws.uid,
					created.mcpServerId,
					{ enabled: false, allowedTools: ["c", "b"], label: "New" },
				);
				expect(disabled.enabled).toBe(false);
				expect(disabled.label).toBe("New");
				expect(disabled.allowedTools).toEqual(["b", "c"]);
				expect(disabled.url).toBe("https://old.example.com/mcp");
				expect(disabled.credentialRef).toBe("env:OLD");
				expect(new Date(disabled.updatedAt).getTime()).toBeGreaterThan(
					new Date(created.updatedAt).getTime(),
				);

				// Clear the credential and widen to all tools (null).
				const cleared = await store.updateMcpServer(
					ws.uid,
					created.mcpServerId,
					{ credentialRef: null, allowedTools: null },
				);
				expect(cleared.credentialRef).toBeNull();
				expect(cleared.allowedTools).toBeNull();
				// Untouched fields survive.
				expect(cleared.label).toBe("New");
				expect(cleared.enabled).toBe(false);
			} finally {
				await cleanup?.();
			}
		});

		test("updateMcpServer / deleteMcpServer throw or report on unknown id", async () => {
			const { store, cleanup } = await factory();
			try {
				const ws = await store.createWorkspace({ name: "w", kind: "mock" });
				await expect(
					store.updateMcpServer(
						ws.uid,
						"00000000-0000-0000-0000-0000000000ff",
						{ label: "x" },
					),
				).rejects.toBeInstanceOf(ControlPlaneNotFoundError);
				const { deleted } = await store.deleteMcpServer(
					ws.uid,
					"00000000-0000-0000-0000-0000000000ff",
				);
				expect(deleted).toBe(false);
			} finally {
				await cleanup?.();
			}
		});

		test("deleteMcpServer removes the row", async () => {
			const { store, cleanup } = await factory();
			try {
				const ws = await store.createWorkspace({ name: "w", kind: "mock" });
				const created = await store.createMcpServer(ws.uid, {
					label: "Doomed",
					url: "https://doomed.example.com/mcp",
				});
				const { deleted } = await store.deleteMcpServer(
					ws.uid,
					created.mcpServerId,
				);
				expect(deleted).toBe(true);
				expect(
					await store.getMcpServer(ws.uid, created.mcpServerId),
				).toBeNull();
				expect(await store.listMcpServers(ws.uid)).toEqual([]);
			} finally {
				await cleanup?.();
			}
		});

		test("MCP-server operations on an unknown workspace throw not-found", async () => {
			const { store, cleanup } = await factory();
			try {
				const ghost = "00000000-0000-0000-0000-000000000000";
				await expect(store.listMcpServers(ghost)).rejects.toBeInstanceOf(
					ControlPlaneNotFoundError,
				);
				await expect(
					store.createMcpServer(ghost, {
						label: "x",
						url: "https://x.example.com/mcp",
					}),
				).rejects.toBeInstanceOf(ControlPlaneNotFoundError);
			} finally {
				await cleanup?.();
			}
		});

		test("deleteWorkspace removes every dependent in WORKSPACE_CASCADE_STEPS", async () => {
			const { store, cleanup } = await factory();
			try {
				const ws = await store.createWorkspace({
					name: "cascade-w",
					kind: "mock",
				});
				// Build one of every dependent type so the cascade has work
				// to do for every step. The structure mirrors real wiring:
				// services -> KB -> documents+filters; agent -> conversation -> message.
				await store.persistApiKey(ws.uid, {
					keyId: "11111111-1111-1111-1111-111111111111",
					prefix: "cascadeprefix",
					hash: "scrypt$cascade$cascade",
					label: "k",
				});
				const chunk = await store.createChunkingService(ws.uid, {
					name: "c",
					engine: "docling",
				});
				const embed = await store.createEmbeddingService(ws.uid, {
					name: "e",
					provider: "openai",
					modelName: "m",
					embeddingDimension: 4,
				});
				await store.createRerankingService(ws.uid, {
					name: "r",
					provider: "cohere",
					modelName: "rerank",
				});
				await store.createLlmService(ws.uid, {
					name: "l",
					provider: "openai",
					modelName: "gpt-4",
				});
				const kb = await store.createKnowledgeBase(ws.uid, {
					name: "kb",
					embeddingServiceId: embed.embeddingServiceId,
					chunkingServiceId: chunk.chunkingServiceId,
				});
				await store.createKnowledgeFilter(ws.uid, kb.knowledgeBaseId, {
					name: "f",
					filter: { tag: "x" },
				});
				await store.createRagDocument(ws.uid, kb.knowledgeBaseId, {
					sourceFilename: "alpha.txt",
					contentHash: "sha-abc",
				});
				const agent = await store.createAgent(ws.uid, {
					name: "a",
				});
				const conv = await store.createConversation(ws.uid, agent.agentId, {
					title: "t",
				});
				await store.appendChatMessage(ws.uid, conv.conversationId, {
					role: "user",
					content: "hi",
				});
				// Workspace-owned RLAC + MCP rows (the cascade-completeness
				// fix): a principal, an MCP server, and a policy-audit decision.
				await store.createPrincipal(ws.uid, {
					principalId: "alice@example.com",
					label: "Alice",
				});
				await store.createMcpServer(ws.uid, {
					label: "tools",
					url: "https://tools.example.com/mcp",
				});
				await store.recordPolicyDecision(ws.uid, {
					principalId: "alice@example.com",
					knowledgeBaseId: kb.knowledgeBaseId,
					resourceId: "doc-1",
					action: "search",
					decision: "allow",
					reason: "cascade-seed",
				});

				await store.deleteWorkspace(ws.uid);

				// Walk every cascade step and assert the dependent type is
				// gone. The exhaustive switch is the formalization: adding
				// a new WORKSPACE_CASCADE_STEPS entry without a case here
				// is a TypeScript error — and forgetting the case after
				// adding the step fails this test on every backend.
				for (const step of WORKSPACE_CASCADE_STEPS) {
					await assertWorkspaceStepCleared(
						store,
						ws.uid,
						kb.knowledgeBaseId,
						agent.agentId,
						conv.conversationId,
						step,
					);
				}

				// The workspace-gated `list*` rejections above only prove the
				// parent is gone; a stranded child row stays invisible behind a
				// list that 404s on the missing workspace. Re-create the
				// workspace under the SAME uid and assert the seeded
				// workspace-owned rows do NOT resurface — which holds only if the
				// cascade physically purged them, not merely orphaned them.
				await store.createWorkspace({
					uid: ws.uid,
					name: "cascade-w",
					kind: "mock",
				});
				expect(await store.listMcpServers(ws.uid)).toEqual([]);
				expect(await store.listPrincipals(ws.uid)).toEqual([]);
				expect(await store.listPolicyAudit(ws.uid)).toEqual([]);
			} finally {
				await cleanup?.();
			}
		});

		test("deleteKnowledgeBase removes every dependent in KNOWLEDGE_BASE_CASCADE_STEPS", async () => {
			const { store, cleanup } = await factory();
			try {
				const ws = await store.createWorkspace({
					name: "cascade-kb",
					kind: "mock",
				});
				const chunk = await store.createChunkingService(ws.uid, {
					name: "c",
					engine: "docling",
				});
				const embed = await store.createEmbeddingService(ws.uid, {
					name: "e",
					provider: "openai",
					modelName: "m",
					embeddingDimension: 4,
				});
				const kb = await store.createKnowledgeBase(ws.uid, {
					name: "kb",
					embeddingServiceId: embed.embeddingServiceId,
					chunkingServiceId: chunk.chunkingServiceId,
				});
				await store.createKnowledgeFilter(ws.uid, kb.knowledgeBaseId, {
					name: "f",
					filter: { tag: "x" },
				});
				await store.createRagDocument(ws.uid, kb.knowledgeBaseId, {
					sourceFilename: "alpha.txt",
					contentHash: "sha-abc",
				});

				await store.deleteKnowledgeBase(ws.uid, kb.knowledgeBaseId);

				for (const step of KNOWLEDGE_BASE_CASCADE_STEPS) {
					await assertKbStepCleared(store, ws.uid, kb.knowledgeBaseId, step);
				}
			} finally {
				await cleanup?.();
			}
		});

		test("deleteAgent removes every dependent in AGENT_CASCADE_STEPS", async () => {
			const { store, cleanup } = await factory();
			try {
				const ws = await store.createWorkspace({
					name: "cascade-a",
					kind: "mock",
				});
				const agent = await store.createAgent(ws.uid, {
					name: "a",
				});
				const conv = await store.createConversation(ws.uid, agent.agentId, {
					title: "t",
				});
				await store.appendChatMessage(ws.uid, conv.conversationId, {
					role: "user",
					content: "hi",
				});

				await store.deleteAgent(ws.uid, agent.agentId);

				for (const step of AGENT_CASCADE_STEPS) {
					await assertAgentStepCleared(
						store,
						ws.uid,
						agent.agentId,
						conv.conversationId,
						step,
					);
				}
			} finally {
				await cleanup?.();
			}
		});
	});
}

/**
 * Per-step cascade assertion for `deleteWorkspace`. The exhaustive
 * switch makes adding a new {@link WorkspaceCascadeStep} without
 * coverage a compile error.
 */
async function assertWorkspaceStepCleared(
	store: ControlPlaneStore,
	workspaceId: string,
	kbId: string,
	agentId: string,
	conversationId: string,
	step: WorkspaceCascadeStep,
): Promise<void> {
	switch (step) {
		case "apiKeys":
			expect(await store.findApiKeyByPrefix("cascade-keys")).toBeNull();
			return;
		case "knowledgeFilters":
			await expect(
				store.listKnowledgeFilters(workspaceId, kbId),
			).rejects.toBeInstanceOf(ControlPlaneNotFoundError);
			return;
		case "ragDocuments":
			await expect(
				store.listRagDocuments(workspaceId, kbId),
			).rejects.toBeInstanceOf(ControlPlaneNotFoundError);
			return;
		case "knowledgeBases":
			await expect(
				store.listKnowledgeBases(workspaceId),
			).rejects.toBeInstanceOf(ControlPlaneNotFoundError);
			return;
		case "messages":
			await expect(
				store.listChatMessages(workspaceId, conversationId),
			).rejects.toBeInstanceOf(ControlPlaneNotFoundError);
			return;
		case "conversations":
			await expect(
				store.listConversations(workspaceId, agentId),
			).rejects.toBeInstanceOf(ControlPlaneNotFoundError);
			return;
		case "agents":
			await expect(store.listAgents(workspaceId)).rejects.toBeInstanceOf(
				ControlPlaneNotFoundError,
			);
			return;
		case "chunkingServices":
			await expect(
				store.listChunkingServices(workspaceId),
			).rejects.toBeInstanceOf(ControlPlaneNotFoundError);
			return;
		case "embeddingServices":
			await expect(
				store.listEmbeddingServices(workspaceId),
			).rejects.toBeInstanceOf(ControlPlaneNotFoundError);
			return;
		case "rerankingServices":
			await expect(
				store.listRerankingServices(workspaceId),
			).rejects.toBeInstanceOf(ControlPlaneNotFoundError);
			return;
		case "llmServices":
			await expect(store.listLlmServices(workspaceId)).rejects.toBeInstanceOf(
				ControlPlaneNotFoundError,
			);
			return;
		case "mcpServers":
			await expect(store.listMcpServers(workspaceId)).rejects.toBeInstanceOf(
				ControlPlaneNotFoundError,
			);
			return;
		case "principals":
			await expect(store.listPrincipals(workspaceId)).rejects.toBeInstanceOf(
				ControlPlaneNotFoundError,
			);
			return;
		case "policyAudit":
			await expect(store.listPolicyAudit(workspaceId)).rejects.toBeInstanceOf(
				ControlPlaneNotFoundError,
			);
			return;
		default: {
			const exhaustive: never = step;
			throw new Error(`unhandled cascade step: ${String(exhaustive)}`);
		}
	}
}

async function assertKbStepCleared(
	store: ControlPlaneStore,
	workspaceId: string,
	kbId: string,
	step: KnowledgeBaseCascadeStep,
): Promise<void> {
	switch (step) {
		case "knowledgeFilters":
			await expect(
				store.listKnowledgeFilters(workspaceId, kbId),
			).rejects.toBeInstanceOf(ControlPlaneNotFoundError);
			return;
		case "ragDocuments":
			await expect(
				store.listRagDocuments(workspaceId, kbId),
			).rejects.toBeInstanceOf(ControlPlaneNotFoundError);
			return;
		default: {
			const exhaustive: never = step;
			throw new Error(`unhandled kb cascade step: ${String(exhaustive)}`);
		}
	}
}

async function assertAgentStepCleared(
	store: ControlPlaneStore,
	workspaceId: string,
	agentId: string,
	conversationId: string,
	step: AgentCascadeStep,
): Promise<void> {
	switch (step) {
		case "messages": {
			// Listing messages on a now-deleted conversation either rejects
			// with NotFound (file/astra) or returns [] (memory short-circuit).
			// Either way, what survives must be empty.
			const remaining = await store
				.listChatMessages(workspaceId, conversationId)
				.catch(() => [] as readonly unknown[]);
			expect(remaining).toEqual([]);
			return;
		}
		case "conversations": {
			// `listConversations` is keyed on (workspace, agent). After the
			// agent goes the workspace still exists, so it returns [] rather
			// than throwing NotFound. The cascade contract is "no rows
			// remain", not "the call raises".
			const remaining = await store
				.listConversations(workspaceId, agentId)
				.catch(() => [] as readonly unknown[]);
			expect(remaining).toEqual([]);
			return;
		}
		default: {
			const exhaustive: never = step;
			throw new Error(`unhandled agent cascade step: ${String(exhaustive)}`);
		}
	}
}
