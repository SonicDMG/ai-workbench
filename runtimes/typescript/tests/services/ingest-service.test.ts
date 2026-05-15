/**
 * Unit tests for `IngestService`'s snapshot-emission helper. The
 * full sync + async + dedup + name-conflict flows are covered by the
 * route-level `knowledge-bases.test.ts`; this file pins only the
 * "what the SPA renders" contract for the `insert_chunks` snapshot.
 */

import { describe, expect, test } from "vitest";
import type {
	KnowledgeBaseRecord,
	VectorStoreRecord,
	WorkspaceRecord,
} from "../../src/control-plane/types.js";
import { maybeInsertChunksSnapshots } from "../../src/services/ingest-service.js";

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

describe("maybeInsertChunksSnapshots", () => {
	test("emits one insert_chunks snapshot for Astra workspaces", () => {
		const snapshots = maybeInsertChunksSnapshots({
			workspace: makeWorkspace({}),
			knowledgeBase: makeKnowledgeBase({}),
			descriptor: makeDescriptor({}),
			documentId: "doc-1",
		});
		expect(snapshots).toHaveLength(1);
		const [s] = snapshots;
		if (!s) return;
		expect(s.kind).toBe("insert_chunks");
		expect(s.knowledgeBaseId).toBe("00000000-0000-4000-8000-000000000010");
		expect(s.kbName).toBe("products");
		expect(s.collection).toBe("products");
		expect(s.keyspace).toBe("default_keyspace");
		expect(s.batch.documentId).toBe("doc-1");
		expect(s.batch.batchSize).toBeGreaterThan(0);
	});

	test("emits snapshot for HCD workspaces", () => {
		const snapshots = maybeInsertChunksSnapshots({
			workspace: makeWorkspace({ kind: "hcd" }),
			knowledgeBase: makeKnowledgeBase({}),
			descriptor: makeDescriptor({}),
			documentId: "doc-2",
		});
		expect(snapshots).toHaveLength(1);
		expect(snapshots[0]?.kind).toBe("insert_chunks");
	});

	test("returns empty array for non-Astra workspaces (mock / file)", () => {
		expect(
			maybeInsertChunksSnapshots({
				workspace: makeWorkspace({ kind: "mock" }),
				knowledgeBase: makeKnowledgeBase({}),
				descriptor: makeDescriptor({}),
				documentId: "doc-3",
			}),
		).toEqual([]);
	});

	test("documentId is captured verbatim — used in the generated snippet", () => {
		const snapshots = maybeInsertChunksSnapshots({
			workspace: makeWorkspace({}),
			knowledgeBase: makeKnowledgeBase({}),
			descriptor: makeDescriptor({}),
			documentId: "11111111-1111-4111-8111-111111111111",
		});
		expect(snapshots[0]?.batch.documentId).toBe(
			"11111111-1111-4111-8111-111111111111",
		);
	});

	test("collection name comes from the descriptor, not the KB name", () => {
		// Owned KBs derive `descriptor.name` from KB name; attach mode
		// can have descriptor.name differ. Pin that the descriptor is
		// authoritative.
		const snapshots = maybeInsertChunksSnapshots({
			workspace: makeWorkspace({}),
			knowledgeBase: makeKnowledgeBase({ name: "kb_display_name" }),
			descriptor: makeDescriptor({ name: "underlying_collection" }),
			documentId: "doc-4",
		});
		expect(snapshots[0]?.collection).toBe("underlying_collection");
	});
});
