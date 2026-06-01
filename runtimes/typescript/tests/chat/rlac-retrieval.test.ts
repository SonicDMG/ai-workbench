/**
 * RLAC P2 (the flagship): agent retrieval must honor the same row-level
 * access policy the REST routes do. These are end-to-end integration
 * tests against the real mock vector driver — two documents are ingested
 * with distinct visibility (their chunks carry `visible_to`), and we
 * assert the `search_kb` tool and `retrieveContext` only ever surface
 * chunks the caller's principal may see.
 */

import { describe, expect, test } from "vitest";
import type { ResolvedPrincipal } from "../../src/auth/types.js";
import { retrieveContext } from "../../src/chat/retrieval.js";
import { resolveTool } from "../../src/chat/tools/registry.js";
import { MemoryControlPlaneStore } from "../../src/control-plane/memory/store.js";
import { MockVectorStoreDriver } from "../../src/drivers/mock/store.js";
import { VectorStoreDriverRegistry } from "../../src/drivers/registry.js";
import { runKbIngest } from "../../src/ingest/pipeline.js";
import { resolveKb } from "../../src/routes/api-v1/kb-descriptor.js";
import { makeFakeEmbedderFactory } from "../helpers/embedder.js";

const CANONICAL_DSL =
	"current_principal_id() = ANY(visible_to) OR '*' = ANY(visible_to)";

function principal(id: string, workspaceId: string): ResolvedPrincipal {
	return { id, workspaceId, attributes: {}, role: "viewer" };
}

async function setup() {
	const store = new MemoryControlPlaneStore();
	const driver = new MockVectorStoreDriver();
	const drivers = new VectorStoreDriverRegistry(new Map([["mock", driver]]));
	const embedders = makeFakeEmbedderFactory();

	const ws = await store.createWorkspace({
		name: "w",
		kind: "mock",
		url: null,
		credentials: {},
		keyspace: null,
	});
	await store.updateWorkspace(ws.uid, { rlacEnabled: true });
	const emb = await store.createEmbeddingService(ws.uid, {
		name: "e",
		provider: "mock",
		modelName: "mock",
		embeddingDimension: 4,
	});
	const chunk = await store.createChunkingService(ws.uid, {
		name: "c",
		engine: "langchain_ts",
		strategy: "recursive",
	});
	const kb = await store.createKnowledgeBase(ws.uid, {
		name: "kb",
		embeddingServiceId: emb.embeddingServiceId,
		chunkingServiceId: chunk.chunkingServiceId,
	});
	await store.updateKnowledgeBase(ws.uid, kb.knowledgeBaseId, {
		policyDsl: CANONICAL_DSL,
		policyEnabled: true,
	});

	const resolved = await resolveKb(store, ws.uid, kb.knowledgeBaseId);
	await driver.createCollection({
		workspace: resolved.workspace,
		descriptor: resolved.descriptor,
	});

	const docA = await store.createRagDocument(ws.uid, kb.knowledgeBaseId, {
		sourceFilename: "alice.txt",
		visibleTo: ["alice"],
	});
	const docB = await store.createRagDocument(ws.uid, kb.knowledgeBaseId, {
		sourceFilename: "bob.txt",
		visibleTo: ["bob"],
	});
	const ingest = (documentId: string, text: string) =>
		runKbIngest(
			{ store, drivers, embedders },
			{
				workspace: resolved.workspace,
				knowledgeBase: resolved.knowledgeBase,
				descriptor: resolved.descriptor,
				documentId,
			},
			{ text },
		);
	await ingest(
		docA.documentId,
		"alpha apple secret content one two three four",
	);
	await ingest(
		docB.documentId,
		"bravo banana secret content five six seven eight",
	);

	return {
		store,
		drivers,
		embedders,
		workspaceId: ws.uid,
		knowledgeBaseId: kb.knowledgeBaseId,
		docAId: docA.documentId,
		docBId: docB.documentId,
	};
}

describe("RLAC agent retrieval enforcement", () => {
	test("search_kb returns only chunks the caller's principal may see", async () => {
		const f = await setup();
		const searchKb = resolveTool("search_kb");
		expect(searchKb).not.toBeNull();

		const aliceOut = await searchKb?.execute(
			{ query: "secret content", limit: 8 },
			{
				workspaceId: f.workspaceId,
				store: f.store,
				drivers: f.drivers,
				embedders: f.embedders,
				principal: principal("alice", f.workspaceId),
			},
		);
		const alice = JSON.parse(aliceOut ?? "{}") as {
			results?: Array<{ documentId: string | null }>;
		};
		expect(alice.results?.length).toBeGreaterThan(0);
		for (const r of alice.results ?? []) expect(r.documentId).toBe(f.docAId);

		const bobOut = await searchKb?.execute(
			{ query: "secret content", limit: 8 },
			{
				workspaceId: f.workspaceId,
				store: f.store,
				drivers: f.drivers,
				embedders: f.embedders,
				principal: principal("bob", f.workspaceId),
			},
		);
		const bob = JSON.parse(bobOut ?? "{}") as {
			results?: Array<{ documentId: string | null }>;
		};
		expect(bob.results?.length).toBeGreaterThan(0);
		for (const r of bob.results ?? []) expect(r.documentId).toBe(f.docBId);
	});

	test("retrieveContext grounds only on chunks the caller may see", async () => {
		const f = await setup();
		const { chunks } = await retrieveContext(
			{ store: f.store, drivers: f.drivers, embedders: f.embedders },
			{
				workspaceId: f.workspaceId,
				knowledgeBaseIds: [f.knowledgeBaseId],
				query: "secret content",
				retrievalK: 8,
				principal: principal("alice", f.workspaceId),
			},
		);
		expect(chunks.length).toBeGreaterThan(0);
		for (const c of chunks) expect(c.documentId).toBe(f.docAId);
	});

	test("retrieveContext returns nothing when policy is on and no principal resolves", async () => {
		const f = await setup();
		const { chunks } = await retrieveContext(
			{ store: f.store, drivers: f.drivers, embedders: f.embedders },
			{
				workspaceId: f.workspaceId,
				knowledgeBaseIds: [f.knowledgeBaseId],
				query: "secret content",
				retrievalK: 8,
				principal: null,
			},
		);
		expect(chunks).toHaveLength(0);
	});
});
