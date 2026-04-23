import { describe, expect, test } from "vitest";
import { createApp } from "../src/app.js";
import { MemoryControlPlaneStore } from "../src/control-plane/memory/store.js";
import type { ControlPlaneStore } from "../src/control-plane/store.js";
import { MockVectorStoreDriver } from "../src/drivers/mock/store.js";
import { VectorStoreDriverRegistry } from "../src/drivers/registry.js";
import { EnvSecretProvider } from "../src/secrets/env.js";
import { SecretResolver } from "../src/secrets/provider.js";

// Tests fetch JSON and assert on properties; cast to `any` for ergonomic access.
// biome-ignore lint/suspicious/noExplicitAny: test helper returns untyped JSON
async function json(res: Response): Promise<any> {
	// biome-ignore lint/suspicious/noExplicitAny: test helper returns untyped JSON
	return (await res.json()) as any;
}

function makeApp(): {
	app: ReturnType<typeof createApp>;
	store: ControlPlaneStore;
} {
	const store = new MemoryControlPlaneStore();
	const drivers = new VectorStoreDriverRegistry(
		new Map([["mock", new MockVectorStoreDriver()]]),
	);
	const secrets = new SecretResolver({ env: new EnvSecretProvider() });
	const app = createApp({ store, drivers, secrets });
	return { app, store };
}

const BASE_WORKSPACE = { name: "w1", kind: "astra" as const };
/** For tests that exercise the data plane (need a registered driver). */
const MOCK_WORKSPACE = { name: "w1-mock", kind: "mock" as const };

const BASE_VECTOR_STORE = {
	name: "vs",
	vectorDimension: 1536,
	embedding: {
		provider: "openai",
		model: "text-embedding-3-small",
		endpoint: null,
		dimension: 1536,
		secretRef: "env:OPENAI_API_KEY",
	},
};

describe("operational routes", () => {
	test("GET / returns service banner", async () => {
		const { app } = makeApp();
		const res = await app.request("/");
		expect(res.status).toBe(200);
		const body = await json(res);
		expect(body).toMatchObject({ name: "ai-workbench", docs: "/docs" });
	});

	test("GET /healthz returns ok", async () => {
		const { app } = makeApp();
		const res = await app.request("/healthz");
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ status: "ok" });
	});

	test("GET /readyz returns ready with a workspace count", async () => {
		const { app, store } = makeApp();
		await store.createWorkspace(BASE_WORKSPACE);
		await store.createWorkspace({ name: "w2", kind: "mock" });
		const res = await app.request("/readyz");
		expect(res.status).toBe(200);
		const body = await json(res);
		expect(body).toEqual({ status: "ready", workspaces: 2 });
	});

	test("GET /version returns build metadata", async () => {
		const { app } = makeApp();
		const res = await app.request("/version");
		expect(res.status).toBe(200);
		const body = await json(res);
		expect(body.node).toBe(process.version);
	});

	test("responses carry X-Request-Id", async () => {
		const { app } = makeApp();
		const res = await app.request("/healthz");
		expect(res.headers.get("X-Request-Id")).toBeTruthy();
	});

	test("echoes client-provided request id", async () => {
		const { app } = makeApp();
		const res = await app.request("/healthz", {
			headers: { "X-Request-Id": "abc-123" },
		});
		expect(res.headers.get("X-Request-Id")).toBe("abc-123");
	});
});

