/**
 * Route-level coverage for the knowledge-base + execution-service
 * surface introduced by issue #98 (phase 1b).
 *
 * Mirrors the legacy `app.test.ts` pattern: spin up an app backed by
 * a memory store + mock driver, drive HTTP through `app.request`, and
 * assert on JSON.
 */

import { randomUUID } from "node:crypto";
import { describe, expect, test } from "vitest";
import { createApp } from "../src/app.js";
import { AuthResolver } from "../src/auth/resolver.js";
import { MemoryControlPlaneStore } from "../src/control-plane/memory/store.js";
import { MockVectorStoreDriver } from "../src/drivers/mock/store.js";
import { VectorStoreDriverRegistry } from "../src/drivers/registry.js";
import { EnvSecretProvider } from "../src/secrets/env.js";
import { SecretResolver } from "../src/secrets/provider.js";
import { makeFakeEmbedderFactory } from "./helpers/embedder.js";

// biome-ignore lint/suspicious/noExplicitAny: test helper returns untyped JSON
async function json(res: Response): Promise<any> {
	// biome-ignore lint/suspicious/noExplicitAny: test helper returns untyped JSON
	return (await res.json()) as any;
}

function makeApp() {
	const store = new MemoryControlPlaneStore();
	const driver = new MockVectorStoreDriver();
	const drivers = new VectorStoreDriverRegistry(new Map([["mock", driver]]));
	const secrets = new SecretResolver({ env: new EnvSecretProvider() });
	const auth = new AuthResolver({
		mode: "disabled",
		anonymousPolicy: "allow",
		verifiers: [],
	});
	const embedders = makeFakeEmbedderFactory();
	return createApp({ store, drivers, secrets, auth, embedders });
}

async function createWorkspace(
	app: ReturnType<typeof makeApp>,
): Promise<string> {
	const res = await app.request("/api/v1/workspaces", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ name: "ws", kind: "mock" }),
	});
	expect(res.status).toBe(201);
	return (await json(res)).uid as string;
}

async function createService(
	app: ReturnType<typeof makeApp>,
	workspaceUid: string,
	path: string,
	body: Record<string, unknown>,
): Promise<string> {
	const res = await app.request(`/api/v1/workspaces/${workspaceUid}/${path}`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(body),
	});
	expect(res.status, await res.clone().text()).toBe(201);
	const j = await json(res);
	// Each service surfaces its own *ServiceId field.
	return (j.embeddingServiceId ??
		j.chunkingServiceId ??
		j.rerankingServiceId) as string;
}

describe("execution service routes", () => {
	test("CRUD round-trip on chunking-services", async () => {
		const app = makeApp();
		const ws = await createWorkspace(app);

		const created = await app.request(
			`/api/v1/workspaces/${ws}/chunking-services`,
			{
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					name: "docling-default",
					engine: "docling",
					strategy: "layout",
					maxChunkSize: 500,
				}),
			},
		);
		expect(created.status).toBe(201);
		const cBody = await json(created);
		expect(cBody.name).toBe("docling-default");
		expect(cBody.engine).toBe("docling");
		expect(cBody.status).toBe("active"); // default

		const list = await app.request(
			`/api/v1/workspaces/${ws}/chunking-services`,
		);
		expect(list.status).toBe(200);
		expect((await json(list)).items).toHaveLength(1);

		const updated = await app.request(
			`/api/v1/workspaces/${ws}/chunking-services/${cBody.chunkingServiceId}`,
			{
				method: "PUT",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ status: "deprecated" }),
			},
		);
		expect(updated.status).toBe(200);
		expect((await json(updated)).status).toBe("deprecated");

		const del = await app.request(
			`/api/v1/workspaces/${ws}/chunking-services/${cBody.chunkingServiceId}`,
			{ method: "DELETE" },
		);
		expect(del.status).toBe(204);
	});

	test("embedding service supportedLanguages roundtrip as sorted array", async () => {
		const app = makeApp();
		const ws = await createWorkspace(app);

		const res = await app.request(
			`/api/v1/workspaces/${ws}/embedding-services`,
			{
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					name: "openai-3-small",
					provider: "openai",
					modelName: "text-embedding-3-small",
					embeddingDimension: 1536,
					supportedLanguages: ["fr", "en", "fr"],
					supportedContent: ["text"],
				}),
			},
		);
		expect(res.status).toBe(201);
		const body = await json(res);
		expect(body.supportedLanguages).toEqual(["en", "fr"]);
		expect(body.supportedContent).toEqual(["text"]);
	});

	test("creating a service with malformed body returns 400", async () => {
		const app = makeApp();
		const ws = await createWorkspace(app);
		const res = await app.request(
			`/api/v1/workspaces/${ws}/embedding-services`,
			{
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ name: "" /* missing required fields */ }),
			},
		);
		expect(res.status).toBe(400);
	});
});

