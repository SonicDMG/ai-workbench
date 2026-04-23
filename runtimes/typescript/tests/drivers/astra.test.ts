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