describe("workspace routes", () => {
	test("POST creates a workspace and returns 201 with uid", async () => {
		const { app } = makeApp();
		const res = await app.request("/api/v1/workspaces", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(BASE_WORKSPACE),
		});
		expect(res.status).toBe(201);
		const body = await json(res);
		expect(body.name).toBe("w1");
		expect(body.kind).toBe("astra");
		expect(body.uid).toMatch(/^[0-9a-f-]{36}$/);
	});

	test("GET returns all workspaces", async () => {
		const { app, store } = makeApp();
		await store.createWorkspace(BASE_WORKSPACE);
		await store.createWorkspace({ name: "w2", kind: "mock" });
		const res = await app.request("/api/v1/workspaces");
		const body = await json(res);
		expect(body).toHaveLength(2);
	});

	test("GET /:id returns the record", async () => {
		const { app, store } = makeApp();
		const created = await store.createWorkspace(BASE_WORKSPACE);
		const res = await app.request(`/api/v1/workspaces/${created.uid}`);
		expect(res.status).toBe(200);
		const body = await json(res);
		expect(body.uid).toBe(created.uid);
	});

	test("GET /:id returns 404 for unknown uid", async () => {
		const { app } = makeApp();
		const res = await app.request(
			"/api/v1/workspaces/00000000-0000-0000-0000-000000000000",
		);
		expect(res.status).toBe(404);
		const body = await json(res);
		expect(body.error.code).toBe("workspace_not_found");
		expect(body.error.requestId).toBeTruthy();
	});

	test("PUT applies the patch", async () => {
		const { app, store } = makeApp();
		const created = await store.createWorkspace(BASE_WORKSPACE);
		const res = await app.request(`/api/v1/workspaces/${created.uid}`, {
			method: "PUT",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ name: "renamed" }),
		});
		expect(res.status).toBe(200);
		const body = await json(res);
		expect(body.name).toBe("renamed");
		expect(body.kind).toBe("astra");
	});

	test("PUT returns 404 for unknown uid", async () => {
		const { app } = makeApp();
		const res = await app.request(
			"/api/v1/workspaces/00000000-0000-0000-0000-000000000000",
			{
				method: "PUT",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ name: "x" }),
			},
		);
		expect(res.status).toBe(404);
	});

	test("DELETE returns 204", async () => {
		const { app, store } = makeApp();
		const created = await store.createWorkspace(BASE_WORKSPACE);
		const res = await app.request(`/api/v1/workspaces/${created.uid}`, {
			method: "DELETE",
		});
		expect(res.status).toBe(204);
		expect(await store.getWorkspace(created.uid)).toBeNull();
	});

	test("DELETE returns 404 for unknown uid", async () => {
		const { app } = makeApp();
		const res = await app.request(
			"/api/v1/workspaces/00000000-0000-0000-0000-000000000000",
			{ method: "DELETE" },
		);
		expect(res.status).toBe(404);
	});

	test("POST with invalid body returns 400 in the canonical envelope", async () => {
		const { app } = makeApp();
		const res = await app.request("/api/v1/workspaces", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ kind: "astra" }), // missing name
		});
		expect(res.status).toBe(400);
		const body = await json(res);
		expect(body.error.code).toBe("validation_error");
		expect(body.error.message).toContain("name");
		expect(body.error.requestId).toBeTruthy();
	});

	test("POST rejects credentialsRef values that aren't SecretRefs", async () => {
		const { app } = makeApp();
		const res = await app.request("/api/v1/workspaces", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				name: "prod",
				kind: "astra",
				credentialsRef: { token: "raw-token-here" }, // no `<provider>:<path>`
			}),
		});
		expect(res.status).toBe(400);
		const body = await json(res);
		expect(body.error.code).toBe("validation_error");
		expect(body.error.message).toMatch(/credentialsRef\.token/);
	});

	test("PUT accepts SecretRef-shaped credentialsRef values", async () => {
		const { app, store } = makeApp();
		const ws = await store.createWorkspace(BASE_WORKSPACE);
		const res = await app.request(`/api/v1/workspaces/${ws.uid}`, {
			method: "PUT",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				credentialsRef: { token: "env:NEW_TOKEN" },
			}),
		});
		expect(res.status).toBe(200);
		const body = await json(res);
		expect(body.credentialsRef).toEqual({ token: "env:NEW_TOKEN" });
	});

	test("PUT rejects `kind` in the body with validation_error envelope", async () => {
		const { app, store } = makeApp();
		const ws = await store.createWorkspace(BASE_WORKSPACE);
		const res = await app.request(`/api/v1/workspaces/${ws.uid}`, {
			method: "PUT",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ kind: "mock" }),
		});
		expect(res.status).toBe(400);
		const body = await json(res);
		expect(body.error.code).toBe("validation_error");
		expect(body.error.requestId).toBeTruthy();
		// Workspace unchanged.
		const after = await store.getWorkspace(ws.uid);
		expect(after?.kind).toBe("astra");
	});

	test("list returns workspaces in createdAt order", async () => {
		const { app, store } = makeApp();
		const a = await store.createWorkspace({ name: "a", kind: "astra" });
		await new Promise((r) => setTimeout(r, 5));
		const b = await store.createWorkspace({ name: "b", kind: "astra" });
		await new Promise((r) => setTimeout(r, 5));
		const c = await store.createWorkspace({ name: "c", kind: "astra" });
		const res = await app.request("/api/v1/workspaces");
		const body = await json(res);
		expect(body.map((w: { uid: string }) => w.uid)).toEqual([
			a.uid,
			b.uid,
			c.uid,
		]);
	});
});

