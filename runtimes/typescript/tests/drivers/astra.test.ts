import { describe, expect, test } from "vitest";
import type {
	VectorStoreRecord,
	WorkspaceRecord,
} from "../../src/control-plane/types.js";
import { AstraVectorStoreDriver } from "../../src/drivers/astra/store.js";
import { EnvSecretProvider } from "../../src/secrets/env.js";
import { SecretResolver } from "../../src/secrets/provider.js";
import { FakeDb } from "./astra-fake.js";
import { runDriverContract } from "./contract.js";

runDriverContract("astra (fake Db)", async () => {
	const savedToken = process.env.TEST_ASTRA_TOKEN;
	process.env.TEST_ASTRA_TOKEN = "fake-token";

	const secrets = new SecretResolver({ env: new EnvSecretProvider() });
	const fakeDb = new FakeDb();
	const driver = new AstraVectorStoreDriver({
		secrets,
		dbFactory: () => fakeDb,
	});

	// The contract suite uses a mock-kind workspace with no endpoint/token,
	// but we intercept the dbFactory so astra-db-ts's real
	// WorkspaceMisconfigured checks are bypassed. Give the driver a
	// workspace it finds acceptable via the factory override below.
	// We wrap the driver to inject a valid endpoint/token on every call
	// while leaving the contract-suite workspace otherwise untouched.
	const wrapped: import("../../src/drivers/vector-store.js").VectorStoreDriver =
		{
			createCollection: (ctx) =>
				driver.createCollection({
					workspace: {
						...ctx.workspace,
						url: "https://fake.example",
						credentials: { token: "env:TEST_ASTRA_TOKEN" },
					},
					descriptor: ctx.descriptor,
				}),
			dropCollection: (ctx) =>
				driver.dropCollection({
					workspace: {
						...ctx.workspace,
						url: "https://fake.example",
						credentials: { token: "env:TEST_ASTRA_TOKEN" },
					},
					descriptor: ctx.descriptor,
				}),
			upsert: (ctx, records) =>
				driver.upsert(
					{
						workspace: {
							...ctx.workspace,
							url: "https://fake.example",
							credentials: { token: "env:TEST_ASTRA_TOKEN" },
						},
						descriptor: ctx.descriptor,
					},
					records,
				),
			deleteRecord: (ctx, id) =>
				driver.deleteRecord(
					{
						workspace: {
							...ctx.workspace,
							url: "https://fake.example",
							credentials: { token: "env:TEST_ASTRA_TOKEN" },
						},
						descriptor: ctx.descriptor,
					},
					id,
				),
			search: (ctx, req) =>
				driver.search(
					{
						workspace: {
							...ctx.workspace,
							url: "https://fake.example",
							credentials: { token: "env:TEST_ASTRA_TOKEN" },
						},
						descriptor: ctx.descriptor,
					},
					req,
				),
		};

	return {
		driver: wrapped,
		cleanup: async () => {
			if (savedToken === undefined) delete process.env.TEST_ASTRA_TOKEN;
			else process.env.TEST_ASTRA_TOKEN = savedToken;
		},
	};
});

