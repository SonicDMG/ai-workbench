/**
 * Regression coverage for the chat retrieval layer's payload-key
 * handling. The ingest pipeline stamps chunk text under the
 * reserved `CHUNK_TEXT_KEY` (= "chunkText"); retrieval must read
 * that key first or MCP `chat_send` builds an empty context block.
 * The `payload.content` / `payload.text` fallbacks remain for older
 * data and for drivers that don't round-trip the reserved key.
 */

import { describe, expect, test, vi } from "vitest";
import { retrieveContext } from "../../src/chat/retrieval.js";
import type { VectorStoreDriverRegistry } from "../../src/drivers/registry.js";
import type { SearchHit } from "../../src/drivers/vector-store.js";
import type { EmbedderFactory } from "../../src/embeddings/factory.js";
import { CHUNK_TEXT_KEY } from "../../src/ingest/payload-keys.js";

// `resolveKb` is overridden per-test to control the workspace kind +
// descriptor name (we want different shapes for the Astra / mock
// branches of `astraQueries` capture).
let resolveKbReturn: () => unknown = () => ({
	workspace: { uid: "ws-1", kind: "mock" },
	knowledgeBase: { name: "kb-mock" },
	descriptor: { name: "wb_vectors_mock" },
});
vi.mock("../../src/routes/api-v1/kb-descriptor.js", () => ({
	resolveKb: vi.fn(async (_store: unknown, _ws: string, _kbId: string) =>
		resolveKbReturn(),
	),
}));

let nextHits: readonly SearchHit[] = [];
vi.mock("../../src/routes/api-v1/search-dispatch.js", () => ({
	dispatchSearch: vi.fn(async () => nextHits),
}));

const fakeStore = {
	listKnowledgeBases: vi.fn(async () => []),
} as unknown as Parameters<typeof retrieveContext>[0]["store"];

const fakeDrivers = {
	for: vi.fn(() => ({})),
} as unknown as VectorStoreDriverRegistry;

const fakeEmbedders = {} as EmbedderFactory;

function deps() {
	return { store: fakeStore, drivers: fakeDrivers, embedders: fakeEmbedders };
}

function request() {
	return {
		workspaceId: "ws-1",
		knowledgeBaseIds: ["kb-1"],
		query: "hello",
		retrievalK: 3,
	};
}

describe("retrieveContext payload-key handling", () => {
	test("reads chunk text from CHUNK_TEXT_KEY when present", async () => {
		nextHits = [
			{
				id: "chunk-a",
				score: 0.9,
				payload: {
					[CHUNK_TEXT_KEY]: "the canonical chunk body",
					documentId: "doc-1",
				},
			},
		];
		const result = await retrieveContext(deps(), request());
		expect(result.chunks).toHaveLength(1);
		expect(result.chunks[0]).toMatchObject({
			chunkId: "chunk-a",
			content: "the canonical chunk body",
			documentId: "doc-1",
		});
	});

	test("falls back to payload.content when chunkText is absent", async () => {
		nextHits = [
			{
				id: "chunk-b",
				score: 0.8,
				payload: { content: "legacy content key" },
			},
		];
		const result = await retrieveContext(deps(), request());
		expect(result.chunks[0]?.content).toBe("legacy content key");
	});

	test("falls back to payload.text when chunkText and content are absent", async () => {
		nextHits = [
			{
				id: "chunk-c",
				score: 0.7,
				payload: { text: "legacy text key" },
			},
		];
		const result = await retrieveContext(deps(), request());
		expect(result.chunks[0]?.content).toBe("legacy text key");
	});

	test("prefers CHUNK_TEXT_KEY over content/text when multiple keys are present", async () => {
		nextHits = [
			{
				id: "chunk-d",
				score: 0.6,
				payload: {
					[CHUNK_TEXT_KEY]: "winner",
					content: "ignored",
					text: "ignored",
				},
			},
		];
		const result = await retrieveContext(deps(), request());
		expect(result.chunks[0]?.content).toBe("winner");
	});

	test("returns empty content (not crash) when no text-bearing key exists", async () => {
		nextHits = [{ id: "chunk-e", score: 0.5, payload: { documentId: "d" } }];
		const result = await retrieveContext(deps(), request());
		expect(result.chunks[0]?.content).toBe("");
	});
});

describe("retrieveContext astraQueries capture", () => {
	test("captures a query envelope per Astra-kind workspace KB (no token, no vector)", async () => {
		resolveKbReturn = () => ({
			workspace: {
				uid: "ws-1",
				kind: "astra",
				keyspace: "default_keyspace",
			},
			knowledgeBase: { name: "Engineering Docs" },
			descriptor: { name: "wb_vectors_kb_eng" },
		});
		nextHits = [
			{ id: "chunk-1", score: 0.9, payload: { [CHUNK_TEXT_KEY]: "hi" } },
		];
		const result = await retrieveContext(deps(), request());
		expect(result.astraQueries).toHaveLength(1);
		expect(result.astraQueries[0]).toEqual({
			knowledgeBaseId: "kb-1",
			kbName: "Engineering Docs",
			collection: "wb_vectors_kb_eng",
			keyspace: "default_keyspace",
			query: { text: "hello", topK: 3 },
		});
		// Tokens / raw vectors are NOT in the envelope by construction.
		// (Note: the collection name itself can contain "vector" — e.g.
		// `wb_vectors_kb_eng` — so we check for the field shape, not the
		// substring.)
		const serialized = JSON.stringify(result.astraQueries);
		expect(serialized).not.toContain("AstraCS");
		expect(serialized).not.toContain('"token"');
		expect(serialized).not.toContain('"$vector"');
	});

	test("emits NO astraQueries for non-Astra-kind workspaces (mock/file)", async () => {
		resolveKbReturn = () => ({
			workspace: { uid: "ws-1", kind: "mock", keyspace: null },
			knowledgeBase: { name: "kb-mock" },
			descriptor: { name: "wb_vectors_mock" },
		});
		nextHits = [
			{ id: "chunk-1", score: 0.9, payload: { [CHUNK_TEXT_KEY]: "hi" } },
		];
		const result = await retrieveContext(deps(), request());
		expect(result.astraQueries).toEqual([]);
	});

	test("a per-KB retrieval failure suppresses BOTH chunks and snapshot for that KB", async () => {
		resolveKbReturn = () => {
			throw new Error("kb gone");
		};
		const result = await retrieveContext(deps(), request());
		expect(result.chunks).toEqual([]);
		expect(result.astraQueries).toEqual([]);
	});
});