describe("workspace test-connection", () => {
	test("mock workspace reports ok unconditionally", async () => {
		const { app, store } = makeApp();
		const ws = await store.createWorkspace({ name: "m", kind: "mock" });
		const res = await app.request(
			`/api/v1/workspaces/${ws.uid}/test-connection`,
			{ method: "POST" },
		);
		expect(res.status).toBe(200);
		const body = await json(res);
		expect(body).toMatchObject({ ok: true, kind: "mock" });
		expect(body.details).toMatch(/mock backend/i);
	});

	test("astra workspace with no credentials returns ok with a hint", async () => {
		const { app, store } = makeApp();
		const ws = await store.createWorkspace({ name: "a", kind: "astra" });
		const res = await app.request(
			`/api/v1/workspaces/${ws.uid}/test-connection`,
			{ method: "POST" },
		);
		expect(res.status).toBe(200);
		const body = await json(res);
		expect(body.ok).toBe(true);
		expect(body.details).toMatch(/no credentials/i);
	});

	test("astra workspace reports ok when every credential ref resolves", async () => {
		const prev = process.env.__TEST_ASTRA_TOKEN;
		process.env.__TEST_ASTRA_TOKEN = "present";
		try {
			const { app, store } = makeApp();
			const ws = await store.createWorkspace({
				name: "a",
				kind: "astra",
				credentialsRef: { token: "env:__TEST_ASTRA_TOKEN" },
			});
			const res = await app.request(
				`/api/v1/workspaces/${ws.uid}/test-connection`,
				{ method: "POST" },
			);
			expect(res.status).toBe(200);
			const body = await json(res);
			expect(body.ok).toBe(true);
			expect(body.details).toMatch(/resolved/i);
		} finally {
			if (prev === undefined) delete process.env.__TEST_ASTRA_TOKEN;
			else process.env.__TEST_ASTRA_TOKEN = prev;
		}
	});

	test("reports ok: false when a credential ref can't be resolved", async () => {
		const { app, store } = makeApp();
		const ws = await store.createWorkspace({
			name: "a",
			kind: "astra",
			credentialsRef: { token: "env:__NEVER_SET_ENV_VAR_XYZZY" },
		});
		const res = await app.request(
			`/api/v1/workspaces/${ws.uid}/test-connection`,
			{ method: "POST" },
		);
		expect(res.status).toBe(200);
		const body = await json(res);
		expect(body).toMatchObject({ ok: false, kind: "astra" });
		expect(body.details).toMatch(/token/);
		expect(body.details).toMatch(/__NEVER_SET_ENV_VAR_XYZZY/);
	});

	test("404 for unknown workspace", async () => {
		const { app } = makeApp();
		const res = await app.request(
			"/api/v1/workspaces/00000000-0000-0000-0000-000000000000/test-connection",
			{ method: "POST" },
		);
		expect(res.status).toBe(404);
		const body = await json(res);
		expect(body.error.code).toBe("workspace_not_found");
	});
});

describe("catalog routes", () => {
	test("POST creates a catalog under a workspace", async () => {
		const { app, store } = makeApp();
		const ws = await store.createWorkspace(BASE_WORKSPACE);
		const res = await app.request(`/api/v1/workspaces/${ws.uid}/catalogs`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ name: "support" }),
		});
		expect(res.status).toBe(201);
		const body = await json(res);
		expect(body.name).toBe("support");
		expect(body.workspace).toBe(ws.uid);
	});

	test("POST on unknown workspace returns 404", async () => {
		const { app } = makeApp();
		const res = await app.request(
			"/api/v1/workspaces/00000000-0000-0000-0000-000000000000/catalogs",
			{
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ name: "x" }),
			},
		);
		expect(res.status).toBe(404);
		const body = await json(res);
		expect(body.error.code).toBe("workspace_not_found");
	});

	test("GET lists catalogs for the workspace", async () => {
		const { app, store } = makeApp();
		const ws = await store.createWorkspace(BASE_WORKSPACE);
		await store.createCatalog(ws.uid, { name: "c1" });
		await store.createCatalog(ws.uid, { name: "c2" });
		const res = await app.request(`/api/v1/workspaces/${ws.uid}/catalogs`);
		const body = await json(res);
		expect(body).toHaveLength(2);
	});
});

