/**
 * Regression coverage for the chat retrieval layer's payload-key
 * handling. The ingest pipeline stamps chunk text under the
 * reserved `CHUNK_TEXT_KEY` (= "chunkText"); retrieval must read
 * that key first or every ragEnabled agent gets an empty context
 * block. The `payload.content` / `payload.text` fallbacks remain
 * for older data and for drivers that don't round-trip the
 * reserved key.
 */

import { describe, expect, test, vi } from "vitest";
import { retrieveContext } from "../../src/chat/retrieval.js";
import type { VectorStoreDriverRegistry } from "../../src/drivers/registry.js";
import type { SearchHit } from "../../src/drivers/vector-store.js";
import type { EmbedderFactory } from "../../src/embeddings/factory.js";
import { CHUNK_TEXT_KEY } from "../../src/ingest/payload-keys.js";

vi.mock("../../src/routes/api-v1/kb-descriptor.js", () => ({
	resolveKb: vi.fn(async (_store: unknown, _ws: string, _kbId: string) => ({
		workspace: { uid: "ws-1", kind: "mock" },
	})),
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
		expect(result).toHaveLength(1);
		expect(result[0]).toMatchObject({
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
		expect(result[0]?.content).toBe("legacy content key");
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
		expect(result[0]?.content).toBe("legacy text key");
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
		expect(result[0]?.content).toBe("winner");
	});

	test("returns empty content (not crash) when no text-bearing key exists", async () => {
		nextHits = [{ id: "chunk-e", score: 0.5, payload: { documentId: "d" } }];
		const result = await retrieveContext(deps(), request());
		expect(result[0]?.content).toBe("");
	});
});
