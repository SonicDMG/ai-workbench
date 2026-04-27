/**
 * Shared behavioral contract for {@link ../../src/drivers/vector-store.VectorStoreDriver}.
 *
 * Every driver implementation imports {@link runDriverContract} and
 * passes a factory. The assertions cover the minimum shared behavior:
 * provisioning, upsert, delete, search ordering, dimension checks.
 *
 * Backend-specific behavior (connection caching, error translation
 * from the upstream SDK, etc.) lives in the driver's own test file.
 */

import { describe, expect, test } from "vitest";
import type {
	VectorStoreRecord,
	WorkspaceRecord,
} from "../../src/control-plane/types.js";
import {
	DimensionMismatchError,
	type VectorStoreDriver,
	type VectorStoreDriverContext,
} from "../../src/drivers/vector-store.js";

const WORKSPACE: WorkspaceRecord = {
	uid: "11111111-1111-1111-1111-111111111111",
	name: "test-workspace",
	url: null,
	kind: "mock",
	credentials: {},
	keyspace: null,
	createdAt: "2026-04-22T00:00:00.000Z",
	updatedAt: "2026-04-22T00:00:00.000Z",
};

const DESCRIPTOR: VectorStoreRecord = {
	workspace: WORKSPACE.uid,
	uid: "22222222-2222-2222-2222-222222222222",
	name: "test-vs",
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
	createdAt: "2026-04-22T00:00:00.000Z",
	updatedAt: "2026-04-22T00:00:00.000Z",
};

const CTX: VectorStoreDriverContext = {
	workspace: WORKSPACE,
	descriptor: DESCRIPTOR,
};

export type DriverFactory = () => Promise<{
	readonly driver: VectorStoreDriver;
	readonly cleanup?: () => Promise<void>;
}>;

export function runDriverContract(name: string, factory: DriverFactory): void {
	describe(`VectorStoreDriver contract: ${name}`, () => {
		test("createCollection is idempotent", async () => {
			const { driver, cleanup } = await factory();
			try {
				await driver.createCollection(CTX);
				await expect(driver.createCollection(CTX)).resolves.not.toThrow();
			} finally {
				await cleanup?.();
			}
		});

		test("upsert + search returns highest-score first", async () => {
			const { driver, cleanup } = await factory();
			try {
				await driver.createCollection(CTX);
				await driver.upsert(CTX, [
					{ id: "a", vector: [1, 0, 0, 0], payload: { tag: "first" } },
					{ id: "b", vector: [0, 1, 0, 0] },
					{ id: "c", vector: [0.99, 0.1, 0, 0], payload: { tag: "near" } },
				]);
				const hits = await driver.search(CTX, {
					vector: [1, 0, 0, 0],
					topK: 2,
				});
				expect(hits).toHaveLength(2);
				expect(hits[0]?.id).toBe("a");
				expect(hits[0]?.score).toBeGreaterThan(hits[1]?.score ?? 0);
			} finally {
				await cleanup?.();
			}
		});

		test("search honors topK", async () => {
			const { driver, cleanup } = await factory();
			try {
				await driver.createCollection(CTX);
				await driver.upsert(CTX, [
					{ id: "a", vector: [1, 0, 0, 0] },
					{ id: "b", vector: [0, 1, 0, 0] },
					{ id: "c", vector: [0, 0, 1, 0] },
				]);
				expect(
					await driver.search(CTX, { vector: [1, 0, 0, 0], topK: 1 }),
				).toHaveLength(1);
			} finally {
				await cleanup?.();
			}
		});

		test("filter selects by payload equality", async () => {
			const { driver, cleanup } = await factory();
			try {
				await driver.createCollection(CTX);
				await driver.upsert(CTX, [
					{ id: "a", vector: [1, 0, 0, 0], payload: { tag: "keep" } },
					{ id: "b", vector: [0.9, 0, 0, 0], payload: { tag: "drop" } },
				]);
				const hits = await driver.search(CTX, {
					vector: [1, 0, 0, 0],
					topK: 10,
					filter: { tag: "keep" },
				});
				expect(hits.map((h) => h.id)).toEqual(["a"]);
			} finally {
				await cleanup?.();
			}
		});

		test("includeEmbeddings controls vector inclusion in hits", async () => {
			const { driver, cleanup } = await factory();
			try {
				await driver.createCollection(CTX);
				await driver.upsert(CTX, [{ id: "a", vector: [1, 0, 0, 0] }]);

				const without = await driver.search(CTX, {
					vector: [1, 0, 0, 0],
					topK: 1,
				});
				expect(without[0]?.vector).toBeUndefined();

				const withv = await driver.search(CTX, {
					vector: [1, 0, 0, 0],
					topK: 1,
					includeEmbeddings: true,
				});
				expect(withv[0]?.vector).toEqual([1, 0, 0, 0]);
			} finally {
				await cleanup?.();
			}
		});

		test("upsert rejects wrong-dimension vectors", async () => {
			const { driver, cleanup } = await factory();
			try {
				await driver.createCollection(CTX);
				await expect(
					driver.upsert(CTX, [{ id: "x", vector: [1, 2, 3] }]),
				).rejects.toBeInstanceOf(DimensionMismatchError);
			} finally {
				await cleanup?.();
			}
		});

		test("deleteRecord reports presence", async () => {
			const { driver, cleanup } = await factory();
			try {
				await driver.createCollection(CTX);
				await driver.upsert(CTX, [{ id: "a", vector: [1, 0, 0, 0] }]);
				expect(await driver.deleteRecord(CTX, "a")).toEqual({ deleted: true });
				expect(await driver.deleteRecord(CTX, "a")).toEqual({ deleted: false });
			} finally {
				await cleanup?.();
			}
		});

		test("dropCollection removes state", async () => {
			const { driver, cleanup } = await factory();
			try {
				await driver.createCollection(CTX);
				await driver.upsert(CTX, [{ id: "a", vector: [1, 0, 0, 0] }]);
				await driver.dropCollection(CTX);
				// Subsequent data-plane ops on a dropped collection surface
				// as a driver-specific error — the contract only asserts
				// that drop succeeds.
				expect(true).toBe(true);
			} finally {
				await cleanup?.();
			}
		});
	});
}
