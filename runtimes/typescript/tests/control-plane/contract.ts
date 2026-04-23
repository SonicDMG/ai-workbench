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
import type {
	ControlPlaneStore,
	CreateVectorStoreInput,
} from "../../src/control-plane/store.js";

export type ContractFactory = () => Promise<{
	readonly store: ControlPlaneStore;
	readonly cleanup?: () => Promise<void>;
}>;

const VECTOR_STORE_BASE: Omit<CreateVectorStoreInput, "name"> = {
	vectorDimension: 1536,
	vectorSimilarity: "cosine",
	embedding: {
		provider: "openai",
		model: "text-embedding-3-small",
		endpoint: null,
		dimension: 1536,
		secretRef: "env:OPENAI_API_KEY",
	},
};

export function runContract(name: string, factory: ContractFactory): void {
	describe(`ControlPlaneStore contract: ${name}`, () => {
		test("createWorkspace assigns a uid and echoes the input", async () => {
			const { store, cleanup } = await factory();
			try {
				const ws = await store.createWorkspace({
					name: "prod",
					kind: "astra",
					credentialsRef: { token: "env:ASTRA_TOKEN" },
				});
				expect(ws.uid).toMatch(
					/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
				);
				expect(ws.name).toBe("prod");
				expect(ws.kind).toBe("astra");
				expect(ws.credentialsRef.token).toBe("env:ASTRA_TOKEN");
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

		test("deleteWorkspace cascades to catalogs, vector stores and documents", async () => {
			const { store, cleanup } = await factory();
			try {
				const ws = await store.createWorkspace({
					name: "a",
					kind: "mock",
				});
				const vs = await store.createVectorStore(ws.uid, {
					name: "vs",
					...VECTOR_STORE_BASE,
				});
				const cat = await store.createCatalog(ws.uid, {
					name: "cat",
					vectorStore: vs.uid,
				});
				await store.createDocument(ws.uid, cat.uid, {
					sourceFilename: "x.pdf",
				});

				await store.deleteWorkspace(ws.uid);

				expect(await store.getWorkspace(ws.uid)).toBeNull();
				await expect(store.listCatalogs(ws.uid)).rejects.toBeInstanceOf(
					ControlPlaneNotFoundError,
				);
				await expect(store.listVectorStores(ws.uid)).rejects.toBeInstanceOf(
					ControlPlaneNotFoundError,
				);
			} finally {
				await cleanup?.();
			}
		});

		test("catalogs are scoped per workspace", async () => {
			const { store, cleanup } = await factory();
			try {
				const ws1 = await store.createWorkspace({
					name: "w1",
					kind: "mock",
				});
				const ws2 = await store.createWorkspace({
					name: "w2",
					kind: "mock",
				});
				await store.createCatalog(ws1.uid, { name: "shared" });
				await store.createCatalog(ws2.uid, { name: "shared" });

				expect((await store.listCatalogs(ws1.uid)).length).toBe(1);
				expect((await store.listCatalogs(ws2.uid)).length).toBe(1);
			} finally {
				await cleanup?.();
			}
		});

		test("multiple catalogs may bind the same vector store (N:1)", async () => {
			const { store, cleanup } = await factory();
			try {
				const ws = await store.createWorkspace({
					name: "w",
					kind: "mock",
				});
				const vs = await store.createVectorStore(ws.uid, {
					name: "shared-vs",
					...VECTOR_STORE_BASE,
				});
				const c1 = await store.createCatalog(ws.uid, {
					name: "c1",
					vectorStore: vs.uid,
				});
				const c2 = await store.createCatalog(ws.uid, {
					name: "c2",
					vectorStore: vs.uid,
				});
				expect(c1.vectorStore).toBe(vs.uid);
				expect(c2.vectorStore).toBe(vs.uid);
			} finally {
				await cleanup?.();
			}
		});

		test("vector store defaults are applied", async () => {
			const { store, cleanup } = await factory();
			try {
				const ws = await store.createWorkspace({
					name: "w",
					kind: "mock",
				});
				const vs = await store.createVectorStore(ws.uid, {
					name: "v",
					vectorDimension: 1536,
					embedding: VECTOR_STORE_BASE.embedding,
				});
				expect(vs.vectorSimilarity).toBe("cosine");
				expect(vs.lexical.enabled).toBe(false);
				expect(vs.reranking.enabled).toBe(false);
			} finally {
				await cleanup?.();
			}
		});

		test("document status defaults to 'pending'", async () => {
			const { store, cleanup } = await factory();
			try {
				const ws = await store.createWorkspace({
					name: "w",
					kind: "mock",
				});
				const cat = await store.createCatalog(ws.uid, { name: "c" });
				const doc = await store.createDocument(ws.uid, cat.uid, {
					sourceFilename: "a.pdf",
				});
				expect(doc.status).toBe("pending");
			} finally {
				await cleanup?.();
			}
		});

		test("document update transitions status and clears error on success", async () => {
			const { store, cleanup } = await factory();
			try {
				const ws = await store.createWorkspace({
					name: "w",
					kind: "mock",
				});
				const cat = await store.createCatalog(ws.uid, { name: "c" });
				const doc = await store.createDocument(ws.uid, cat.uid, {
					status: "failed",
					errorMessage: "oops",
				});
				const next = await store.updateDocument(
					ws.uid,
					cat.uid,
					doc.documentUid,
					{ status: "ready", errorMessage: null },
				);
				expect(next.status).toBe("ready");
				expect(next.errorMessage).toBeNull();
			} finally {
				await cleanup?.();
			}
		});

		test("list/get operations on unknown workspace throw not-found", async () => {
			const { store, cleanup } = await factory();
			try {
				const ghost = "00000000-0000-0000-0000-000000000000";
				await expect(store.listCatalogs(ghost)).rejects.toBeInstanceOf(
					ControlPlaneNotFoundError,
				);
				await expect(store.listVectorStores(ghost)).rejects.toBeInstanceOf(
					ControlPlaneNotFoundError,
				);
			} finally {
				await cleanup?.();
			}
		});

		test("delete returns { deleted: false } for unknown ids", async () => {
			const { store, cleanup } = await factory();
			try {
				const ws = await store.createWorkspace({
					name: "w",
					kind: "mock",
				});
				const res = await store.deleteVectorStore(
					ws.uid,
					"00000000-0000-0000-0000-000000000000",
				);
				expect(res.deleted).toBe(false);
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
	});
}
