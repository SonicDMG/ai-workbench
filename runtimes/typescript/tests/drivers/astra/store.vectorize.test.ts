/**
 * Behavioral tests for the Astra driver's vectorize path.
 *
 * Uses the in-memory FakeDb (extended to support $vectorize) so we
 * can assert:
 *   1. createCollection passes the `service` block when the embedding
 *      config declares a supported provider.
 *   2. searchByText attaches embeddingApiKey on the handle and uses
 *      $vectorize in the sort.
 *   3. searchByText throws NotSupported when the embedding provider
 *      isn't on the allowlist (descriptor rejects upfront — no Astra
 *      call).
 *   4. searchByText translates an Astra "vectorize not configured"
 *      error into NotSupported so the route layer can fall back.
 */

import { afterEach, beforeEach, describe, expect, test } from "vitest";
import type {
	VectorStoreRecord,
	WorkspaceRecord,
} from "../../../src/control-plane/types.js";
import { AstraVectorStoreDriver } from "../../../src/drivers/astra/store.js";
import { NotSupportedError } from "../../../src/drivers/vector-store.js";
import { EnvSecretProvider } from "../../../src/secrets/env.js";
import { SecretResolver } from "../../../src/secrets/provider.js";
import { FakeDb } from "../astra-fake.js";

const WORKSPACE: WorkspaceRecord = {
	uid: "00000000-0000-0000-0000-0000000000aa",
	name: "w",
	endpoint: "https://fake.astra.example",
	kind: "astra",
	credentialsRef: { token: "env:TEST_ASTRA_TOKEN" },
	keyspace: null,
	createdAt: "2026-01-01T00:00:00Z",
	updatedAt: "2026-01-01T00:00:00Z",
};

function descriptor(overrides?: Partial<VectorStoreRecord>): VectorStoreRecord {
	return {
		workspace: WORKSPACE.uid,
		uid: "00000000-0000-0000-0000-0000000000bb",
		name: "vs",
		vectorDimension: 8,
		vectorSimilarity: "cosine",
		embedding: {
			provider: "openai",
			model: "text-embedding-3-small",
			endpoint: null,
			dimension: 8,
			secretRef: "env:TEST_EMBEDDING_KEY",
			...(overrides?.embedding ?? {}),
		},
		lexical: { enabled: false, analyzer: null, options: {} },
		reranking: {
			enabled: false,
			provider: null,
			model: null,
			endpoint: null,
			secretRef: null,
		},
		createdAt: "2026-01-01T00:00:00Z",
		updatedAt: "2026-01-01T00:00:00Z",
		...overrides,
	};
}

function build(): { driver: AstraVectorStoreDriver; fake: FakeDb } {
	const secrets = new SecretResolver({ env: new EnvSecretProvider() });
	const fake = new FakeDb();
	const driver = new AstraVectorStoreDriver({
		secrets,
		dbFactory: () => fake,
	});
	return { driver, fake };
}

