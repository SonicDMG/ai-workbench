/**
 * RLAC P0: `runKbIngest` must mirror the owning document's `visibleTo`
 * onto every chunk payload (key `visible_to`) so the policy filter can be
 * pushed down into the vector query — and must leave the key unset when
 * the document has no RLAC visibility, so RLAC-off payloads are unchanged.
 */

import { describe, expect, test } from "vitest";
import { MemoryControlPlaneStore } from "../../src/control-plane/memory/store.js";
import { MockVectorStoreDriver } from "../../src/drivers/mock/store.js";
import { VectorStoreDriverRegistry } from "../../src/drivers/registry.js";
import { runKbIngest } from "../../src/ingest/pipeline.js";
import { resolveKb } from "../../src/routes/api-v1/kb-descriptor.js";
import { makeFakeEmbedderFactory } from "../helpers/embedder.js";

async function setup(visibleTo: readonly string[] | null) {
	const store = new MemoryControlPlaneStore();
	const driver = new MockVectorStoreDriver();
	const drivers = new VectorStoreDriverRegistry(new Map([["mock", driver]]));
	const embedders = makeFakeEmbedderFactory();

	const ws = await store.createWorkspace({ name: "w", kind: "mock" });
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
	const resolved = await resolveKb(store, ws.uid, kb.knowledgeBaseId);
	await driver.createCollection({
		workspace: resolved.workspace,
		descriptor: resolved.descriptor,
	});
	const doc = await store.createRagDocument(ws.uid, kb.knowledgeBaseId, {
		sourceFilename: "alpha.txt",
		visibleTo,
	});

	async function ingest() {
		await runKbIngest(
			{ store, drivers, embedders },
			{
				workspace: resolved.workspace,
				knowledgeBase: resolved.knowledgeBase,
				descriptor: resolved.descriptor,
				documentId: doc.documentId,
			},
			{ text: "alpha bravo charlie delta echo foxtrot golf hotel" },
		);
		return driver.listRecords(
			{ workspace: resolved.workspace, descriptor: resolved.descriptor },
			{ filter: { documentId: doc.documentId } },
		);
	}

	return { ingest };
}

describe("runKbIngest RLAC chunk visibility", () => {
	test("stamps visible_to onto chunks when the document carries RLAC visibility", async () => {
		const { ingest } = await setup(["alice", "*"]);
		const records = await ingest();
		expect(records.length).toBeGreaterThan(0);
		for (const r of records) {
			// `visible_to` is a set — order is not significant (the store
			// mirrors Astra's SET<text>), so compare membership.
			expect(new Set(r.payload.visible_to as string[])).toEqual(
				new Set(["alice", "*"]),
			);
		}
	});

	test("leaves visible_to unset when the document has no RLAC visibility", async () => {
		const { ingest } = await setup(null);
		const records = await ingest();
		expect(records.length).toBeGreaterThan(0);
		for (const r of records) {
			expect(r.payload).not.toHaveProperty("visible_to");
		}
	});
});
