/**
 * Focused unit tests for the search dispatcher.
 *
 * The integration suite in `tests/knowledge-bases.test.ts` exercises
 * the happy paths through the full app; these tests pin the dispatch
 * decision tree itself, in particular: never build a client-side
 * embedder when the driver's `searchByText` path can serve the query.
 * The playground hit `embedding_unavailable` for `$vectorize`
 * collections (server-side embedding, null `secretRef`) precisely
 * because the dispatcher used to embed eagerly — these tests guard
 * against the regression.
 */

import { describe, expect, test, vi } from "vitest";
import type {
	VectorStoreRecord,
	WorkspaceRecord,
} from "../../../src/control-plane/types.js";
import {
	NotSupportedError,
	type SearchHit,
	type VectorStoreDriver,
} from "../../../src/drivers/vector-store.js";
import { dispatchSearch } from "../../../src/routes/api-v1/search-dispatch.js";

const WORKSPACE: WorkspaceRecord = {
	uid: "00000000-0000-0000-0000-00000000abcd",
	name: "vectorize-ws",
	kind: "astra",
	url: null,
	keyspace: null,
	credentials: {},
	createdAt: "2026-01-01T00:00:00.000Z",
	updatedAt: "2026-01-01T00:00:00.000Z",
};

/** A descriptor that mimics a real Astra `$vectorize` collection: the
 * embedding service is server-side (NVIDIA NIM via Astra-managed KMS),
 * so `secretRef` is null. The runtime has no client-side credentials
 * for it. This is the shape that produced the bug. */
const VECTORIZE_DESCRIPTOR: VectorStoreRecord = {
	workspace: WORKSPACE.uid,
	uid: "00000000-0000-0000-0000-000000001111",
	name: "vectorize-kb",
	vectorDimension: 1024,
	vectorSimilarity: "cosine",
	embedding: {
		provider: "nvidia",
		model: "nvidia/nv-embedqa-e5-v5",
		endpoint: null,
		dimension: 1024,
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
	createdAt: "2026-01-01T00:00:00.000Z",
	updatedAt: "2026-01-01T00:00:00.000Z",
};

const HIT: SearchHit = { id: "doc-1:0", score: 0.92 };

/** Embedder factory that always errors — proves the dispatcher never
 * called it. Same error shape the real factory produces when
 * `secretRef` is null. */
function makeForbiddenEmbedderFactory() {
	const forConfig = vi.fn(async () => {
		throw new Error(
			"embedding.secretRef is null — cannot call the provider without credentials",
		);
	});
	return { forConfig } as unknown as Parameters<
		typeof dispatchSearch
	>[0]["embedders"] & { forConfig: typeof forConfig };
}

function makeDriver(overrides: Partial<VectorStoreDriver>): VectorStoreDriver {
	return {
		createCollection: vi.fn(),
		dropCollection: vi.fn(),
		upsert: vi.fn(),
		deleteRecord: vi.fn(),
		search: vi.fn(),
		...overrides,
	} as VectorStoreDriver;
}

describe("dispatchSearch — server-side $vectorize text search", () => {
	test("text-only query routes through driver.searchByText without building a client embedder", async () => {
		const searchByText = vi.fn<NonNullable<VectorStoreDriver["searchByText"]>>(
			async (_ctx, req) => {
				expect(req.text).toBe("hello world");
				expect(req.topK).toBe(5);
				return [HIT];
			},
		);
		const search = vi.fn();
		const driver = makeDriver({ search, searchByText });
		const embedders = makeForbiddenEmbedderFactory();

		const hits = await dispatchSearch({
			ctx: { workspace: WORKSPACE, descriptor: VECTORIZE_DESCRIPTOR },
			driver,
			embedders,
			body: { text: "hello world", topK: 5 },
		});

		expect(hits).toEqual([HIT]);
		expect(searchByText).toHaveBeenCalledOnce();
		// The load-bearing assertion: NEVER call the embedder factory
		// when the driver-native path covers the query.
		expect(embedders.forConfig).not.toHaveBeenCalled();
		expect(search).not.toHaveBeenCalled();
	});

	test("falls back to client-side embedding when searchByText throws NotSupported", async () => {
		const searchByText = vi.fn(async () => {
			throw new NotSupportedError("searchByText", "vectorize disabled");
		});
		const search = vi.fn(async () => [HIT]);
		const driver = makeDriver({ search, searchByText });

		const embedder = {
			id: "stub:1",
			dimension: VECTORIZE_DESCRIPTOR.vectorDimension,
			embed: vi.fn(async () => new Array(1024).fill(0.1)),
			embedMany: vi.fn(),
		};
		const embedders = {
			forConfig: vi.fn(async () => embedder),
		} as unknown as Parameters<typeof dispatchSearch>[0]["embedders"];

		const hits = await dispatchSearch({
			ctx: { workspace: WORKSPACE, descriptor: VECTORIZE_DESCRIPTOR },
			driver,
			embedders,
			body: { text: "hello", topK: 3 },
		});

		expect(hits).toEqual([HIT]);
		expect(searchByText).toHaveBeenCalledOnce();
		expect(embedder.embed).toHaveBeenCalledWith("hello");
		expect(search).toHaveBeenCalledOnce();
	});

	test("surfaces embedding_unavailable when no driver-native path AND no client credentials", async () => {
		// Driver implements neither `searchByText`; embedder factory
		// rejects. The dispatcher must surface the canonical
		// `embedding_unavailable` 400, not crash.
		const search = vi.fn();
		const driver = makeDriver({ search });
		const embedders = makeForbiddenEmbedderFactory();

		await expect(
			dispatchSearch({
				ctx: { workspace: WORKSPACE, descriptor: VECTORIZE_DESCRIPTOR },
				driver,
				embedders,
				body: { text: "hello" },
			}),
		).rejects.toMatchObject({
			code: "embedding_unavailable",
			status: 400,
		});
		expect(search).not.toHaveBeenCalled();
	});

	test("caller-supplied vector skips the embedder factory entirely", async () => {
		const search = vi.fn(async () => [HIT]);
		const driver = makeDriver({ search });
		const embedders = makeForbiddenEmbedderFactory();

		const vector = new Array(1024).fill(0.5);
		const hits = await dispatchSearch({
			ctx: { workspace: WORKSPACE, descriptor: VECTORIZE_DESCRIPTOR },
			driver,
			embedders,
			body: { vector },
		});

		expect(hits).toEqual([HIT]);
		expect(search).toHaveBeenCalledOnce();
		expect(embedders.forConfig).not.toHaveBeenCalled();
	});
});