describe("document routes", () => {
	async function seed() {
		const { app, store } = makeApp();
		const ws = await store.createWorkspace(BASE_WORKSPACE);
		const cat = await store.createCatalog(ws.uid, { name: "c1" });
		return { app, store, ws, cat };
	}

	test("POST creates a document with defaults", async () => {
		const { app, ws, cat } = await seed();
		const res = await app.request(
			`/api/v1/workspaces/${ws.uid}/catalogs/${cat.uid}/documents`,
			{
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ sourceFilename: "readme.md" }),
			},
		);
		expect(res.status).toBe(201);
		const body = await json(res);
		expect(body.workspace).toBe(ws.uid);
		expect(body.catalogUid).toBe(cat.uid);
		expect(body.sourceFilename).toBe("readme.md");
		expect(body.status).toBe("pending");
		expect(body.metadata).toEqual({});
	});

	test("POST on unknown workspace returns 404 workspace_not_found", async () => {
		const { app } = makeApp();
		const res = await app.request(
			"/api/v1/workspaces/00000000-0000-0000-0000-000000000000/catalogs/00000000-0000-0000-0000-000000000000/documents",
			{
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({}),
			},
		);
		expect(res.status).toBe(404);
		const body = await json(res);
		expect(body.error.code).toBe("workspace_not_found");
	});

	test("POST on unknown catalog returns 404 catalog_not_found", async () => {
		const { app, store } = makeApp();
		const ws = await store.createWorkspace(BASE_WORKSPACE);
		const res = await app.request(
			`/api/v1/workspaces/${ws.uid}/catalogs/00000000-0000-0000-0000-000000000000/documents`,
			{
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({}),
			},
		);
		expect(res.status).toBe(404);
		const body = await json(res);
		expect(body.error.code).toBe("catalog_not_found");
	});

	test("GET lists documents for the catalog", async () => {
		const { app, store, ws, cat } = await seed();
		await store.createDocument(ws.uid, cat.uid, { sourceFilename: "a" });
		await store.createDocument(ws.uid, cat.uid, { sourceFilename: "b" });
		const res = await app.request(
			`/api/v1/workspaces/${ws.uid}/catalogs/${cat.uid}/documents`,
		);
		expect(res.status).toBe(200);
		const body = await json(res);
		expect(body).toHaveLength(2);
	});

	test("GET on missing document returns 404 document_not_found", async () => {
		const { app, ws, cat } = await seed();
		const res = await app.request(
			`/api/v1/workspaces/${ws.uid}/catalogs/${cat.uid}/documents/00000000-0000-0000-0000-000000000000`,
		);
		expect(res.status).toBe(404);
		const body = await json(res);
		expect(body.error.code).toBe("document_not_found");
	});

	test("PUT updates metadata fields", async () => {
		const { app, store, ws, cat } = await seed();
		const doc = await store.createDocument(ws.uid, cat.uid, {
			sourceFilename: "old",
		});
		const res = await app.request(
			`/api/v1/workspaces/${ws.uid}/catalogs/${cat.uid}/documents/${doc.documentUid}`,
			{
				method: "PUT",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					status: "ready",
					chunkTotal: 7,
					metadata: { source: "upload" },
				}),
			},
		);
		expect(res.status).toBe(200);
		const body = await json(res);
		expect(body.status).toBe("ready");
		expect(body.chunkTotal).toBe(7);
		expect(body.metadata).toEqual({ source: "upload" });
		expect(body.sourceFilename).toBe("old"); // untouched
	});

	test("DELETE removes the document", async () => {
		const { app, store, ws, cat } = await seed();
		const doc = await store.createDocument(ws.uid, cat.uid, {});
		const res = await app.request(
			`/api/v1/workspaces/${ws.uid}/catalogs/${cat.uid}/documents/${doc.documentUid}`,
			{ method: "DELETE" },
		);
		expect(res.status).toBe(204);
		expect(
			await store.getDocument(ws.uid, cat.uid, doc.documentUid),
		).toBeNull();
	});

	test("POST with duplicate uid returns 409 conflict", async () => {
		const { app, store, ws, cat } = await seed();
		const existing = await store.createDocument(ws.uid, cat.uid, {});
		const res = await app.request(
			`/api/v1/workspaces/${ws.uid}/catalogs/${cat.uid}/documents`,
			{
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ uid: existing.documentUid }),
			},
		);
		expect(res.status).toBe(409);
		const body = await json(res);
		expect(body.error.code).toBe("conflict");
	});

	test("documents are scoped to their catalog", async () => {
		const { app, store, ws } = await seed();
		const catA = await store.createCatalog(ws.uid, { name: "a" });
		const catB = await store.createCatalog(ws.uid, { name: "b" });
		const doc = await store.createDocument(ws.uid, catA.uid, {});
		const res = await app.request(
			`/api/v1/workspaces/${ws.uid}/catalogs/${catB.uid}/documents/${doc.documentUid}`,
		);
		expect(res.status).toBe(404);
		const body = await json(res);
		expect(body.error.code).toBe("document_not_found");
	});
});