describe("AstraVectorStoreDriver endpoint resolution", () => {
	const descriptor: VectorStoreRecord = {
		workspace: "00000000-0000-0000-0000-000000000000",
		uid: "00000000-0000-0000-0000-000000000001",
		name: "vs",
		vectorDimension: 4,
		vectorSimilarity: "cosine",
		embedding: {
			provider: "mock",
			model: "mock",
			endpoint: null,
			dimension: 4,
			secretRef: null,
		},
		lexical: { enabled: false, analyzer: null, options: {} },
		reranking: {
			enabled: false,
			provider: null,
			model: null,
			endpoint: null,
			secretRef: null,
		},
		createdAt: "2026-04-23T00:00:00.000Z",
		updatedAt: "2026-04-23T00:00:00.000Z",
	};

	function makeWorkspace(url: string | null): WorkspaceRecord {
		return {
			uid: "00000000-0000-0000-0000-000000000000",
			name: "w",
			url,
			kind: "astra",
			credentials: { token: "env:TEST_ASTRA_TOKEN" },
			keyspace: null,
			rlacEnabled: false,
			createdAt: "2026-04-23T00:00:00.000Z",
			updatedAt: "2026-04-23T00:00:00.000Z",
		};
	}

	test("literal workspace URL is passed to the DbFactory as-is", async () => {
		process.env.TEST_ASTRA_TOKEN = "t";
		try {
			const secrets = new SecretResolver({ env: new EnvSecretProvider() });
			const seen: Array<{ url: string; token: string }> = [];
			const driver = new AstraVectorStoreDriver({
				secrets,
				dbFactory: (_ws, endpoint, token) => {
					seen.push({ url: endpoint, token });
					return new FakeDb();
				},
			});
			await driver.createCollection({
				workspace: makeWorkspace("https://real.example.com"),
				descriptor,
			});
			expect(seen).toEqual([{ url: "https://real.example.com", token: "t" }]);
		} finally {
			delete process.env.TEST_ASTRA_TOKEN;
		}
	});

	test("env: ref URL is resolved before the DbFactory runs", async () => {
		process.env.TEST_ASTRA_TOKEN = "t";
		process.env.TEST_ASTRA_ENDPOINT = "https://resolved.example.com";
		try {
			const secrets = new SecretResolver({ env: new EnvSecretProvider() });
			const seen: Array<{ url: string; token: string }> = [];
			const driver = new AstraVectorStoreDriver({
				secrets,
				dbFactory: (_ws, endpoint, token) => {
					seen.push({ url: endpoint, token });
					return new FakeDb();
				},
			});
			await driver.createCollection({
				workspace: makeWorkspace("env:TEST_ASTRA_ENDPOINT"),
				descriptor,
			});
			expect(seen).toEqual([
				{ url: "https://resolved.example.com", token: "t" },
			]);
		} finally {
			delete process.env.TEST_ASTRA_TOKEN;
			delete process.env.TEST_ASTRA_ENDPOINT;
		}
	});

	test("missing URL raises WorkspaceMisconfiguredError", async () => {
		const secrets = new SecretResolver({ env: new EnvSecretProvider() });
		const driver = new AstraVectorStoreDriver({
			secrets,
			dbFactory: () => new FakeDb(),
		});
		await expect(
			driver.createCollection({
				workspace: makeWorkspace(null),
				descriptor,
			}),
		).rejects.toThrow(/url/);
	});

	test("env: ref endpoint that fails to resolve raises CollectionUnavailable", async () => {
		delete process.env.TEST_ASTRA_ENDPOINT_MISSING;
		const secrets = new SecretResolver({ env: new EnvSecretProvider() });
		const driver = new AstraVectorStoreDriver({
			secrets,
			dbFactory: () => new FakeDb(),
		});
		await expect(
			driver.createCollection({
				workspace: makeWorkspace("env:TEST_ASTRA_ENDPOINT_MISSING"),
				descriptor,
			}),
		).rejects.toThrow(/endpoint/);
	});
});

