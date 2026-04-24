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
						endpoint: "https://fake.example",
						credentialsRef: { token: "env:TEST_ASTRA_TOKEN" },
					},
					descriptor: ctx.descriptor,
				}),
			dropCollection: (ctx) =>
				driver.dropCollection({
					workspace: {
						...ctx.workspace,
						endpoint: "https://fake.example",
						credentialsRef: { token: "env:TEST_ASTRA_TOKEN" },
					},
					descriptor: ctx.descriptor,
				}),
			upsert: (ctx, records) =>
				driver.upsert(
					{
						workspace: {
							...ctx.workspace,
							endpoint: "https://fake.example",
							credentialsRef: { token: "env:TEST_ASTRA_TOKEN" },
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
							endpoint: "https://fake.example",
							credentialsRef: { token: "env:TEST_ASTRA_TOKEN" },
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
							endpoint: "https://fake.example",
							credentialsRef: { token: "env:TEST_ASTRA_TOKEN" },
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

	function makeWorkspace(endpoint: string | null): WorkspaceRecord {
		return {
			uid: "00000000-0000-0000-0000-000000000000",
			name: "w",
			endpoint,
			kind: "astra",
			credentialsRef: { token: "env:TEST_ASTRA_TOKEN" },
			keyspace: null,
			createdAt: "2026-04-23T00:00:00.000Z",
			updatedAt: "2026-04-23T00:00:00.000Z",
		};
	}

	test("literal URL endpoint is passed to the DbFactory as-is", async () => {
		process.env.TEST_ASTRA_TOKEN = "t";
		try {
			const secrets = new SecretResolver({ env: new EnvSecretProvider() });
			const seen: Array<{ endpoint: string; token: string }> = [];
			const driver = new AstraVectorStoreDriver({
				secrets,
				dbFactory: (_ws, endpoint, token) => {
					seen.push({ endpoint, token });
					return new FakeDb();
				},
			});
			await driver.createCollection({
				workspace: makeWorkspace("https://real.example.com"),
				descriptor,
			});
			expect(seen).toEqual([
				{ endpoint: "https://real.example.com", token: "t" },
			]);
		} finally {
			delete process.env.TEST_ASTRA_TOKEN;
		}
	});

	test("env: ref endpoint is resolved before the DbFactory runs", async () => {
		process.env.TEST_ASTRA_TOKEN = "t";
		process.env.TEST_ASTRA_ENDPOINT = "https://resolved.example.com";
		try {
			const secrets = new SecretResolver({ env: new EnvSecretProvider() });
			const seen: Array<{ endpoint: string; token: string }> = [];
			const driver = new AstraVectorStoreDriver({
				secrets,
				dbFactory: (_ws, endpoint, token) => {
					seen.push({ endpoint, token });
					return new FakeDb();
				},
			});
			await driver.createCollection({
				workspace: makeWorkspace("env:TEST_ASTRA_ENDPOINT"),
				descriptor,
			});
			expect(seen).toEqual([
				{ endpoint: "https://resolved.example.com", token: "t" },
			]);
		} finally {
			delete process.env.TEST_ASTRA_TOKEN;
			delete process.env.TEST_ASTRA_ENDPOINT;
		}
	});

	test("missing endpoint raises WorkspaceMisconfiguredError", async () => {
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
		).rejects.toThrow(/endpoint/);
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
		endpoint: "https://fake.example",
		kind: "astra",
		credentialsRef: { token: "env:TEST_ASTRA_TOKEN" },
		keyspace: null,
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
