/**
 * Unit tests for the pure helpers on `KnowledgeBaseService`.
 *
 * The full create + cascade behaviour is covered by the route-level
 * `knowledge-bases.test.ts` against the real service + control plane;
 * these tests pin the snapshot-mapping helper directly so the
 * "what the SPA renders" contract stays explicit.
 */

import { describe, expect, test } from "vitest";
import type {
	KnowledgeBaseRecord,
	VectorStoreRecord,
	WorkspaceRecord,
} from "../../src/control-plane/types.js";
import { maybeCreateCollectionSnapshot } from "../../src/services/knowledge-base-service.js";

function makeWorkspace(overrides: Partial<WorkspaceRecord>): WorkspaceRecord {
	return {
		uid: "00000000-0000-4000-8000-000000000001",
		name: "ws",
		kind: "astra",
		url: "https://example-database.apps.astra.datastax.com",
		credentials: {},
		keyspace: "default_keyspace",
		rlacEnabled: false,
		createdAt: "2026-05-01T00:00:00Z",
		updatedAt: "2026-05-01T00:00:00Z",
		...overrides,
	};
}

function makeKnowledgeBase(
	overrides: Partial<KnowledgeBaseRecord>,
): KnowledgeBaseRecord {
	return {
		workspaceId: "00000000-0000-4000-8000-000000000001",
		knowledgeBaseId: "00000000-0000-4000-8000-000000000010",
		name: "products",
		description: null,
		status: "active",
		embeddingServiceId: "00000000-0000-4000-8000-000000000100",
		chunkingServiceId: "00000000-0000-4000-8000-000000000101",
		rerankingServiceId: null,
		language: "en",
		vectorCollection: "products",
		owned: true,
		lexical: { enabled: false, analyzer: null, options: {} },
		policyDsl: null,
		policyEnabled: false,
		createdAt: "2026-05-01T00:00:00Z",
		updatedAt: "2026-05-01T00:00:00Z",
		...overrides,
	};
}

function makeDescriptor(
	overrides: Partial<VectorStoreRecord>,
): VectorStoreRecord {
	return {
		workspace: "00000000-0000-4000-8000-000000000001",
		uid: "00000000-0000-4000-8000-000000000010",
		name: "products",
		vectorDimension: 1536,
		vectorSimilarity: "cosine",
		embedding: {
			provider: "openai",
			model: "text-embedding-3-small",
			endpoint: null,
			dimension: 1536,
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
		createdAt: "2026-05-01T00:00:00Z",
		updatedAt: "2026-05-01T00:00:00Z",
		...overrides,
	};
}

describe("maybeCreateCollectionSnapshot", () => {
	test("emits a snapshot with vectorize service for Astra workspaces", () => {
		const snapshot = maybeCreateCollectionSnapshot({
			workspace: makeWorkspace({}),
			knowledgeBase: makeKnowledgeBase({}),
			descriptor: makeDescriptor({}),
		});
		expect(snapshot).not.toBeNull();
		if (!snapshot) return;
		expect(snapshot.kind).toBe("create_collection");
		expect(snapshot.knowledgeBaseId).toBe(
			"00000000-0000-4000-8000-000000000010",
		);
		expect(snapshot.kbName).toBe("products");
		expect(snapshot.collection).toBe("products");
		expect(snapshot.keyspace).toBe("default_keyspace");
		expect(snapshot.options.vectorDimension).toBe(1536);
		expect(snapshot.options.vectorMetric).toBe("cosine");
		expect(snapshot.options.vectorize).toEqual({
			provider: "openai",
			modelName: "text-embedding-3-small",
		});
		expect(snapshot.options.lexical).toBeNull();
		expect(snapshot.options.rerank).toBeNull();
	});

	test("returns null for non-Astra workspaces (mock / file backends)", () => {
		const snapshot = maybeCreateCollectionSnapshot({
			workspace: makeWorkspace({ kind: "mock" }),
			knowledgeBase: makeKnowledgeBase({}),
			descriptor: makeDescriptor({}),
		});
		expect(snapshot).toBeNull();
	});

	test("emits snapshot for HCD workspaces (same Data API surface as Astra)", () => {
		const snapshot = maybeCreateCollectionSnapshot({
			workspace: makeWorkspace({ kind: "hcd" }),
			knowledgeBase: makeKnowledgeBase({}),
			descriptor: makeDescriptor({}),
		});
		expect(snapshot).not.toBeNull();
		expect(snapshot?.kind).toBe("create_collection");
	});

	test("vectorize is null when the embedding provider isn't allowlisted", () => {
		const snapshot = maybeCreateCollectionSnapshot({
			workspace: makeWorkspace({}),
			knowledgeBase: makeKnowledgeBase({}),
			descriptor: makeDescriptor({
				embedding: {
					provider: "mock",
					model: "mock-embedder",
					endpoint: null,
					dimension: 1536,
					secretRef: null,
				},
			}),
		});
		expect(snapshot?.options.vectorize).toBeNull();
	});

	test("includes lexical when enabled with an analyzer", () => {
		const snapshot = maybeCreateCollectionSnapshot({
			workspace: makeWorkspace({}),
			knowledgeBase: makeKnowledgeBase({}),
			descriptor: makeDescriptor({
				lexical: { enabled: true, analyzer: "standard", options: {} },
			}),
		});
		expect(snapshot?.options.lexical).toEqual({
			enabled: true,
			analyzer: "standard",
		});
	});

	test("omits lexical when enabled but analyzer is missing", () => {
		const snapshot = maybeCreateCollectionSnapshot({
			workspace: makeWorkspace({}),
			knowledgeBase: makeKnowledgeBase({}),
			descriptor: makeDescriptor({
				lexical: { enabled: true, analyzer: null, options: {} },
			}),
		});
		expect(snapshot?.options.lexical).toBeNull();
	});

	test("includes rerank when fully configured", () => {
		const snapshot = maybeCreateCollectionSnapshot({
			workspace: makeWorkspace({}),
			knowledgeBase: makeKnowledgeBase({}),
			descriptor: makeDescriptor({
				reranking: {
					enabled: true,
					provider: "nvidia",
					model: "nv-rerankqa-mistral-4b-v3",
					endpoint: null,
					secretRef: null,
				},
			}),
		});
		expect(snapshot?.options.rerank).toEqual({
			enabled: true,
			provider: "nvidia",
			modelName: "nv-rerankqa-mistral-4b-v3",
		});
	});

	test("maps internal `dot` metric onto Astra's `dot_product` enum value", () => {
		const snapshot = maybeCreateCollectionSnapshot({
			workspace: makeWorkspace({}),
			knowledgeBase: makeKnowledgeBase({}),
			descriptor: makeDescriptor({ vectorSimilarity: "dot" }),
		});
		expect(snapshot?.options.vectorMetric).toBe("dot_product");
	});
});