describe("knowledge-base routes", () => {
	test("create requires existing services and validates inputs", async () => {
		const app = makeApp();
		const ws = await createWorkspace(app);

		// References don't exist yet → 404.
		const missing = await app.request(
			`/api/v1/workspaces/${ws}/knowledge-bases`,
			{
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					name: "products",
					embeddingServiceId: randomUUID(),
					chunkingServiceId: randomUUID(),
				}),
			},
		);
		expect(missing.status).toBe(404);
	});

	test("happy path: create services, create KB, fetch, update, delete", async () => {
		const app = makeApp();
		const ws = await createWorkspace(app);

		const embId = await createService(app, ws, "embedding-services", {
			name: "openai-3-small",
			provider: "openai",
			modelName: "text-embedding-3-small",
			embeddingDimension: 1536,
		});
		const chunkId = await createService(app, ws, "chunking-services", {
			name: "docling-default",
			engine: "docling",
		});
		const rerankId = await createService(app, ws, "reranking-services", {
			name: "cohere-rerank-3",
			provider: "cohere",
			modelName: "rerank-english-v3.0",
		});

		const create = await app.request(
			`/api/v1/workspaces/${ws}/knowledge-bases`,
			{
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					name: "products",
					description: "product catalog",
					embeddingServiceId: embId,
					chunkingServiceId: chunkId,
					rerankingServiceId: rerankId,
					language: "en",
				}),
			},
		);
		expect(create.status).toBe(201);
		const kb = await json(create);
		expect(kb.workspaceId).toBe(ws);
		expect(kb.embeddingServiceId).toBe(embId);
		expect(kb.chunkingServiceId).toBe(chunkId);
		expect(kb.rerankingServiceId).toBe(rerankId);
		expect(kb.vectorCollection).toMatch(/^wb_vectors_[0-9a-f]+$/);
		expect(kb.lexical.enabled).toBe(false);

		const get = await app.request(
			`/api/v1/workspaces/${ws}/knowledge-bases/${kb.knowledgeBaseId}`,
		);
		expect(get.status).toBe(200);
		expect((await json(get)).knowledgeBaseId).toBe(kb.knowledgeBaseId);

		// PUT changes mutable fields, doesn't touch the bound services.
		const upd = await app.request(
			`/api/v1/workspaces/${ws}/knowledge-bases/${kb.knowledgeBaseId}`,
			{
				method: "PUT",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					rerankingServiceId: null,
					language: "fr",
					status: "draft",
				}),
			},
		);
		expect(upd.status).toBe(200);
		const after = await json(upd);
		expect(after.rerankingServiceId).toBeNull();
		expect(after.language).toBe("fr");
		expect(after.status).toBe("draft");
		expect(after.embeddingServiceId).toBe(embId);

		const del = await app.request(
			`/api/v1/workspaces/${ws}/knowledge-bases/${kb.knowledgeBaseId}`,
			{ method: "DELETE" },
		);
		expect(del.status).toBe(204);
	});

	test("PUT rejects embeddingServiceId mutation via strict body validation", async () => {
		const app = makeApp();
		const ws = await createWorkspace(app);
		const embId = await createService(app, ws, "embedding-services", {
			name: "e",
			provider: "openai",
			modelName: "m",
			embeddingDimension: 4,
		});
		const chunkId = await createService(app, ws, "chunking-services", {
			name: "c",
			engine: "docling",
		});
		const create = await app.request(
			`/api/v1/workspaces/${ws}/knowledge-bases`,
			{
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					name: "kb",
					embeddingServiceId: embId,
					chunkingServiceId: chunkId,
				}),
			},
		);
		const kb = await json(create);

		// `.strict()` schema rejects unknown keys; embeddingServiceId is
		// not in the update schema's allow list.
		const bad = await app.request(
			`/api/v1/workspaces/${ws}/knowledge-bases/${kb.knowledgeBaseId}`,
			{
				method: "PUT",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					embeddingServiceId: "00000000-0000-0000-0000-000000000099",
				}),
			},
		);
		expect(bad.status).toBe(400);
	});

	test("DELETE on a service referenced by a KB returns 409", async () => {
		const app = makeApp();
		const ws = await createWorkspace(app);
		const embId = await createService(app, ws, "embedding-services", {
			name: "e",
			provider: "openai",
			modelName: "m",
			embeddingDimension: 4,
		});
		const chunkId = await createService(app, ws, "chunking-services", {
			name: "c",
			engine: "docling",
		});
		await app.request(`/api/v1/workspaces/${ws}/knowledge-bases`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				name: "kb",
				embeddingServiceId: embId,
				chunkingServiceId: chunkId,
			}),
		});

		const conflict = await app.request(
			`/api/v1/workspaces/${ws}/embedding-services/${embId}`,
			{ method: "DELETE" },
		);
		expect(conflict.status).toBe(409);
	});

	test("data plane: upsert + search round-trip on a KB-backed mock collection", async () => {
		const app = makeApp();
		const ws = await createWorkspace(app);
		const embId = await createService(app, ws, "embedding-services", {
			name: "mock-embedder",
			provider: "mock",
			modelName: "mock-embedder",
			embeddingDimension: 4,
		});
		const chunkId = await createService(app, ws, "chunking-services", {
			name: "c",
			engine: "docling",
		});
		const create = await app.request(
			`/api/v1/workspaces/${ws}/knowledge-bases`,
			{
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					name: "kb",
					embeddingServiceId: embId,
					chunkingServiceId: chunkId,
				}),
			},
		);
		const kb = await json(create);

		// Upsert two records.
		const upsert = await app.request(
			`/api/v1/workspaces/${ws}/knowledge-bases/${kb.knowledgeBaseId}/records`,
			{
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					records: [
						{ id: "a", text: "alpha bravo charlie", payload: { tag: "x" } },
						{ id: "b", text: "delta echo foxtrot", payload: { tag: "y" } },
					],
				}),
			},
		);
		expect(upsert.status, await upsert.clone().text()).toBe(200);
		const upsertBody = await json(upsert);
		expect(upsertBody.upserted).toBe(2);

		// Vector search on the KB.
		const search = await app.request(
			`/api/v1/workspaces/${ws}/knowledge-bases/${kb.knowledgeBaseId}/search`,
			{
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ text: "alpha bravo charlie", topK: 1 }),
			},
		);
		expect(search.status, await search.clone().text()).toBe(200);
		const hits = await json(search);
		expect(Array.isArray(hits)).toBe(true);
		expect(hits[0]?.id).toBe("a");

		// Delete a record.
		const del = await app.request(
			`/api/v1/workspaces/${ws}/knowledge-bases/${kb.knowledgeBaseId}/records/a`,
			{ method: "DELETE" },
		);
		expect(del.status).toBe(200);
		expect((await json(del)).deleted).toBe(true);
	});

	test("data plane: 404 for unknown KB", async () => {
		const app = makeApp();
		const ws = await createWorkspace(app);
		const res = await app.request(
			`/api/v1/workspaces/${ws}/knowledge-bases/${randomUUID()}/search`,
			{
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ vector: [1, 0, 0, 0] }),
			},
		);
		expect(res.status).toBe(404);
	});

	test("KB list paginates", async () => {
		const app = makeApp();
		const ws = await createWorkspace(app);
		const embId = await createService(app, ws, "embedding-services", {
			name: "e",
			provider: "openai",
			modelName: "m",
			embeddingDimension: 4,
		});
		const chunkId = await createService(app, ws, "chunking-services", {
			name: "c",
			engine: "docling",
		});
		for (let i = 0; i < 3; i++) {
			await app.request(`/api/v1/workspaces/${ws}/knowledge-bases`, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					name: `kb-${i}`,
					embeddingServiceId: embId,
					chunkingServiceId: chunkId,
				}),
			});
		}
		const list = await app.request(
			`/api/v1/workspaces/${ws}/knowledge-bases?limit=2`,
		);
		expect(list.status).toBe(200);
		const body = await json(list);
		expect(body.items).toHaveLength(2);
		expect(body.nextCursor).not.toBeNull();
	});

	test("knowledge filters CRUD round-trip under a KB", async () => {
		const app = makeApp();
		const { ws, kbId } = await makeReadyKb(app);

		const create = await app.request(
			`/api/v1/workspaces/${ws}/knowledge-bases/${kbId}/filters`,
			{
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					name: "Published docs",
					description: "Only ready-to-serve chunks",
					filter: { status: "published", locale: "en" },
				}),
			},
		);
		expect(create.status, await create.clone().text()).toBe(201);
		const saved = await json(create);
		expect(saved.knowledgeBaseId).toBe(kbId);
		expect(saved.filter).toEqual({ status: "published", locale: "en" });

		const list = await app.request(
			`/api/v1/workspaces/${ws}/knowledge-bases/${kbId}/filters`,
		);
		expect(list.status).toBe(200);
		expect((await json(list)).items).toHaveLength(1);

		const update = await app.request(
			`/api/v1/workspaces/${ws}/knowledge-bases/${kbId}/filters/${saved.knowledgeFilterId}`,
			{
				method: "PUT",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ filter: { status: "archived" } }),
			},
		);
		expect(update.status).toBe(200);
		expect((await json(update)).filter).toEqual({ status: "archived" });

		const del = await app.request(
			`/api/v1/workspaces/${ws}/knowledge-bases/${kbId}/filters/${saved.knowledgeFilterId}`,
			{ method: "DELETE" },
		);
		expect(del.status).toBe(204);
	});
});