describe("AstraVectorStoreDriver hybrid + rerank", () => {
	// Shared setup — a workspace + descriptor that opt into lexical
	// and reranking. Tests reach into the `FakeDb` to assert on the
	// createCollection options the driver passed, and to seed docs
	// that `findAndRerank` scores against.
	const workspace: WorkspaceRecord = {
		uid: "00000000-0000-0000-0000-000000000000",
		name: "w",
		url: "https://fake.example",
		kind: "astra",
		credentials: { token: "env:TEST_ASTRA_TOKEN" },
		keyspace: null,
		rlacEnabled: false,
		createdAt: "2026-04-23T00:00:00.000Z",
		updatedAt: "2026-04-23T00:00:00.000Z",
	};
	function hybridDescriptor(
		overrides?: Partial<VectorStoreRecord>,
	): VectorStoreRecord {
		return {
			workspace: workspace.uid,
			uid: "00000000-0000-0000-0000-000000000001",
			name: "vs_hybrid",
			vectorDimension: 4,
			vectorSimilarity: "cosine",
			embedding: {
				provider: "openai",
				model: "text-embedding-3-small",
				endpoint: null,
				dimension: 4,
				secretRef: "env:TEST_OPENAI_KEY",
			},
			lexical: { enabled: true, analyzer: null, options: {} },
			reranking: {
				enabled: true,
				provider: "nvidia",
				model: "nv-rerankqa-mistral-4b-v3",
				endpoint: null,
				secretRef: null,
			},
			createdAt: "2026-04-23T00:00:00.000Z",
			updatedAt: "2026-04-23T00:00:00.000Z",
			...overrides,
		} as VectorStoreRecord;
	}

	test("createCollection forwards lexical + rerank options to Astra", async () => {
		process.env.TEST_ASTRA_TOKEN = "t";
		process.env.TEST_OPENAI_KEY = "k";
		try {
			const secrets = new SecretResolver({ env: new EnvSecretProvider() });
			const fakeDb = new FakeDb();
			const driver = new AstraVectorStoreDriver({
				secrets,
				dbFactory: () => fakeDb,
			});
			await driver.createCollection({
				workspace,
				descriptor: hybridDescriptor(),
			});
			expect(fakeDb.createCalls).toHaveLength(1);
			const opts = fakeDb.createCalls[0]?.opts;
			expect(opts?.lexical).toEqual({ enabled: true, analyzer: null });
			expect(opts?.rerank).toEqual({
				enabled: true,
				service: {
					provider: "nvidia",
					modelName: "nv-rerankqa-mistral-4b-v3",
				},
			});
		} finally {
			delete process.env.TEST_ASTRA_TOKEN;
			delete process.env.TEST_OPENAI_KEY;
		}
	});

	test("createCollection throws WorkspaceMisconfigured when reranking.enabled but provider/model missing", async () => {
		process.env.TEST_ASTRA_TOKEN = "t";
		try {
			const secrets = new SecretResolver({ env: new EnvSecretProvider() });
			const driver = new AstraVectorStoreDriver({
				secrets,
				dbFactory: () => new FakeDb(),
			});
			await expect(
				driver.createCollection({
					workspace,
					descriptor: hybridDescriptor({
						reranking: {
							enabled: true,
							provider: null,
							model: null,
							endpoint: null,
							secretRef: null,
						},
					}),
				}),
			).rejects.toThrow(/reranking/);
		} finally {
			delete process.env.TEST_ASTRA_TOKEN;
		}
	});

	test("searchHybrid returns reranked hits with $reranker score", async () => {
		process.env.TEST_ASTRA_TOKEN = "t";
		process.env.TEST_OPENAI_KEY = "k";
		try {
			const secrets = new SecretResolver({ env: new EnvSecretProvider() });
			const fakeDb = new FakeDb();
			const driver = new AstraVectorStoreDriver({
				secrets,
				dbFactory: () => fakeDb,
			});
			const descriptor = hybridDescriptor();
			await driver.createCollection({ workspace, descriptor });
			await driver.upsert({ workspace, descriptor }, [
				{
					id: "apples",
					vector: [1, 0, 0, 0],
					payload: { text: "apples are red fruit" },
				},
				{
					id: "bananas",
					vector: [0.9, 0.1, 0, 0],
					payload: { text: "bananas are yellow fruit" },
				},
			]);
			const hits = await driver.searchHybrid?.(
				{ workspace, descriptor },
				{ vector: [1, 0, 0, 0], text: "apples", topK: 5 },
			);
			expect(hits).toBeDefined();
			expect(hits?.length).toBe(2);
			// "apples" matches both lanes, so it must come first.
			expect(hits?.[0]?.id).toBe("apples");
			// Score should be the reranker score (blended 50/50 in the
			// fake); strictly positive for the lexical match.
			expect(hits?.[0]?.score).toBeGreaterThan(0);
		} finally {
			delete process.env.TEST_ASTRA_TOKEN;
			delete process.env.TEST_OPENAI_KEY;
		}
	});

	test("searchHybrid throws NotSupported when descriptor disables lexical", async () => {
		process.env.TEST_ASTRA_TOKEN = "t";
		process.env.TEST_OPENAI_KEY = "k";
		try {
			const secrets = new SecretResolver({ env: new EnvSecretProvider() });
			const driver = new AstraVectorStoreDriver({
				secrets,
				dbFactory: () => new FakeDb(),
			});
			const descriptor = hybridDescriptor({
				lexical: { enabled: false, analyzer: null, options: {} },
			});
			await driver.createCollection({ workspace, descriptor });
			await expect(
				driver.searchHybrid?.(
					{ workspace, descriptor },
					{ vector: [1, 0, 0, 0], text: "apples" },
				),
			).rejects.toThrow(/lexical/);
		} finally {
			delete process.env.TEST_ASTRA_TOKEN;
			delete process.env.TEST_OPENAI_KEY;
		}
	});

	test("searchHybrid throws NotSupported when descriptor disables reranking", async () => {
		process.env.TEST_ASTRA_TOKEN = "t";
		process.env.TEST_OPENAI_KEY = "k";
		try {
			const secrets = new SecretResolver({ env: new EnvSecretProvider() });
			const driver = new AstraVectorStoreDriver({
				secrets,
				dbFactory: () => new FakeDb(),
			});
			const descriptor = hybridDescriptor({
				reranking: {
					enabled: false,
					provider: null,
					model: null,
					endpoint: null,
					secretRef: null,
				},
			});
			await driver.createCollection({ workspace, descriptor });
			await expect(
				driver.searchHybrid?.(
					{ workspace, descriptor },
					{ vector: [1, 0, 0, 0], text: "apples" },
				),
			).rejects.toThrow(/reranker|rerank/);
		} finally {
			delete process.env.TEST_ASTRA_TOKEN;
			delete process.env.TEST_OPENAI_KEY;
		}
	});

	test("standalone rerank is not exposed on Astra", () => {
		const secrets = new SecretResolver({ env: new EnvSecretProvider() });
		const driver = new AstraVectorStoreDriver({
			secrets,
			dbFactory: () => new FakeDb(),
		});
		// Astra combines hybrid + rerank in a single findAndRerank call;
		// there's no primitive to rerank an already-retrieved set of
		// hits. The dispatcher's route-level `rerank: true` flow
		// surfaces as 501 on Astra — verified by the dispatcher's own
		// tests. Here we just pin the shape.
		expect("rerank" in driver).toBe(false);
	});
});

