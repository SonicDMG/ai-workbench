/**
 * `search_kb` is the only path that produces tool effects today —
 * both the chunks the SPA renders as the Sources disclosure and the
 * `AstraQuerySnapshot` envelope that powers the "view client code"
 * affordance. This used to live on the implicit `retrieveContext`
 * branch; tool-using agents (Bobby/Heidi) bypassed it and the chip
 * never appeared.
 *
 * These tests pin the new contract: the tool surfaces both side
 * effects through `AgentToolDeps.effects` for `astra` / `hcd`
 * workspaces, and surfaces only chunks for everything else.
 *
 * Mocking strategy mirrors `retrieval.test.ts` — `resolveKb` and
 * `dispatchSearch` are stubbed at the module boundary so each test
 * controls workspace kind + hit shape without booting the real
 * driver registry.
 */

import { describe, expect, test, vi } from "vitest";
import type {
	AgentToolDeps,
	ToolEffectsSink,
} from "../../src/chat/tools/registry.js";
import { resolveTool } from "../../src/chat/tools/registry.js";
import type { VectorStoreDriverRegistry } from "../../src/drivers/registry.js";
import type { SearchHit } from "../../src/drivers/vector-store.js";
import type { EmbedderFactory } from "../../src/embeddings/factory.js";
import { CHUNK_TEXT_KEY } from "../../src/ingest/payload-keys.js";

let resolveKbReturn: () => unknown = () => ({
	workspace: { uid: "ws-1", kind: "mock", keyspace: null },
	knowledgeBase: { name: "kb-mock" },
	descriptor: { name: "wb_vectors_mock" },
});
vi.mock("../../src/routes/api-v1/kb-descriptor.js", () => ({
	resolveKb: vi.fn(async () => resolveKbReturn()),
}));

let nextHits: readonly SearchHit[] = [];
vi.mock("../../src/routes/api-v1/search-dispatch.js", () => ({
	dispatchSearch: vi.fn(async () => nextHits),
}));

const fakeStore = {
	listKnowledgeBases: vi.fn(async () => [
		{ knowledgeBaseId: "kb-1", name: "kb" },
	]),
} as unknown as AgentToolDeps["store"];

const fakeDrivers = {
	for: vi.fn(() => ({})),
} as unknown as VectorStoreDriverRegistry;

const fakeEmbedders = {} as EmbedderFactory;

interface CollectorState {
	readonly chunks: { knowledgeBaseId: string; chunkId: string }[];
	readonly snapshots: unknown[];
	readonly sink: ToolEffectsSink;
}

function makeCollector(): CollectorState {
	const chunks: { knowledgeBaseId: string; chunkId: string }[] = [];
	const snapshots: unknown[] = [];
	return {
		chunks,
		snapshots,
		sink: {
			pushChunks: (cs) => {
				for (const c of cs) {
					chunks.push({
						knowledgeBaseId: c.knowledgeBaseId,
						chunkId: c.chunkId,
					});
				}
			},
			pushAstraQuery: (s) => {
				snapshots.push(s);
			},
		},
	};
}

function depsWith(sink: ToolEffectsSink): AgentToolDeps {
	return {
		workspaceId: "ws-1",
		store: fakeStore,
		drivers: fakeDrivers,
		embedders: fakeEmbedders,
		effects: sink,
	};
}