describe("vector-store routes", () => {
	test("POST creates a descriptor row and provisions a collection", async () => {
		const { app, store } = makeApp();
		const ws = await store.createWorkspace(MOCK_WORKSPACE);
		const res = await app.request(
			`/api/v1/workspaces/${ws.uid}/vector-stores`,
			{
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify(BASE_VECTOR_STORE),
			},
		);
		expect(res.status).toBe(201);
		const body = await json(res);
		expect(body.vectorDimension).toBe(1536);
		expect(body.lexical.enabled).toBe(false);
		expect(body.reranking.enabled).toBe(false);
	});

	test("POST on a workspace whose kind has no registered driver → 503", async () => {
		const { app, store } = makeApp();
		// makeApp() only registers the `mock` driver; a kind-astra
		// workspace therefore has no driver wired up in this test.
		const ws = await store.createWorkspace(BASE_WORKSPACE); // kind: astra
		const res = await app.request(
			`/api/v1/workspaces/${ws.uid}/vector-stores`,
			{
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify(BASE_VECTOR_STORE),
			},
		);
		expect(res.status).toBe(503);
		const body = await json(res);
		expect(body.error.code).toBe("driver_unavailable");
	});
});

describe("vector-store data plane", () => {
	const vector = (seed: number, dim = 1536): number[] =>
		Array.from({ length: dim }, (_, i) => Math.sin(seed + i));

	async function setupStore() {
		const { app, store } = makeApp();
		const ws = await store.createWorkspace(MOCK_WORKSPACE);
		const create = await app.request(
			`/api/v1/workspaces/${ws.uid}/vector-stores`,
			{
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify(BASE_VECTOR_STORE),
			},
		);
		const vs = await json(create);
		return { app, store, ws, vs };
	}

	test("upsert + search returns nearest first", async () => {
		const { app, ws, vs } = await setupStore();
		const upsertRes = await app.request(
			`/api/v1/workspaces/${ws.uid}/vector-stores/${vs.uid}/records`,
			{
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					records: [
						{ id: "a", vector: vector(0), payload: { tag: "a" } },
						{ id: "b", vector: vector(5) },
						{ id: "c", vector: vector(10), payload: { tag: "c" } },
					],
				}),
			},
		);
		expect(upsertRes.status).toBe(200);
		expect((await json(upsertRes)).upserted).toBe(3);

		const searchRes = await app.request(
			`/api/v1/workspaces/${ws.uid}/vector-stores/${vs.uid}/search`,
			{
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ vector: vector(0), topK: 2 }),
			},
		);
		expect(searchRes.status).toBe(200);
		const hits = await json(searchRes);
		expect(hits).toHaveLength(2);
		expect(hits[0].id).toBe("a"); // exact match
		expect(hits[0].score).toBeGreaterThan(hits[1].score);
	});

	test("search with payload filter narrows results", async () => {
		const { app, ws, vs } = await setupStore();
		await app.request(
			`/api/v1/workspaces/${ws.uid}/vector-stores/${vs.uid}/records`,
			{
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					records: [
						{ id: "a", vector: vector(0), payload: { tag: "keep" } },
						{ id: "b", vector: vector(0), payload: { tag: "drop" } },
					],
				}),
			},
		);
		const res = await app.request(
			`/api/v1/workspaces/${ws.uid}/vector-stores/${vs.uid}/search`,
			{
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					vector: vector(0),
					topK: 10,
					filter: { tag: "keep" },
				}),
			},
		);
		const hits = await json(res);
		expect(hits).toHaveLength(1);
		expect(hits[0].id).toBe("a");
	});

	test("delete record returns { deleted: true } then false", async () => {
		const { app, ws, vs } = await setupStore();
		await app.request(
			`/api/v1/workspaces/${ws.uid}/vector-stores/${vs.uid}/records`,
			{
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					records: [{ id: "a", vector: vector(0) }],
				}),
			},
		);
		const first = await app.request(
			`/api/v1/workspaces/${ws.uid}/vector-stores/${vs.uid}/records/a`,
			{ method: "DELETE" },
		);
		expect(first.status).toBe(200);
		expect((await json(first)).deleted).toBe(true);

		const second = await app.request(
			`/api/v1/workspaces/${ws.uid}/vector-stores/${vs.uid}/records/a`,
			{ method: "DELETE" },
		);
		expect((await json(second)).deleted).toBe(false);
	});

	test("upsert with wrong dimension → 400 dimension_mismatch", async () => {
		const { app, ws, vs } = await setupStore();
		const res = await app.request(
			`/api/v1/workspaces/${ws.uid}/vector-stores/${vs.uid}/records`,
			{
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					records: [{ id: "a", vector: [0.1, 0.2, 0.3] }],
				}),
			},
		);
		expect(res.status).toBe(400);
		const body = await json(res);
		expect(body.error.code).toBe("dimension_mismatch");
	});

	test("search on missing vector store → 404", async () => {
		const { app, ws } = await setupStore();
		const res = await app.request(
			`/api/v1/workspaces/${ws.uid}/vector-stores/00000000-0000-0000-0000-000000000000/search`,
			{
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ vector: vector(0) }),
			},
		);
		expect(res.status).toBe(404);
		expect((await json(res)).error.code).toBe("vector_store_not_found");
	});

	test("DELETE vector store drops the collection", async () => {
		const { app, ws, vs } = await setupStore();
		await app.request(
			`/api/v1/workspaces/${ws.uid}/vector-stores/${vs.uid}/records`,
			{
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					records: [{ id: "a", vector: vector(0) }],
				}),
			},
		);
		const del = await app.request(
			`/api/v1/workspaces/${ws.uid}/vector-stores/${vs.uid}`,
			{ method: "DELETE" },
		);
		expect(del.status).toBe(204);

		// Subsequent record ops should fail because the descriptor is
		// gone — surfaces as vector_store_not_found before the driver
		// is even called.
		const searchRes = await app.request(
			`/api/v1/workspaces/${ws.uid}/vector-stores/${vs.uid}/search`,
			{
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ vector: vector(0) }),
			},
		);
		expect(searchRes.status).toBe(404);
	});
});