describe("AstraVectorStoreDriver ANN over-fetch (recall)", () => {
	// Astra's vector index is approximate. The driver over-fetches a
	// wider candidate pool and truncates to the caller's `topK` so
	// small-K queries don't miss the actual nearest neighbor — the
	// production symptom users observe as "topK=5 didn't include the
	// highest-score doc, but topK=10 did." These tests pin the
	// over-fetch limit + the post-fetch defensive sort + the
	// truncate-to-K contract.

	const workspace: WorkspaceRecord = {
		uid: "00000000-0000-0000-0000-000000000000",
		name: "w",
		url: "https://fake.example",
		kind: "astra",
		credentials: { token: "env:TEST_ASTRA_TOKEN" },
		keyspace: null,
		rlacEnabled: false,
		createdAt: "2026-04-23T00:00:00.000Z",
		updatedAt: "2026-04-23T00:00:00.000Z",
	};
	const descriptor: VectorStoreRecord = {
		workspace: workspace.uid,
		uid: "00000000-0000-0000-0000-000000000001",
		name: "vs_recall",
		vectorDimension: 4,
		vectorSimilarity: "cosine",
		embedding: {
			provider: "mock",
			model: "mock",
			endpoint: null,
			dimension: 4,
			secretRef: null,
		},
		lexical: { enabled: false, analyzer: null, options: {} },
		reranking: {
			enabled: false,
			provider: null,
			model: null,
			endpoint: null,
			secretRef: null,
		},
		createdAt: "2026-04-23T00:00:00.000Z",
		updatedAt: "2026-04-23T00:00:00.000Z",
	};

	function setupDriver() {
		process.env.TEST_ASTRA_TOKEN = "t";
		const secrets = new SecretResolver({ env: new EnvSecretProvider() });
		const fakeDb = new FakeDb();
		const driver = new AstraVectorStoreDriver({
			secrets,
			dbFactory: () => fakeDb,
		});
		return { driver, fakeDb };
	}

	function findCalls(
		fakeDb: FakeDb,
		collection: string,
	): Array<{ limit?: number }> {
		const coll = fakeDb.getCollection(collection);
		return (coll?.findCalls ?? []).map((c) => ({ limit: c.opts?.limit }));
	}

	function collectionName(descriptor: VectorStoreRecord): string {
		// Mirror the driver's naming function used inside store.ts.
		// `descriptor.name` is an Astra-valid identifier here, so the
		// driver uses it directly instead of falling back to the
		// `vs_<uid>` form.
		return descriptor.name;
	}

	test("search over-fetches with limit ≥ RECALL_FLOOR even for tiny topK", async () => {
		const { driver, fakeDb } = setupDriver();
		try {
			await driver.createCollection({ workspace, descriptor });
			await driver.upsert({ workspace, descriptor }, [
				{ id: "a", vector: [1, 0, 0, 0] },
				{ id: "b", vector: [0, 1, 0, 0] },
				{ id: "c", vector: [0, 0, 1, 0] },
			]);
			await driver.search(
				{ workspace, descriptor },
				{ vector: [1, 0, 0, 0], topK: 1 },
			);
			const calls = findCalls(fakeDb, collectionName(descriptor));
			// Last find call is the search itself. Astra-side limit
			// must exceed the caller's topK to widen ANN recall.
			const last = calls[calls.length - 1];
			expect(last?.limit ?? 0).toBeGreaterThanOrEqual(50);
			expect(last?.limit ?? 0).toBeGreaterThan(1);
		} finally {
			delete process.env.TEST_ASTRA_TOKEN;
		}
	});

	test("search truncates to topK after over-fetch", async () => {
		const { driver } = setupDriver();
		try {
			await driver.createCollection({ workspace, descriptor });
			await driver.upsert({ workspace, descriptor }, [
				{ id: "a", vector: [1, 0, 0, 0] },
				{ id: "b", vector: [0, 1, 0, 0] },
				{ id: "c", vector: [0, 0, 1, 0] },
				{ id: "d", vector: [0, 0, 0, 1] },
			]);
			const hits = await driver.search(
				{ workspace, descriptor },
				{ vector: [1, 0, 0, 0], topK: 2 },
			);
			expect(hits).toHaveLength(2);
			expect(hits[0]?.id).toBe("a");
		} finally {
			delete process.env.TEST_ASTRA_TOKEN;
		}
	});

	test("search hits come back in descending similarity order even when input is shuffled", async () => {
		// Insert in non-monotone order; defensive sort in the driver
		// should still produce descending-by-score output regardless
		// of any future SDK ordering quirk.
		const { driver } = setupDriver();
		try {
			await driver.createCollection({ workspace, descriptor });
			await driver.upsert({ workspace, descriptor }, [
				{ id: "low", vector: [0, 0, 0, 1] },
				{ id: "high", vector: [1, 0, 0, 0] },
				{ id: "mid", vector: [0.7, 0.3, 0, 0] },
			]);
			const hits = await driver.search(
				{ workspace, descriptor },
				{ vector: [1, 0, 0, 0], topK: 3 },
			);
			expect(hits.map((h) => h.id)).toEqual(["high", "mid", "low"]);
			for (let i = 0; i < hits.length - 1; i++) {
				const a = hits[i]?.score ?? 0;
				const b = hits[i + 1]?.score ?? 0;
				expect(a).toBeGreaterThanOrEqual(b);
			}
		} finally {
			delete process.env.TEST_ASTRA_TOKEN;
		}
	});

	test("over-fetch limit caps at the per-page ceiling for very large topK", async () => {
		const { driver, fakeDb } = setupDriver();
		try {
			await driver.createCollection({ workspace, descriptor });
			await driver.upsert({ workspace, descriptor }, [
				{ id: "a", vector: [1, 0, 0, 0] },
			]);
			// topK well above the ceiling. The driver must clamp the
			// over-fetch to the per-page ceiling so we don't ask Astra
			// for more than it'll serve.
			await driver.search(
				{ workspace, descriptor },
				{ vector: [1, 0, 0, 0], topK: 500 },
			);
			const calls = findCalls(fakeDb, collectionName(descriptor));
			const last = calls[calls.length - 1];
			expect(last?.limit).toBe(1000);
		} finally {
			delete process.env.TEST_ASTRA_TOKEN;
		}
	});
});