describe("search_kb tool effects sink", () => {
	test("pushes both chunks and an Astra snapshot for an astra workspace", async () => {
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
			{
				id: "chunk-1",
				score: 0.9,
				payload: { [CHUNK_TEXT_KEY]: "hello", documentId: "doc-1" },
			},
		];

		const collector = makeCollector();
		const out = await resolveTool("search_kb")?.execute(
			{ query: "what's in the docs?", limit: 4 },
			depsWith(collector.sink),
		);

		// Tool result still carries the JSON the model consumes — the
		// sink is purely additive, not a replacement.
		expect(out).toMatch(/^\{/);
		expect(collector.chunks).toEqual([
			{ knowledgeBaseId: "kb-1", chunkId: "chunk-1" },
		]);
		expect(collector.snapshots).toEqual([
			{
				kind: "vector_search",
				knowledgeBaseId: "kb-1",
				kbName: "Engineering Docs",
				collection: "wb_vectors_kb_eng",
				keyspace: "default_keyspace",
				query: { text: "what's in the docs?", topK: 4 },
			},
		]);
	});

	test("pushes chunks but NO snapshot for non-astra workspaces", async () => {
		resolveKbReturn = () => ({
			workspace: { uid: "ws-1", kind: "mock", keyspace: null },
			knowledgeBase: { name: "kb-mock" },
			descriptor: { name: "wb_vectors_mock" },
		});
		nextHits = [
			{
				id: "chunk-2",
				score: 0.8,
				payload: { [CHUNK_TEXT_KEY]: "hi", documentId: "doc-2" },
			},
		];

		const collector = makeCollector();
		await resolveTool("search_kb")?.execute(
			{ query: "anything" },
			depsWith(collector.sink),
		);

		expect(collector.chunks).toHaveLength(1);
		expect(collector.snapshots).toEqual([]);
	});

	test("pushes nothing when there are no hits", async () => {
		resolveKbReturn = () => ({
			workspace: {
				uid: "ws-1",
				kind: "astra",
				keyspace: "default_keyspace",
			},
			knowledgeBase: { name: "kb" },
			descriptor: { name: "wb_vectors_kb" },
		});
		nextHits = [];

		const collector = makeCollector();
		const out = await resolveTool("search_kb")?.execute(
			{ query: "no match" },
			depsWith(collector.sink),
		);

		// Friendly placeholder, no chunks pushed (so the SPA doesn't
		// render a Sources disclosure for an empty turn) — but the
		// snapshot still fires because the call DID hit Astra and is
		// runnable client-side. This matches the prior behavior of the
		// implicit-retrieval branch: empty results still emit an envelope.
		expect(out).toMatch(/no matching content/i);
		expect(collector.chunks).toEqual([]);
		expect(collector.snapshots).toHaveLength(1);
	});

	test("absent sink (e.g. MCP caller) is a no-op — tool still returns text", async () => {
		resolveKbReturn = () => ({
			workspace: {
				uid: "ws-1",
				kind: "astra",
				keyspace: "default_keyspace",
			},
			knowledgeBase: { name: "kb" },
			descriptor: { name: "wb_vectors_kb" },
		});
		nextHits = [
			{
				id: "chunk-1",
				score: 0.9,
				payload: { [CHUNK_TEXT_KEY]: "hello" },
			},
		];

		const out = await resolveTool("search_kb")?.execute(
			{ query: "x" },
			{
				workspaceId: "ws-1",
				store: fakeStore,
				drivers: fakeDrivers,
				embedders: fakeEmbedders,
			},
		);
		expect(out).toMatch(/^\{/);
	});
});

describe("list_chunks tool effects sink", () => {
	const docId = "11111111-1111-4111-8111-111111111111";
	const kbId = "22222222-2222-4222-8222-222222222222";

	function depsForListChunks(sink: ToolEffectsSink): AgentToolDeps {
		const store = {
			getRagDocument: vi.fn(async () => ({
				documentId: docId,
				knowledgeBaseId: kbId,
				chunkTotal: 3,
			})),
		} as unknown as AgentToolDeps["store"];
		const drivers = {
			for: vi.fn(() => ({
				// Minimal driver shim — list_chunks just needs `listRecords`
				// to exist and return a (possibly empty) array. The
				// snapshot push fires before the call returns, so the
				// returned shape doesn't matter for the assertion below.
				listRecords: vi.fn(async () => []),
			})),
		} as unknown as VectorStoreDriverRegistry;
		return {
			workspaceId: "ws-1",
			store,
			drivers,
			embedders: fakeEmbedders,
			effects: sink,
		};
	}

	test("pushes a list_chunks snapshot for an astra workspace", async () => {
		resolveKbReturn = () => ({
			workspace: {
				uid: "ws-1",
				kind: "astra",
				keyspace: "default_keyspace",
			},
			knowledgeBase: { name: "Engineering Docs" },
			descriptor: { name: "wb_vectors_kb_eng" },
		});

		const collector = makeCollector();
		const out = await resolveTool("list_chunks")?.execute(
			{ knowledgeBaseId: kbId, documentId: docId, limit: 2, offset: 4 },
			depsForListChunks(collector.sink),
		);

		expect(out).toMatch(/^\{/);
		expect(collector.snapshots).toEqual([
			{
				kind: "list_chunks",
				knowledgeBaseId: kbId,
				kbName: "Engineering Docs",
				collection: "wb_vectors_kb_eng",
				keyspace: "default_keyspace",
				query: { documentId: docId, limit: 2, offset: 4 },
			},
		]);
		// `list_chunks` doesn't use the chunk-push channel — the
		// `chunks` accumulator (which feeds `metadata.context_chunks`
		// and the Sources disclosure) is only populated by `search_kb`.
		// Positional reads aren't "sources" in the citation sense.
		expect(collector.chunks).toEqual([]);
	});

	test("pushes nothing for non-astra workspaces", async () => {
		resolveKbReturn = () => ({
			workspace: { uid: "ws-1", kind: "mock", keyspace: null },
			knowledgeBase: { name: "kb-mock" },
			descriptor: { name: "wb_vectors_mock" },
		});

		const collector = makeCollector();
		await resolveTool("list_chunks")?.execute(
			{ knowledgeBaseId: kbId, documentId: docId, limit: 2 },
			depsForListChunks(collector.sink),
		);
		expect(collector.snapshots).toEqual([]);
	});

	test("absent sink (e.g. MCP caller) is a no-op — tool still returns text", async () => {
		resolveKbReturn = () => ({
			workspace: {
				uid: "ws-1",
				kind: "astra",
				keyspace: "default_keyspace",
			},
			knowledgeBase: { name: "kb" },
			descriptor: { name: "wb_vectors_kb" },
		});

		const out = await resolveTool("list_chunks")?.execute(
			{ knowledgeBaseId: kbId, documentId: docId },
			(() => {
				const deps = depsForListChunks({});
				const { effects: _drop, ...rest } = deps;
				return rest;
			})(),
		);
		expect(out).toMatch(/^\{/);
	});
});