describe("AstraVectorStoreDriver + vectorize", () => {
	const savedToken = process.env.TEST_ASTRA_TOKEN;
	const savedEmbedKey = process.env.TEST_EMBEDDING_KEY;

	beforeEach(() => {
		process.env.TEST_ASTRA_TOKEN = "fake-token";
		process.env.TEST_EMBEDDING_KEY = "sk-embed";
	});
	afterEach(() => {
		if (savedToken === undefined) delete process.env.TEST_ASTRA_TOKEN;
		else process.env.TEST_ASTRA_TOKEN = savedToken;
		if (savedEmbedKey === undefined) delete process.env.TEST_EMBEDDING_KEY;
		else process.env.TEST_EMBEDDING_KEY = savedEmbedKey;
	});

	test("createCollection passes `service` when the descriptor's embedding provider is supported", async () => {
		const { driver, fake } = build();
		const d = descriptor();
		await driver.createCollection({ workspace: WORKSPACE, descriptor: d });
		expect(fake.createCalls).toHaveLength(1);
		expect(fake.createCalls[0]?.opts.vector.service).toEqual({
			provider: "openai",
			modelName: "text-embedding-3-small",
		});
	});

	test("createCollection omits `service` when the provider isn't on the allowlist", async () => {
		const { driver, fake } = build();
		const d = descriptor({
			embedding: {
				provider: "homegrown",
				model: "unknown",
				endpoint: null,
				dimension: 8,
				secretRef: "env:TEST_EMBEDDING_KEY",
			},
		});
		await driver.createCollection({ workspace: WORKSPACE, descriptor: d });
		expect(fake.createCalls[0]?.opts.vector.service).toBeUndefined();
	});

	test("createCollection omits `service` when no secretRef is configured", async () => {
		const { driver, fake } = build();
		const d = descriptor({
			embedding: {
				provider: "openai",
				model: "text-embedding-3-small",
				endpoint: null,
				dimension: 8,
				secretRef: null,
			},
		});
		await driver.createCollection({ workspace: WORKSPACE, descriptor: d });
		expect(fake.createCalls[0]?.opts.vector.service).toBeUndefined();
	});

	test("searchByText attaches embeddingApiKey on the collection handle and finds results via $vectorize", async () => {
		const { driver, fake } = build();
		const d = descriptor();
		const ctx = { workspace: WORKSPACE, descriptor: d };

		await driver.createCollection(ctx);
		// Upsert some docs with pre-computed vectors so the fake has
		// something to return. (Real Astra would auto-embed via
		// $vectorize on insert; the fake treats that separately.)
		await driver.upsert(ctx, [
			{ id: "a", vector: [1, 0, 0, 0, 0, 0, 0, 0] },
			{ id: "b", vector: [0, 1, 0, 0, 0, 0, 0, 0] },
		]);

		const hits = await driver.searchByText!(ctx, { text: "hello", topK: 2 });
		expect(hits).toHaveLength(2);

		// embeddingApiKey should be set on every searchByText call.
		const lastHandle = fake.handleCalls.at(-1);
		expect(lastHandle?.opts?.embeddingApiKey).toBe("sk-embed");
	});

	test("searchByText throws NotSupported when the provider isn't on the vectorize allowlist", async () => {
		const { driver } = build();
		const d = descriptor({
			embedding: {
				provider: "homegrown",
				model: "unknown",
				endpoint: null,
				dimension: 8,
				secretRef: "env:TEST_EMBEDDING_KEY",
			},
		});
		const ctx = { workspace: WORKSPACE, descriptor: d };
		await driver.createCollection(ctx);
		await expect(
			driver.searchByText!(ctx, { text: "hi", topK: 1 }),
		).rejects.toBeInstanceOf(NotSupportedError);
	});

	test("searchByText translates Astra's 'vectorize not configured' into NotSupported", async () => {
		const { driver, fake } = build();
		const d = descriptor();
		const ctx = { workspace: WORKSPACE, descriptor: d };

		// Intentionally skip createCollection — calling directly means
		// the fake lazy-creates a collection with no service, and the
		// $vectorize sort will throw FakeVectorizeNotConfiguredError
		// (matching the real Astra error shape).
		fake.collection("vs"); // ensure the handle exists
		await expect(
			driver.searchByText!(ctx, { text: "hi", topK: 1 }),
		).rejects.toBeInstanceOf(NotSupportedError);
	});

	test("searchByText caches the embedding key across calls", async () => {
		const { driver, fake } = build();
		const d = descriptor();
		const ctx = { workspace: WORKSPACE, descriptor: d };
		await driver.createCollection(ctx);
		await driver.upsert(ctx, [{ id: "a", vector: [1, 0, 0, 0, 0, 0, 0, 0] }]);

		// First call: resolver reads the current env → caches "sk-embed".
		await driver.searchByText!(ctx, { text: "one" });
		// Mutate env between calls — second call should hit the cache
		// and ignore the new value, proving the resolver isn't being
		// called twice on every searchByText.
		process.env.TEST_EMBEDDING_KEY = "will-not-be-read";
		await driver.searchByText!(ctx, { text: "two" });
		const keys = fake.handleCalls
			.filter((h) => h.opts?.embeddingApiKey !== undefined)
			.map((h) => h.opts?.embeddingApiKey);
		expect(keys).toEqual(["sk-embed", "sk-embed"]);
	});
});