describe("error handling", () => {
	test("unknown routes return 404 envelope", async () => {
		const { app } = makeApp();
		const res = await app.request("/no-such-path");
		expect(res.status).toBe(404);
		const body = await json(res);
		expect(body.error.code).toBe("not_found");
	});
});

describe("openapi", () => {
	test("GET /api/v1/openapi.json returns a 3.1 document", async () => {
		const { app } = makeApp();
		const res = await app.request("/api/v1/openapi.json");
		expect(res.status).toBe(200);
		const body = await json(res);
		expect(body.openapi).toBe("3.1.0");
		expect(body.info.title).toBe("AI Workbench");
	});

	test("openapi doc lists the CRUD paths", async () => {
		const { app } = makeApp();
		const res = await app.request("/api/v1/openapi.json");
		const body = await json(res);
		const paths = Object.keys(body.paths);
		expect(paths).toContain("/api/v1/workspaces");
		expect(paths).toContain("/api/v1/workspaces/{workspaceId}");
		expect(paths).toContain("/api/v1/workspaces/{workspaceId}/catalogs");
		expect(paths).toContain("/api/v1/workspaces/{workspaceId}/vector-stores");
		expect(paths).toContain(
			"/api/v1/workspaces/{workspaceId}/catalogs/{catalogId}/documents",
		);
		expect(paths).toContain(
			"/api/v1/workspaces/{workspaceId}/catalogs/{catalogId}/documents/{documentId}",
		);
	});

	test("openapi doc includes shared error envelope schema", async () => {
		const { app } = makeApp();
		const res = await app.request("/api/v1/openapi.json");
		const body = await json(res);
		expect(body.components.schemas.ErrorEnvelope).toBeDefined();
		expect(body.components.schemas.Workspace).toBeDefined();
		expect(body.components.schemas.Catalog).toBeDefined();
		expect(body.components.schemas.VectorStore).toBeDefined();
		expect(body.components.schemas.Document).toBeDefined();
		expect(body.components.schemas.DocumentStatus).toBeDefined();
	});

	test("GET /docs serves the Scalar reference UI", async () => {
		const { app } = makeApp();
		const res = await app.request("/docs");
		expect(res.status).toBe(200);
		const text = await res.text();
		expect(text).toContain("/api/v1/openapi.json");
	});
});
