/**
 * Tests for the RLAC flip-on bootstrap helper.
 *
 * The first time a workspace's `rlacEnabled` transitions from `false`
 * to `true`, the runtime needs to guarantee the workspace is usable:
 *
 *   1. At least one principal exists (default: `admin`) so the
 *      View-as picker can render and `current_principal_id()` resolves.
 *   2. Every existing document's `visibleTo` is populated so RLAC
 *      doesn't silently hide all pre-existing data behind a default
 *      DSL that treats missing arrays as "invisible".
 *
 * Without this, flipping on RLAC against an empty principal list and
 * a populated KB produces a UX dead-end: the KB is visible in the
 * sidebar but every document call returns `policy_principal_required`
 * with no surfaced remediation.
 */

import { describe, expect, test } from "vitest";
import { MemoryControlPlaneStore } from "../../src/control-plane/memory/store.js";
import { bootstrapRlacFlipOn } from "../../src/policy/flip-on-bootstrap.js";

async function freshWorkspace() {
	const store = new MemoryControlPlaneStore();
	const ws = await store.createWorkspace({ name: "ws", kind: "mock" });
	const chunking = await store.createChunkingService(ws.uid, {
		name: "default",
		engine: "line",
	});
	const embedding = await store.createEmbeddingService(ws.uid, {
		name: "default",
		provider: "mock",
		modelName: "mock-embed",
		embeddingDimension: 8,
	});
	const kb = await store.createKnowledgeBase(ws.uid, {
		name: "test-kb",
		chunkingServiceId: chunking.chunkingServiceId,
		embeddingServiceId: embedding.embeddingServiceId,
	});
	return { store, workspaceId: ws.uid, knowledgeBaseId: kb.knowledgeBaseId };
}

describe("bootstrapRlacFlipOn", () => {
	test("creates an 'admin' principal with admin:'true' attribute when workspace has none", async () => {
		const { store, workspaceId } = await freshWorkspace();
		const summary = await bootstrapRlacFlipOn(store, workspaceId);

		expect(summary.principalCreated).toBe(true);
		const principals = await store.listPrincipals(workspaceId);
		expect(principals.map((p) => p.principalId)).toContain("admin");
		const admin = principals.find((p) => p.principalId === "admin");
		expect(admin?.label).toMatch(/admin/i);
		// The admin attribute is what the default DSL's bypass clause
		// (`$principal.admin = 'true'`) keys off. Without it, admin
		// would only see docs whose `visible_to` includes it — exactly
		// the dead-end the bootstrap is meant to prevent.
		expect(admin?.attributes).toEqual({ admin: "true" });
	});

	test("does NOT create 'admin' when at least one principal already exists", async () => {
		const { store, workspaceId } = await freshWorkspace();
		await store.createPrincipal(workspaceId, {
			principalId: "alice",
			label: "Alice",
		});

		const summary = await bootstrapRlacFlipOn(store, workspaceId);

		expect(summary.principalCreated).toBe(false);
		const principals = await store.listPrincipals(workspaceId);
		expect(principals.map((p) => p.principalId)).toEqual(["alice"]);
	});

	test("backfills visibleTo:['*'] on documents whose visibleTo is null", async () => {
		const { store, workspaceId, knowledgeBaseId } = await freshWorkspace();
		await store.createRagDocument(workspaceId, knowledgeBaseId, {
			sourceFilename: "untagged.md",
			// no visibleTo → null
		});
		await store.createRagDocument(workspaceId, knowledgeBaseId, {
			sourceFilename: "also-untagged.md",
			visibleTo: null,
		});

		const summary = await bootstrapRlacFlipOn(store, workspaceId);

		expect(summary.documentsBackfilled).toBe(2);
		const docs = await store.listRagDocuments(workspaceId, knowledgeBaseId);
		for (const doc of docs) {
			expect(doc.visibleTo).toEqual(["*"]);
		}
	});

	test("does NOT touch documents that already have a visibleTo list", async () => {
		const { store, workspaceId, knowledgeBaseId } = await freshWorkspace();
		await store.createRagDocument(workspaceId, knowledgeBaseId, {
			sourceFilename: "private.md",
			visibleTo: ["alice"],
		});
		await store.createRagDocument(workspaceId, knowledgeBaseId, {
			sourceFilename: "untagged.md",
			// null → will be backfilled
		});

		const summary = await bootstrapRlacFlipOn(store, workspaceId);

		// Only the untagged one.
		expect(summary.documentsBackfilled).toBe(1);
		const docs = await store.listRagDocuments(workspaceId, knowledgeBaseId);
		const aliceDoc = docs.find((d) => d.sourceFilename === "private.md");
		const untaggedDoc = docs.find((d) => d.sourceFilename === "untagged.md");
		expect(aliceDoc?.visibleTo).toEqual(["alice"]);
		expect(untaggedDoc?.visibleTo).toEqual(["*"]);
	});

	test("treats an empty array (`[]`) as 'no audience' and leaves it alone", async () => {
		// An empty array is a deliberate "no audience" choice; backfilling
		// it would silently widen access. Only null/undefined gets the
		// default treatment.
		const { store, workspaceId, knowledgeBaseId } = await freshWorkspace();
		await store.createRagDocument(workspaceId, knowledgeBaseId, {
			sourceFilename: "embargoed.md",
			visibleTo: [],
		});

		const summary = await bootstrapRlacFlipOn(store, workspaceId);

		expect(summary.documentsBackfilled).toBe(0);
		const [doc] = await store.listRagDocuments(workspaceId, knowledgeBaseId);
		expect(doc?.visibleTo).toEqual([]);
	});

	test("spans every KB in the workspace (not just the first)", async () => {
		const { store, workspaceId, knowledgeBaseId } = await freshWorkspace();
		// Reuse the existing services for a second KB.
		const kbs = await store.listKnowledgeBases(workspaceId);
		const firstKb = kbs[0];
		if (!firstKb) throw new Error("expected at least one KB");
		const secondKb = await store.createKnowledgeBase(workspaceId, {
			name: "second-kb",
			chunkingServiceId: firstKb.chunkingServiceId,
			embeddingServiceId: firstKb.embeddingServiceId,
		});

		await store.createRagDocument(workspaceId, knowledgeBaseId, {
			sourceFilename: "in-kb-a.md",
		});
		await store.createRagDocument(workspaceId, secondKb.knowledgeBaseId, {
			sourceFilename: "in-kb-b.md",
		});

		const summary = await bootstrapRlacFlipOn(store, workspaceId);

		expect(summary.documentsBackfilled).toBe(2);
	});

	test("is idempotent — re-running is a no-op", async () => {
		const { store, workspaceId, knowledgeBaseId } = await freshWorkspace();
		await store.createRagDocument(workspaceId, knowledgeBaseId, {
			sourceFilename: "doc.md",
		});

		const first = await bootstrapRlacFlipOn(store, workspaceId);
		expect(first.principalCreated).toBe(true);
		expect(first.documentsBackfilled).toBe(1);

		const second = await bootstrapRlacFlipOn(store, workspaceId);
		expect(second.principalCreated).toBe(false);
		expect(second.documentsBackfilled).toBe(0);

		const principals = await store.listPrincipals(workspaceId);
		expect(principals).toHaveLength(1);
	});

	test("returns a summary even when the workspace has no KBs at all", async () => {
		const store = new MemoryControlPlaneStore();
		const ws = await store.createWorkspace({ name: "empty", kind: "mock" });

		const summary = await bootstrapRlacFlipOn(store, ws.uid);

		expect(summary.principalCreated).toBe(true);
		expect(summary.documentsBackfilled).toBe(0);
	});
});