/* ---------------- KB document / ingest routes ---------------- */

async function makeReadyKb(app: ReturnType<typeof makeApp>): Promise<{
	ws: string;
	kbId: string;
}> {
	const ws = await createWorkspace(app);
	const embId = await createService(app, ws, "embedding-services", {
		name: "mock-embedder",
		provider: "mock",
		modelName: "mock-embedder",
		embeddingDimension: 4,
	});
	const chunkId = await createService(app, ws, "chunking-services", {
		name: "c",
		engine: "docling",
	});
	const create = await app.request(`/api/v1/workspaces/${ws}/knowledge-bases`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({
			name: "kb",
			embeddingServiceId: embId,
			chunkingServiceId: chunkId,
		}),
	});
	expect(create.status).toBe(201);
	const kb = await json(create);
	return { ws, kbId: kb.knowledgeBaseId };
}

describe("KB document routes", () => {
	test("CRUD round-trip on /knowledge-bases/{kb}/documents", async () => {
		const app = makeApp();
		const { ws, kbId } = await makeReadyKb(app);

		const create = await app.request(
			`/api/v1/workspaces/${ws}/knowledge-bases/${kbId}/documents`,
			{
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					sourceFilename: "alpha.txt",
					metadata: { tag: "t" },
				}),
			},
		);
		expect(create.status, await create.clone().text()).toBe(201);
		const doc = await json(create);
		expect(doc.workspaceId).toBe(ws);
		expect(doc.knowledgeBaseId).toBe(kbId);
		expect(doc.documentId).toMatch(/^[0-9a-f-]{36}$/);

		const list = await app.request(
			`/api/v1/workspaces/${ws}/knowledge-bases/${kbId}/documents`,
		);
		expect(list.status).toBe(200);
		const page = await json(list);
		expect(page.items).toHaveLength(1);

		const upd = await app.request(
			`/api/v1/workspaces/${ws}/knowledge-bases/${kbId}/documents/${doc.documentId}`,
			{
				method: "PUT",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ status: "ready" }),
			},
		);
		expect(upd.status).toBe(200);
		expect((await json(upd)).status).toBe("ready");

		const del = await app.request(
			`/api/v1/workspaces/${ws}/knowledge-bases/${kbId}/documents/${doc.documentId}`,
			{ method: "DELETE" },
		);
		expect(del.status).toBe(204);

		const after = await app.request(
			`/api/v1/workspaces/${ws}/knowledge-bases/${kbId}/documents/${doc.documentId}`,
		);
		expect(after.status).toBe(404);
	});

	test("404 when KB does not exist", async () => {
		const app = makeApp();
		const ws = await createWorkspace(app);
		const res = await app.request(
			`/api/v1/workspaces/${ws}/knowledge-bases/${randomUUID()}/documents`,
		);
		expect(res.status).toBe(404);
	});

	test("POST /ingest (sync) chunks, upserts, and stamps the document ready", async () => {
		const app = makeApp();
		const { ws, kbId } = await makeReadyKb(app);

		const res = await app.request(
			`/api/v1/workspaces/${ws}/knowledge-bases/${kbId}/ingest`,
			{
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					text: "alpha bravo charlie delta echo foxtrot golf hotel",
				}),
			},
		);
		expect(res.status, await res.clone().text()).toBe(201);
		const body = await json(res);
		expect(body.document.status).toBe("ready");
		expect(body.chunks).toBeGreaterThan(0);

		// Search hits the freshly-upserted chunks.
		const search = await app.request(
			`/api/v1/workspaces/${ws}/knowledge-bases/${kbId}/search`,
			{
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ text: "alpha bravo", topK: 1 }),
			},
		);
		expect(search.status).toBe(200);
		const hits = await json(search);
		expect(hits.length).toBeGreaterThan(0);
	});

	test("POST /ingest?async=true returns 202 with a pending job tagged with the KB", async () => {
		const app = makeApp();
		const { ws, kbId } = await makeReadyKb(app);

		const res = await app.request(
			`/api/v1/workspaces/${ws}/knowledge-bases/${kbId}/ingest?async=true`,
			{
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ text: "hello world" }),
			},
		);
		expect(res.status, await res.clone().text()).toBe(202);
		const body = await json(res);
		expect(body.job.status).toBe("pending");
		expect(body.job.knowledgeBaseUid).toBe(kbId);
		expect(body.document.knowledgeBaseId).toBe(kbId);
	});

	test("DELETE on document with no record cascades cleanly", async () => {
		const app = makeApp();
		const { ws, kbId } = await makeReadyKb(app);
		const create = await app.request(
			`/api/v1/workspaces/${ws}/knowledge-bases/${kbId}/documents`,
			{
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({}),
			},
		);
		const doc = await json(create);
		const del = await app.request(
			`/api/v1/workspaces/${ws}/knowledge-bases/${kbId}/documents/${doc.documentId}`,
			{ method: "DELETE" },
		);
		expect(del.status).toBe(204);
	});
});
