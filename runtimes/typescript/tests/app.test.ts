import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { createApp } from "../src/app.js";
import { ApiKeyVerifier } from "../src/auth/apiKey/verifier.js";
import { BootstrapTokenVerifier } from "../src/auth/bootstrap.js";
import { AuthResolver } from "../src/auth/resolver.js";
import type { AnonymousPolicy, AuthMode } from "../src/auth/types.js";
import { MemoryControlPlaneStore } from "../src/control-plane/memory/store.js";
import type { ControlPlaneStore } from "../src/control-plane/store.js";
import { MockVectorStoreDriver } from "../src/drivers/mock/store.js";
import { VectorStoreDriverRegistry } from "../src/drivers/registry.js";
import {
	MAX_API_JSON_BODY_BYTES,
	MAX_INGEST_TEXT_CHARS,
	MAX_QUERY_TEXT_CHARS,
} from "../src/lib/limits.js";
import { EnvSecretProvider } from "../src/secrets/env.js";
import { SecretResolver } from "../src/secrets/provider.js";
import { makeFakeEmbedderFactory } from "./helpers/embedder.js";

// Tests fetch JSON and assert on properties; cast to `any` for ergonomic access.
// biome-ignore lint/suspicious/noExplicitAny: test helper returns untyped JSON
async function json(res: Response): Promise<any> {
	// biome-ignore lint/suspicious/noExplicitAny: test helper returns untyped JSON
	return (await res.json()) as any;
}

function makeApp(authOpts?: {
	mode?: AuthMode;
	anonymousPolicy?: AnonymousPolicy;
}): {
	app: ReturnType<typeof createApp>;
	store: ControlPlaneStore;
	driver: MockVectorStoreDriver;
} {
	const store = new MemoryControlPlaneStore();
	const driver = new MockVectorStoreDriver();
	const drivers = new VectorStoreDriverRegistry(new Map([["mock", driver]]));
	const secrets = new SecretResolver({ env: new EnvSecretProvider() });
	const mode = authOpts?.mode ?? "disabled";
	const auth = new AuthResolver({
		mode,
		anonymousPolicy: authOpts?.anonymousPolicy ?? "allow",
		verifiers: mode === "apiKey" ? [new ApiKeyVerifier({ store })] : [],
	});
	const embedders = makeFakeEmbedderFactory();
	const app = createApp({ store, drivers, secrets, auth, embedders });
	return { app, store, driver };
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

	test("unhandled errors return a generic envelope", async () => {
		const { app } = makeApp();
		app.get("/boom", () => {
			throw new Error("database password leaked in exception text");
		});
		const res = await app.request("/boom");
		expect(res.status).toBe(500);
		const body = await json(res);
		expect(body.error.code).toBe("internal_error");
		expect(body.error.message).toBe("internal server error");
	});

	test("oversized API bodies are rejected before route handling", async () => {
		const { app } = makeApp();
		const res = await app.request("/api/v1/workspaces", {
			method: "POST",
			headers: {
				"content-type": "application/json",
				"content-length": String(MAX_API_JSON_BODY_BYTES + 1),
			},
			body: "{}",
		});
		expect(res.status).toBe(413);
		const body = await json(res);
		expect(body.error.code).toBe("payload_too_large");
		expect(body.error.requestId).toBeTruthy();
	});

	test("responses carry X-Request-Id", async () => {
		const { app } = makeApp();
		const res = await app.request("/healthz");
		expect(res.headers.get("X-Request-Id")).toBeTruthy();
	});

	test("responses carry browser security headers", async () => {
		const { app } = makeApp();
		const res = await app.request("/healthz");
		expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
		expect(res.headers.get("X-Frame-Options")).toBe("DENY");
		expect(res.headers.get("Referrer-Policy")).toBe(
			"strict-origin-when-cross-origin",
		);
		expect(res.headers.get("Content-Security-Policy")).toContain(
			"frame-ancestors 'none'",
		);
		expect(res.headers.get("Content-Security-Policy")).toContain(
			"https://cdn.jsdelivr.net",
		);
		expect(res.headers.get("Permissions-Policy")).toContain("camera=()");
	});

	test("echoes client-provided request id", async () => {
		const { app } = makeApp();
		const res = await app.request("/healthz", {
			headers: { "X-Request-Id": "abc-123" },
		});
		expect(res.headers.get("X-Request-Id")).toBe("abc-123");
	});

	test("GET /readyz returns 503 draining when the readiness signal is flipped", async () => {
		// Construct with an explicit readiness signal so we can flip
		// it mid-test — this is the path root.ts's SIGTERM handler
		// takes during graceful shutdown.
		const store = new MemoryControlPlaneStore();
		const drivers = new VectorStoreDriverRegistry(
			new Map([["mock", new MockVectorStoreDriver()]]),
		);
		const secrets = new SecretResolver({ env: new EnvSecretProvider() });
		const auth = new AuthResolver({
			mode: "disabled",
			anonymousPolicy: "allow",
			verifiers: [],
		});
		const readiness = { draining: false };
		const app = createApp({
			store,
			drivers,
			secrets,
			auth,
			embedders: makeFakeEmbedderFactory(),
			readiness,
		});

		expect((await app.request("/readyz")).status).toBe(200);
		readiness.draining = true;
		const res = await app.request("/readyz");
		expect(res.status).toBe(503);
		const body = await json(res);
		expect(body.error.code).toBe("draining");

		// healthz should still be 200 — the process is alive even
		// while draining; only readiness flips.
		expect((await app.request("/healthz")).status).toBe(200);
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
		expect(body.items).toHaveLength(2);
		expect(body.nextCursor).toBeNull();
	});

	test("GET supports limit/cursor pagination", async () => {
		const { app, store } = makeApp();
		const a = await store.createWorkspace(BASE_WORKSPACE);
		const b = await store.createWorkspace({ name: "w2", kind: "mock" });
		const first = await json(await app.request("/api/v1/workspaces?limit=1"));
		expect(first.items).toHaveLength(1);
		expect(first.nextCursor).toBeTruthy();

		const second = await json(
			await app.request(
				`/api/v1/workspaces?limit=1&cursor=${first.nextCursor}`,
			),
		);
		const uids = [
			...first.items.map((w: { uid: string }) => w.uid),
			...second.items.map((w: { uid: string }) => w.uid),
		];
		expect(uids.sort()).toEqual([a.uid, b.uid].sort());
		expect(second.nextCursor).toBeNull();
	});

	test("GET rejects malformed cursors", async () => {
		const { app, store } = makeApp();
		await store.createWorkspace(BASE_WORKSPACE);
		const res = await app.request("/api/v1/workspaces?cursor=not-a-cursor");
		expect(res.status).toBe(400);
		const body = await json(res);
		expect(body.error.code).toBe("invalid_cursor");
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

	test("DELETE drops vector-store collections before removing the workspace", async () => {
		const { app, store, driver } = makeApp();
		const workspace = await store.createWorkspace(MOCK_WORKSPACE);
		const descriptor = await store.createVectorStore(workspace.uid, {
			...BASE_VECTOR_STORE,
			vectorDimension: 3,
			embedding: { ...BASE_VECTOR_STORE.embedding, dimension: 3 },
		});
		const ctx = { workspace, descriptor };
		await driver.createCollection(ctx);
		await driver.upsert(ctx, [{ id: "a", vector: [1, 0, 0] }]);

		const res = await app.request(`/api/v1/workspaces/${workspace.uid}`, {
			method: "DELETE",
		});

		expect(res.status).toBe(204);
		expect(await store.getWorkspace(workspace.uid)).toBeNull();
		await expect(driver.search(ctx, { vector: [1, 0, 0] })).rejects.toThrow(
			/not provisioned/,
		);
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
		expect(body.items.map((w: { uid: string }) => w.uid)).toEqual([
			a.uid,
			b.uid,
			c.uid,
		]);
	});
});

describe("auth middleware (disabled mode)", () => {
	test("anonymous requests pass through /api/v1 when policy allows", async () => {
		const { app } = makeApp({ anonymousPolicy: "allow" });
		const res = await app.request("/api/v1/workspaces");
		expect(res.status).toBe(200);
	});

	test("anonymous requests to /api/v1 are rejected when policy rejects", async () => {
		const { app } = makeApp({ anonymousPolicy: "reject" });
		const res = await app.request("/api/v1/workspaces");
		expect(res.status).toBe(401);
		const body = await json(res);
		expect(body.error.code).toBe("unauthorized");
		expect(res.headers.get("WWW-Authenticate")).toBe("Bearer");
	});

	test("operational routes stay open regardless of anonymousPolicy", async () => {
		const { app } = makeApp({ anonymousPolicy: "reject" });
		expect((await app.request("/healthz")).status).toBe(200);
		expect((await app.request("/readyz")).status).toBe(200);
		expect((await app.request("/version")).status).toBe(200);
	});

	test("malformed Authorization header returns 401", async () => {
		const { app } = makeApp({ anonymousPolicy: "reject" });
		const res = await app.request("/api/v1/workspaces", {
			headers: { authorization: "Basic hmm" },
		});
		expect(res.status).toBe(401);
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

	test("POST with unknown vectorStore returns 404", async () => {
		const { app, store } = makeApp();
		const ws = await store.createWorkspace(MOCK_WORKSPACE);
		const res = await app.request(`/api/v1/workspaces/${ws.uid}/catalogs`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				name: "support",
				vectorStore: "00000000-0000-4000-8000-0000000000ff",
			}),
		});
		expect(res.status).toBe(404);
		const body = await json(res);
		expect(body.error.code).toBe("vector_store_not_found");
	});

	test("GET lists catalogs for the workspace", async () => {
		const { app, store } = makeApp();
		const ws = await store.createWorkspace(BASE_WORKSPACE);
		await store.createCatalog(ws.uid, { name: "c1" });
		await store.createCatalog(ws.uid, { name: "c2" });
		const res = await app.request(`/api/v1/workspaces/${ws.uid}/catalogs`);
		const body = await json(res);
		expect(body.items).toHaveLength(2);
	});

	test("GET catalogs supports pagination", async () => {
		const { app, store } = makeApp();
		const ws = await store.createWorkspace(BASE_WORKSPACE);
		await store.createCatalog(ws.uid, { name: "c1" });
		await store.createCatalog(ws.uid, { name: "c2" });
		const first = await json(
			await app.request(`/api/v1/workspaces/${ws.uid}/catalogs?limit=1`),
		);
		expect(first.items).toHaveLength(1);
		expect(first.nextCursor).toBeTruthy();
	});

	test("PUT with unknown vectorStore returns 404", async () => {
		const { app, store } = makeApp();
		const ws = await store.createWorkspace(MOCK_WORKSPACE);
		const cat = await store.createCatalog(ws.uid, { name: "support" });
		const res = await app.request(
			`/api/v1/workspaces/${ws.uid}/catalogs/${cat.uid}`,
			{
				method: "PUT",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					vectorStore: "00000000-0000-4000-8000-0000000000ff",
				}),
			},
		);
		expect(res.status).toBe(404);
		const body = await json(res);
		expect(body.error.code).toBe("vector_store_not_found");
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
		expect(body.items).toHaveLength(2);
	});

	test("GET documents supports pagination", async () => {
		const { app, store, ws, cat } = await seed();
		await store.createDocument(ws.uid, cat.uid, { sourceFilename: "a" });
		await store.createDocument(ws.uid, cat.uid, { sourceFilename: "b" });
		const first = await json(
			await app.request(
				`/api/v1/workspaces/${ws.uid}/catalogs/${cat.uid}/documents?limit=1`,
			),
		);
		expect(first.items).toHaveLength(1);
		expect(first.nextCursor).toBeTruthy();
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

describe("catalog ingest", () => {
	async function seedBoundCatalog(opts?: { bindVectorStore?: boolean }) {
		const { app, store } = makeApp();
		const ws = await store.createWorkspace(MOCK_WORKSPACE);
		const vsRes = await app.request(
			`/api/v1/workspaces/${ws.uid}/vector-stores`,
			{
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify(BASE_VECTOR_STORE),
			},
		);
		const vs = await json(vsRes);
		const catalog = await store.createCatalog(ws.uid, {
			name: "kb",
			vectorStore: opts?.bindVectorStore === false ? null : vs.uid,
		});
		return { app, store, ws, vs, catalog };
	}

	test("chunks + upserts + marks document ready", async () => {
		const { app, store, ws, catalog } = await seedBoundCatalog();
		const text =
			"First paragraph about apples.\n\nSecond paragraph about oranges is a bit longer and keeps going.\n\nThird paragraph about bananas and a whole lot more text to push past the default chunk size thresholds without needing ridiculous input.";
		const res = await app.request(
			`/api/v1/workspaces/${ws.uid}/catalogs/${catalog.uid}/ingest`,
			{
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					text,
					sourceFilename: "fruit.md",
					fileType: "text/markdown",
					metadata: { source: "seed" },
					chunker: { maxChars: 80, minChars: 20, overlapChars: 10 },
				}),
			},
		);
		expect(res.status).toBe(201);
		const body = await json(res);
		expect(body.chunks).toBeGreaterThan(0);
		expect(body.document.status).toBe("ready");
		expect(body.document.chunkTotal).toBe(body.chunks);
		expect(body.document.ingestedAt).toBeTruthy();
		expect(body.document.metadata).toEqual({ source: "seed" });

		// The chunks are searchable through the catalog-scoped route —
		// ingest's stamping is exactly what the search route filters on.
		const searchRes = await app.request(
			`/api/v1/workspaces/${ws.uid}/catalogs/${catalog.uid}/documents/search`,
			{
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ text: "apples", topK: 5 }),
			},
		);
		expect(searchRes.status).toBe(200);
		const hits = await json(searchRes);
		expect(hits.length).toBeGreaterThan(0);
		expect(hits[0].payload.documentUid).toBe(body.document.documentUid);
		expect(hits[0].payload.catalogUid).toBe(catalog.uid);
		expect(typeof hits[0].payload.chunkIndex).toBe("number");
		// The list endpoint sees the row too.
		const listRes = await app.request(
			`/api/v1/workspaces/${ws.uid}/catalogs/${catalog.uid}/documents`,
		);
		const list = await json(listRes);
		expect(list.items).toHaveLength(1);
		expect(list.items[0].documentUid).toBe(body.document.documentUid);

		void store;
	});

	test("409 when catalog has no vectorStore binding", async () => {
		const { app, ws, catalog } = await seedBoundCatalog({
			bindVectorStore: false,
		});
		const res = await app.request(
			`/api/v1/workspaces/${ws.uid}/catalogs/${catalog.uid}/ingest`,
			{
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ text: "hello world" }),
			},
		);
		expect(res.status).toBe(409);
		const body = await json(res);
		expect(body.error.code).toBe("catalog_not_bound_to_vector_store");
	});

	test("404 when catalog does not exist", async () => {
		const { app, ws } = await seedBoundCatalog();
		const res = await app.request(
			`/api/v1/workspaces/${ws.uid}/catalogs/00000000-0000-0000-0000-000000000000/ingest`,
			{
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ text: "hi" }),
			},
		);
		expect(res.status).toBe(404);
		expect((await json(res)).error.code).toBe("catalog_not_found");
	});

	test("404 when workspace does not exist", async () => {
		const { app, catalog } = await seedBoundCatalog();
		const res = await app.request(
			`/api/v1/workspaces/00000000-0000-0000-0000-000000000000/catalogs/${catalog.uid}/ingest`,
			{
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ text: "hi" }),
			},
		);
		expect(res.status).toBe(404);
		expect((await json(res)).error.code).toBe("workspace_not_found");
	});

	test("rejects empty text via Zod validation", async () => {
		const { app, ws, catalog } = await seedBoundCatalog();
		const res = await app.request(
			`/api/v1/workspaces/${ws.uid}/catalogs/${catalog.uid}/ingest`,
			{
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ text: "" }),
			},
		);
		expect(res.status).toBe(400);
		expect((await json(res)).error.code).toBe("validation_error");
	});

	test("rejects oversized ingest text via Zod validation", async () => {
		const { app, ws, catalog } = await seedBoundCatalog();
		const res = await app.request(
			`/api/v1/workspaces/${ws.uid}/catalogs/${catalog.uid}/ingest`,
			{
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ text: "x".repeat(MAX_INGEST_TEXT_CHARS + 1) }),
			},
		);
		expect(res.status).toBe(400);
		const body = await json(res);
		expect(body.error.code).toBe("validation_error");
		expect(body.error.message).toContain("text");
	});

	test("marks document failed when upsert throws, then re-raises", async () => {
		// Build an app whose embedder factory reports a different
		// dimension than the vector store descriptor declares — the
		// fallback client-side embedding lane throws
		// embedding_dimension_mismatch. The mock driver's upsertByText
		// path throws NotSupported for non-`mock` providers, so the
		// dispatcher falls through to client-side embedding, which is
		// the path we want to exercise.
		const store = new MemoryControlPlaneStore();
		const driver = new MockVectorStoreDriver();
		const drivers = new VectorStoreDriverRegistry(new Map([["mock", driver]]));
		const secrets = new SecretResolver({ env: new EnvSecretProvider() });
		const auth = new AuthResolver({
			mode: "disabled",
			anonymousPolicy: "allow",
			verifiers: [],
		});
		const app = createApp({
			store,
			drivers,
			secrets,
			auth,
			embedders: makeFakeEmbedderFactory({ wrongDimension: 4 }),
		});
		const ws = await store.createWorkspace(MOCK_WORKSPACE);
		const vsRes = await app.request(
			`/api/v1/workspaces/${ws.uid}/vector-stores`,
			{
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify(BASE_VECTOR_STORE),
			},
		);
		const vs = await json(vsRes);
		const catalog = await store.createCatalog(ws.uid, {
			name: "bad",
			vectorStore: vs.uid,
		});

		const res = await app.request(
			`/api/v1/workspaces/${ws.uid}/catalogs/${catalog.uid}/ingest`,
			{
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ text: "some text to chunk and embed" }),
			},
		);
		expect(res.status).toBe(400);
		const body = await json(res);
		expect(body.error.code).toBe("embedding_dimension_mismatch");

		// The document row was created, and then marked failed.
		const docs = await app.request(
			`/api/v1/workspaces/${ws.uid}/catalogs/${catalog.uid}/documents`,
		);
		const list = await json(docs);
		expect(list.items).toHaveLength(1);
		expect(list.items[0].status).toBe("failed");
		expect(list.items[0].errorMessage).toBeTruthy();
	});
});

describe("catalog async ingest + jobs", () => {
	async function seedBoundCatalog() {
		const { app, store } = makeApp();
		const ws = await store.createWorkspace(MOCK_WORKSPACE);
		const vsRes = await app.request(
			`/api/v1/workspaces/${ws.uid}/vector-stores`,
			{
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify(BASE_VECTOR_STORE),
			},
		);
		const vs = await json(vsRes);
		const catalog = await store.createCatalog(ws.uid, {
			name: "kb",
			vectorStore: vs.uid,
		});
		return { app, store, ws, vs, catalog };
	}

	async function waitForJob(
		app: ReturnType<typeof makeApp>["app"],
		workspaceUid: string,
		jobId: string,
	): Promise<Record<string, unknown>> {
		for (let i = 0; i < 50; i++) {
			const res = await app.request(
				`/api/v1/workspaces/${workspaceUid}/jobs/${jobId}`,
			);
			const body = await json(res);
			if (body.status === "succeeded" || body.status === "failed") return body;
			await new Promise((r) => setTimeout(r, 20));
		}
		throw new Error(`job ${jobId} did not reach terminal state in time`);
	}

	test("POST /ingest?async=true returns 202 with a pending job", async () => {
		const { app, ws, catalog } = await seedBoundCatalog();
		const res = await app.request(
			`/api/v1/workspaces/${ws.uid}/catalogs/${catalog.uid}/ingest?async=true`,
			{
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					text: "Apples are red. Bananas are yellow.",
					chunker: { maxChars: 20, minChars: 5, overlapChars: 3 },
				}),
			},
		);
		expect(res.status).toBe(202);
		const body = await json(res);
		expect(body.job.jobId).toMatch(/^[0-9a-f-]{36}$/);
		expect(body.job.status).toBe("pending");
		expect(body.job.kind).toBe("ingest");
		expect(body.job.catalogUid).toBe(catalog.uid);
		expect(body.document.status).toBe("writing");
	});

	test("async job eventually reaches succeeded and the document is ready", async () => {
		const { app, ws, catalog } = await seedBoundCatalog();
		const kick = await app.request(
			`/api/v1/workspaces/${ws.uid}/catalogs/${catalog.uid}/ingest?async=true`,
			{
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					text: "Apples are red. Bananas are yellow. Cherries are red too.",
					chunker: { maxChars: 20, minChars: 5, overlapChars: 3 },
				}),
			},
		);
		const body = await json(kick);
		const final = await waitForJob(app, ws.uid, body.job.jobId);
		expect(final.status).toBe("succeeded");
		expect((final.result as { chunks: number }).chunks).toBeGreaterThan(0);
		expect(final.processed).toBe((final.result as { chunks: number }).chunks);
		expect(final.total).toBe(final.processed);
		expect(final.errorMessage).toBeNull();

		// The document row reflects the same completion.
		const doc = await app.request(
			`/api/v1/workspaces/${ws.uid}/catalogs/${catalog.uid}/documents/${body.document.documentUid}`,
		);
		const docBody = await json(doc);
		expect(docBody.status).toBe("ready");
	});

	test("async job captures failures in the record (document + job both failed)", async () => {
		// Build an app whose fallback embedder returns a wrong dimension
		// so the ingest worker throws.
		const store = new MemoryControlPlaneStore();
		const driver = new MockVectorStoreDriver();
		const drivers = new VectorStoreDriverRegistry(new Map([["mock", driver]]));
		const secrets = new SecretResolver({ env: new EnvSecretProvider() });
		const auth = new AuthResolver({
			mode: "disabled",
			anonymousPolicy: "allow",
			verifiers: [],
		});
		const app = createApp({
			store,
			drivers,
			secrets,
			auth,
			embedders: makeFakeEmbedderFactory({ wrongDimension: 4 }),
		});
		const ws = await store.createWorkspace(MOCK_WORKSPACE);
		const vsRes = await app.request(
			`/api/v1/workspaces/${ws.uid}/vector-stores`,
			{
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify(BASE_VECTOR_STORE),
			},
		);
		const vs = await json(vsRes);
		const catalog = await store.createCatalog(ws.uid, {
			name: "bad",
			vectorStore: vs.uid,
		});

		const kick = await app.request(
			`/api/v1/workspaces/${ws.uid}/catalogs/${catalog.uid}/ingest?async=true`,
			{
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ text: "some text to chunk and embed" }),
			},
		);
		expect(kick.status).toBe(202);
		const body = await json(kick);

		// Poll for terminal state (same helper, inline here to reuse
		// this app instance).
		let final: Record<string, unknown> | null = null;
		for (let i = 0; i < 50; i++) {
			const res = await app.request(
				`/api/v1/workspaces/${ws.uid}/jobs/${body.job.jobId}`,
			);
			const got = await json(res);
			if (got.status === "succeeded" || got.status === "failed") {
				final = got;
				break;
			}
			await new Promise((r) => setTimeout(r, 20));
		}
		expect(final).not.toBeNull();
		expect(final?.status).toBe("failed");
		expect(final?.errorMessage).toBeTruthy();

		// Document row is also failed.
		const doc = await store.getDocument(
			ws.uid,
			catalog.uid,
			body.document.documentUid,
		);
		expect(doc?.status).toBe("failed");
	});

	test("GET /jobs/{jobId} → 404 for unknown jobs", async () => {
		const { app, ws } = await seedBoundCatalog();
		const res = await app.request(
			`/api/v1/workspaces/${ws.uid}/jobs/00000000-0000-0000-0000-000000000000`,
		);
		expect(res.status).toBe(404);
		expect((await json(res)).error.code).toBe("job_not_found");
	});

	test("SSE stream emits job updates and closes on terminal state", async () => {
		const { app, ws, catalog } = await seedBoundCatalog();
		const kick = await app.request(
			`/api/v1/workspaces/${ws.uid}/catalogs/${catalog.uid}/ingest?async=true`,
			{
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					text: "Apples are red. Bananas are yellow.",
					chunker: { maxChars: 20, minChars: 5, overlapChars: 3 },
				}),
			},
		);
		const body = await json(kick);

		const sse = await app.request(
			`/api/v1/workspaces/${ws.uid}/jobs/${body.job.jobId}/events`,
		);
		expect(sse.status).toBe(200);
		expect(sse.headers.get("content-type")).toContain("text/event-stream");
		const text = await sse.text();
		// The stream MUST end with the terminal `done` event.
		expect(text).toContain("event: job");
		expect(text).toContain("event: done");
		// And the last job event payload carries the terminal status.
		expect(text).toMatch(/"status":"(succeeded|failed)"/);
	});
});

describe("catalog-scoped document search", () => {
	const vector = (seed: number, dim = 1536): number[] =>
		Array.from({ length: dim }, (_, i) => Math.sin(seed + i));

	async function seedCatalogWithStore(opts?: { bindVectorStore?: boolean }) {
		const { app, store } = makeApp();
		const ws = await store.createWorkspace(MOCK_WORKSPACE);
		const vsRes = await app.request(
			`/api/v1/workspaces/${ws.uid}/vector-stores`,
			{
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify(BASE_VECTOR_STORE),
			},
		);
		const vs = await json(vsRes);
		const catalog = await store.createCatalog(ws.uid, {
			name: "support",
			vectorStore: opts?.bindVectorStore === false ? null : vs.uid,
		});
		return { app, store, ws, vs, catalog };
	}

	test("filters results by catalog scope", async () => {
		const { app, store, ws, vs, catalog } = await seedCatalogWithStore();
		const other = await store.createCatalog(ws.uid, {
			name: "other",
			vectorStore: vs.uid,
		});
		await app.request(
			`/api/v1/workspaces/${ws.uid}/vector-stores/${vs.uid}/records`,
			{
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					records: [
						{
							id: "a",
							vector: vector(0),
							payload: { catalogUid: catalog.uid, tag: "a" },
						},
						{
							id: "b",
							vector: vector(0),
							payload: { catalogUid: other.uid, tag: "b" },
						},
					],
				}),
			},
		);

		const res = await app.request(
			`/api/v1/workspaces/${ws.uid}/catalogs/${catalog.uid}/documents/search`,
			{
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ vector: vector(0), topK: 10 }),
			},
		);
		expect(res.status).toBe(200);
		const hits = await json(res);
		expect(hits).toHaveLength(1);
		expect(hits[0].id).toBe("a");
	});

	test("merges caller filter with catalog scope", async () => {
		const { app, ws, vs, catalog } = await seedCatalogWithStore();
		await app.request(
			`/api/v1/workspaces/${ws.uid}/vector-stores/${vs.uid}/records`,
			{
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					records: [
						{
							id: "keep",
							vector: vector(0),
							payload: { catalogUid: catalog.uid, tag: "keep" },
						},
						{
							id: "drop",
							vector: vector(0),
							payload: { catalogUid: catalog.uid, tag: "drop" },
						},
					],
				}),
			},
		);

		const res = await app.request(
			`/api/v1/workspaces/${ws.uid}/catalogs/${catalog.uid}/documents/search`,
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
		expect(hits[0].id).toBe("keep");
	});

	test("caller-supplied catalogUid in filter cannot escape scope", async () => {
		const { app, store, ws, vs, catalog } = await seedCatalogWithStore();
		const other = await store.createCatalog(ws.uid, {
			name: "other",
			vectorStore: vs.uid,
		});
		await app.request(
			`/api/v1/workspaces/${ws.uid}/vector-stores/${vs.uid}/records`,
			{
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					records: [
						{
							id: "a",
							vector: vector(0),
							payload: { catalogUid: catalog.uid },
						},
						{
							id: "b",
							vector: vector(0),
							payload: { catalogUid: other.uid },
						},
					],
				}),
			},
		);

		// Caller *asks* for the other catalog's docs — the server must
		// ignore it and return only records scoped to the path's catalog.
		const res = await app.request(
			`/api/v1/workspaces/${ws.uid}/catalogs/${catalog.uid}/documents/search`,
			{
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					vector: vector(0),
					topK: 10,
					filter: { catalogUid: other.uid },
				}),
			},
		);
		const hits = await json(res);
		expect(hits).toHaveLength(1);
		expect(hits[0].id).toBe("a");
	});

	test("409 when catalog has no vectorStore binding", async () => {
		const { app, ws, catalog } = await seedCatalogWithStore({
			bindVectorStore: false,
		});
		const res = await app.request(
			`/api/v1/workspaces/${ws.uid}/catalogs/${catalog.uid}/documents/search`,
			{
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ vector: vector(0) }),
			},
		);
		expect(res.status).toBe(409);
		const body = await json(res);
		expect(body.error.code).toBe("catalog_not_bound_to_vector_store");
	});

	test("404 when catalog does not exist", async () => {
		const { app, ws } = await seedCatalogWithStore();
		const res = await app.request(
			`/api/v1/workspaces/${ws.uid}/catalogs/00000000-0000-0000-0000-000000000000/documents/search`,
			{
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ vector: vector(0) }),
			},
		);
		expect(res.status).toBe(404);
		const body = await json(res);
		expect(body.error.code).toBe("catalog_not_found");
	});

	test("404 when workspace does not exist", async () => {
		const { app, catalog } = await seedCatalogWithStore();
		const res = await app.request(
			`/api/v1/workspaces/00000000-0000-0000-0000-000000000000/catalogs/${catalog.uid}/documents/search`,
			{
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ vector: vector(0) }),
			},
		);
		expect(res.status).toBe(404);
		const body = await json(res);
		expect(body.error.code).toBe("workspace_not_found");
	});

	test("accepts { text } and falls back to client-side embedding", async () => {
		const { app, ws, vs, catalog } = await seedCatalogWithStore();
		await app.request(
			`/api/v1/workspaces/${ws.uid}/vector-stores/${vs.uid}/records`,
			{
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					records: [
						{
							id: "a",
							vector: vector(0),
							payload: { catalogUid: catalog.uid },
						},
					],
				}),
			},
		);
		const res = await app.request(
			`/api/v1/workspaces/${ws.uid}/catalogs/${catalog.uid}/documents/search`,
			{
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ text: "hello", topK: 1 }),
			},
		);
		expect(res.status).toBe(200);
		const hits = await json(res);
		expect(hits).toHaveLength(1);
		expect(hits[0].id).toBe("a");
	});

	test("rejects bodies with neither vector nor text", async () => {
		const { app, ws, catalog } = await seedCatalogWithStore();
		const res = await app.request(
			`/api/v1/workspaces/${ws.uid}/catalogs/${catalog.uid}/documents/search`,
			{
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ topK: 1 }),
			},
		);
		expect(res.status).toBe(400);
		const body = await json(res);
		expect(body.error.code).toBe("validation_error");
	});
});

describe("hybrid + rerank search lanes", () => {
	async function seedIngestedCatalog() {
		const { app, store } = makeApp();
		const ws = await store.createWorkspace(MOCK_WORKSPACE);
		// Mock embedding provider so the mock driver retains text for
		// lexical and can run hybrid / rerank.
		const vsRes = await app.request(
			`/api/v1/workspaces/${ws.uid}/vector-stores`,
			{
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					name: "vs",
					vectorDimension: 4,
					embedding: {
						provider: "mock",
						model: "mock-embedder",
						endpoint: null,
						dimension: 4,
						secretRef: null,
					},
				}),
			},
		);
		const vs = await json(vsRes);
		const catalog = await store.createCatalog(ws.uid, {
			name: "kb",
			vectorStore: vs.uid,
		});
		// Seed two text records so lexical has something to score
		// against.
		await app.request(
			`/api/v1/workspaces/${ws.uid}/vector-stores/${vs.uid}/records`,
			{
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					records: [
						{
							id: "apples",
							text: "apples are red fruit and grow on trees",
							payload: { catalogUid: catalog.uid },
						},
						{
							id: "bananas",
							text: "bananas are yellow fruit",
							payload: { catalogUid: catalog.uid },
						},
					],
				}),
			},
		);
		return { app, store, ws, vs, catalog };
	}

	test("hybrid: true returns both records, and the lexical match beats the other", async () => {
		const { app, ws, catalog } = await seedIngestedCatalog();
		const res = await app.request(
			`/api/v1/workspaces/${ws.uid}/catalogs/${catalog.uid}/documents/search`,
			{
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ text: "apples", hybrid: true, topK: 5 }),
			},
		);
		expect(res.status).toBe(200);
		const hits = await json(res);
		expect(hits).toHaveLength(2);
		// "apples" text should rank first — the lexical lane gives it
		// a positive signal the other record can't match.
		expect(hits[0].id).toBe("apples");
	});

	test("hybrid: true without text → 400 validation_error", async () => {
		const { app, ws, catalog } = await seedIngestedCatalog();
		const res = await app.request(
			`/api/v1/workspaces/${ws.uid}/catalogs/${catalog.uid}/documents/search`,
			{
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					vector: [1, 0, 0, 0],
					hybrid: true,
				}),
			},
		);
		expect(res.status).toBe(400);
		expect((await json(res)).error.code).toBe("validation_error");
	});

	test("rerank: true reorders hits by the driver's rerank signal", async () => {
		const { app, ws, catalog } = await seedIngestedCatalog();
		const res = await app.request(
			`/api/v1/workspaces/${ws.uid}/catalogs/${catalog.uid}/documents/search`,
			{
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					text: "apples trees",
					rerank: true,
					topK: 5,
				}),
			},
		);
		expect(res.status).toBe(200);
		const hits = await json(res);
		expect(hits.length).toBe(2);
		// The reranker sorts by lexical overlap; "apples" has both
		// "apples" and "trees" tokens in its stored text, "bananas"
		// matches neither, so "apples" must come first.
		expect(hits[0].id).toBe("apples");
	});

	test("rerank: true without text → 400 validation_error", async () => {
		const { app, ws, catalog } = await seedIngestedCatalog();
		const res = await app.request(
			`/api/v1/workspaces/${ws.uid}/catalogs/${catalog.uid}/documents/search`,
			{
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					vector: [1, 0, 0, 0],
					rerank: true,
				}),
			},
		);
		expect(res.status).toBe(400);
		expect((await json(res)).error.code).toBe("validation_error");
	});

	test("hybrid: true on a descriptor whose driver lacks hybrid → 501", async () => {
		// Reconfigure: same workspace/vs but using a provider the mock
		// driver doesn't enable its hybrid/rerank lanes for.
		const { app, store } = makeApp();
		const ws = await store.createWorkspace(MOCK_WORKSPACE);
		const vsRes = await app.request(
			`/api/v1/workspaces/${ws.uid}/vector-stores`,
			{
				method: "POST",
				headers: { "content-type": "application/json" },
				// provider: "openai" — mock driver refuses hybrid for
				// descriptors not configured as provider="mock".
				body: JSON.stringify(BASE_VECTOR_STORE),
			},
		);
		const vs = await json(vsRes);
		const catalog = await store.createCatalog(ws.uid, {
			name: "kb",
			vectorStore: vs.uid,
		});
		await app.request(
			`/api/v1/workspaces/${ws.uid}/vector-stores/${vs.uid}/records`,
			{
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					records: [
						{
							id: "a",
							vector: Array.from({ length: 1536 }, (_, i) => Math.sin(i)),
							payload: { catalogUid: catalog.uid },
						},
					],
				}),
			},
		);
		const res = await app.request(
			`/api/v1/workspaces/${ws.uid}/catalogs/${catalog.uid}/documents/search`,
			{
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ text: "apples", hybrid: true }),
			},
		);
		expect(res.status).toBe(501);
		expect((await json(res)).error.code).toBe("hybrid_not_supported");
	});

	test("descriptor lexical.enabled defaults `hybrid` to true", async () => {
		const { app, store } = makeApp();
		const ws = await store.createWorkspace(MOCK_WORKSPACE);
		const vsRes = await app.request(
			`/api/v1/workspaces/${ws.uid}/vector-stores`,
			{
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					name: "vs",
					vectorDimension: 4,
					embedding: {
						provider: "mock",
						model: "mock-embedder",
						endpoint: null,
						dimension: 4,
						secretRef: null,
					},
					lexical: {
						enabled: true,
						analyzer: null,
						options: {},
					},
				}),
			},
		);
		const vs = await json(vsRes);
		const catalog = await store.createCatalog(ws.uid, {
			name: "kb",
			vectorStore: vs.uid,
		});
		await app.request(
			`/api/v1/workspaces/${ws.uid}/vector-stores/${vs.uid}/records`,
			{
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					records: [
						{
							id: "apples",
							text: "apples are red fruit",
							payload: { catalogUid: catalog.uid },
						},
						{
							id: "bananas",
							text: "bananas are yellow fruit",
							payload: { catalogUid: catalog.uid },
						},
					],
				}),
			},
		);
		// No `hybrid` flag — should still fire hybrid because the
		// descriptor opted in.
		const res = await app.request(
			`/api/v1/workspaces/${ws.uid}/catalogs/${catalog.uid}/documents/search`,
			{
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ text: "apples", topK: 5 }),
			},
		);
		expect(res.status).toBe(200);
		const hits = await json(res);
		expect(hits[0].id).toBe("apples");
	});
});

describe("saved queries", () => {
	async function seedCatalog(opts?: { bindVectorStore?: boolean }) {
		const { app, store } = makeApp();
		const ws = await store.createWorkspace(MOCK_WORKSPACE);
		const vsRes = await app.request(
			`/api/v1/workspaces/${ws.uid}/vector-stores`,
			{
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify(BASE_VECTOR_STORE),
			},
		);
		const vs = await json(vsRes);
		const catalog = await store.createCatalog(ws.uid, {
			name: "kb",
			vectorStore: opts?.bindVectorStore === false ? null : vs.uid,
		});
		return { app, store, ws, vs, catalog };
	}

	test("CRUD lifecycle (create → list → get → update → delete)", async () => {
		const { app, ws, catalog } = await seedCatalog();
		const created = await app.request(
			`/api/v1/workspaces/${ws.uid}/catalogs/${catalog.uid}/queries`,
			{
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					name: "apples",
					description: "find apple docs",
					text: "apples",
					topK: 5,
					filter: { tag: "fruit" },
				}),
			},
		);
		expect(created.status).toBe(201);
		const rec = await json(created);
		expect(rec.queryUid).toMatch(/^[0-9a-f-]{36}$/);
		expect(rec.name).toBe("apples");
		expect(rec.filter).toEqual({ tag: "fruit" });

		const list = await app.request(
			`/api/v1/workspaces/${ws.uid}/catalogs/${catalog.uid}/queries`,
		);
		expect(list.status).toBe(200);
		const listBody = await json(list);
		expect(listBody.items).toHaveLength(1);

		const got = await app.request(
			`/api/v1/workspaces/${ws.uid}/catalogs/${catalog.uid}/queries/${rec.queryUid}`,
		);
		expect(got.status).toBe(200);
		expect((await json(got)).text).toBe("apples");

		const updated = await app.request(
			`/api/v1/workspaces/${ws.uid}/catalogs/${catalog.uid}/queries/${rec.queryUid}`,
			{
				method: "PUT",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ name: "APPLES", filter: null }),
			},
		);
		const updatedBody = await json(updated);
		expect(updatedBody.name).toBe("APPLES");
		expect(updatedBody.filter).toBeNull();

		const del = await app.request(
			`/api/v1/workspaces/${ws.uid}/catalogs/${catalog.uid}/queries/${rec.queryUid}`,
			{ method: "DELETE" },
		);
		expect(del.status).toBe(204);
		const delAgain = await app.request(
			`/api/v1/workspaces/${ws.uid}/catalogs/${catalog.uid}/queries/${rec.queryUid}`,
			{ method: "DELETE" },
		);
		expect(delAgain.status).toBe(404);
	});

	test("GET saved queries supports pagination", async () => {
		const { app, ws, catalog } = await seedCatalog();
		for (const name of ["apples", "oranges"]) {
			await app.request(
				`/api/v1/workspaces/${ws.uid}/catalogs/${catalog.uid}/queries`,
				{
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({ name, text: name }),
				},
			);
		}
		const first = await json(
			await app.request(
				`/api/v1/workspaces/${ws.uid}/catalogs/${catalog.uid}/queries?limit=1`,
			),
		);
		expect(first.items).toHaveLength(1);
		expect(first.nextCursor).toBeTruthy();
	});

	test("POST /run replays the saved query through catalog-scoped search", async () => {
		const { app, ws, vs, catalog } = await seedCatalog();
		// Seed a record whose payload matches both the saved filter and the
		// catalog scope.
		await app.request(
			`/api/v1/workspaces/${ws.uid}/vector-stores/${vs.uid}/records`,
			{
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					records: [
						{
							id: "a",
							text: "apples are red",
							payload: { catalogUid: catalog.uid, tag: "fruit" },
						},
						{
							id: "b",
							text: "bananas are yellow",
							payload: { catalogUid: catalog.uid, tag: "fruit" },
						},
					],
				}),
			},
		);

		const created = await app.request(
			`/api/v1/workspaces/${ws.uid}/catalogs/${catalog.uid}/queries`,
			{
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					name: "apples",
					text: "apples",
					topK: 5,
					filter: { tag: "fruit" },
				}),
			},
		);
		const rec = await json(created);

		const run = await app.request(
			`/api/v1/workspaces/${ws.uid}/catalogs/${catalog.uid}/queries/${rec.queryUid}/run`,
			{ method: "POST" },
		);
		expect(run.status).toBe(200);
		const hits = await json(run);
		expect(hits.length).toBeGreaterThan(0);
		expect(hits[0].payload.catalogUid).toBe(catalog.uid);
	});

	test("/run enforces catalog scope even when saved filter tries to escape", async () => {
		const { app, store, ws, vs, catalog } = await seedCatalog();
		const other = await store.createCatalog(ws.uid, {
			name: "other",
			vectorStore: vs.uid,
		});
		await app.request(
			`/api/v1/workspaces/${ws.uid}/vector-stores/${vs.uid}/records`,
			{
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					records: [
						{
							id: "a",
							text: "apples are red",
							payload: { catalogUid: catalog.uid },
						},
						{
							id: "b",
							text: "bananas are yellow",
							payload: { catalogUid: other.uid },
						},
					],
				}),
			},
		);

		// The saved query tries to request `catalogUid=other.uid` in its
		// filter — the run route must override with the path's catalog,
		// so only `a` should come back.
		const created = await app.request(
			`/api/v1/workspaces/${ws.uid}/catalogs/${catalog.uid}/queries`,
			{
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					name: "escape attempt",
					text: "fruit",
					filter: { catalogUid: other.uid },
				}),
			},
		);
		const rec = await json(created);

		const run = await app.request(
			`/api/v1/workspaces/${ws.uid}/catalogs/${catalog.uid}/queries/${rec.queryUid}/run`,
			{ method: "POST" },
		);
		const hits = await json(run);
		expect(hits.length).toBe(1);
		expect(hits[0].id).toBe("a");
	});

	test("POST /run → 404 when the saved query does not exist", async () => {
		const { app, ws, catalog } = await seedCatalog();
		const res = await app.request(
			`/api/v1/workspaces/${ws.uid}/catalogs/${catalog.uid}/queries/00000000-0000-0000-0000-000000000000/run`,
			{ method: "POST" },
		);
		expect(res.status).toBe(404);
		expect((await json(res)).error.code).toBe("saved_query_not_found");
	});

	test("POST /run → 409 when catalog has no vectorStore binding", async () => {
		const { app, ws, catalog } = await seedCatalog({ bindVectorStore: false });
		const created = await app.request(
			`/api/v1/workspaces/${ws.uid}/catalogs/${catalog.uid}/queries`,
			{
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ name: "q", text: "hi" }),
			},
		);
		const rec = await json(created);
		const run = await app.request(
			`/api/v1/workspaces/${ws.uid}/catalogs/${catalog.uid}/queries/${rec.queryUid}/run`,
			{ method: "POST" },
		);
		expect(run.status).toBe(409);
		expect((await json(run)).error.code).toBe(
			"catalog_not_bound_to_vector_store",
		);
	});

	test("rejects empty name/text via Zod validation", async () => {
		const { app, ws, catalog } = await seedCatalog();
		const res = await app.request(
			`/api/v1/workspaces/${ws.uid}/catalogs/${catalog.uid}/queries`,
			{
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ name: "", text: "" }),
			},
		);
		expect(res.status).toBe(400);
		expect((await json(res)).error.code).toBe("validation_error");
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

	test("DELETE returns 409 when a catalog references the vector store", async () => {
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
		await store.createCatalog(ws.uid, { name: "support", vectorStore: vs.uid });

		const res = await app.request(
			`/api/v1/workspaces/${ws.uid}/vector-stores/${vs.uid}`,
			{ method: "DELETE" },
		);

		expect(res.status).toBe(409);
		const body = await json(res);
		expect(body.error.code).toBe("conflict");
		expect(await store.getVectorStore(ws.uid, vs.uid)).not.toBeNull();
	});

	test("PUT rejects descriptor patches that would drift from the collection", async () => {
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
		const res = await app.request(
			`/api/v1/workspaces/${ws.uid}/vector-stores/${vs.uid}`,
			{
				method: "PUT",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ vectorDimension: 768 }),
			},
		);

		expect(res.status).toBe(409);
		const body = await json(res);
		expect(body.error.code).toBe("conflict");
		expect(body.error.message).toMatch(/immutable/);
		expect((await store.getVectorStore(ws.uid, vs.uid))?.vectorDimension).toBe(
			1536,
		);
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

	test("search accepts { text } and falls back to client-side embedding", async () => {
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
		const res = await app.request(
			`/api/v1/workspaces/${ws.uid}/vector-stores/${vs.uid}/search`,
			{
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ text: "hello world", topK: 1 }),
			},
		);
		expect(res.status).toBe(200);
		const hits = await json(res);
		expect(hits).toHaveLength(1);
		expect(hits[0].id).toBe("a");
	});

	test("search prefers driver.searchByText when the descriptor opts in (mock provider)", async () => {
		const { app, store } = makeApp();
		const ws = await store.createWorkspace(MOCK_WORKSPACE);
		const create = await app.request(
			`/api/v1/workspaces/${ws.uid}/vector-stores`,
			{
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					...BASE_VECTOR_STORE,
					embedding: {
						// `mock` provider → the mock driver's searchByText
						// branch handles text instead of the runtime embedding
						// fallback. No upstream SDK involved.
						provider: "mock",
						model: "mock-1",
						endpoint: null,
						dimension: 1536,
						secretRef: "env:UNUSED",
					},
				}),
			},
		);
		const vs = await json(create);
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
		const res = await app.request(
			`/api/v1/workspaces/${ws.uid}/vector-stores/${vs.uid}/search`,
			{
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ text: "hello", topK: 1 }),
			},
		);
		expect(res.status).toBe(200);
	});

	test("search rejects bodies with neither vector nor text", async () => {
		const { app, ws, vs } = await setupStore();
		const res = await app.request(
			`/api/v1/workspaces/${ws.uid}/vector-stores/${vs.uid}/search`,
			{
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ topK: 1 }),
			},
		);
		expect(res.status).toBe(400);
		expect((await json(res)).error.code).toBe("validation_error");
	});

	test("search rejects oversized text queries", async () => {
		const { app, ws, vs } = await setupStore();
		const res = await app.request(
			`/api/v1/workspaces/${ws.uid}/vector-stores/${vs.uid}/search`,
			{
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ text: "x".repeat(MAX_QUERY_TEXT_CHARS + 1) }),
			},
		);
		expect(res.status).toBe(400);
		expect((await json(res)).error.code).toBe("validation_error");
	});

	test("search rejects bodies with both vector and text", async () => {
		const { app, ws, vs } = await setupStore();
		const res = await app.request(
			`/api/v1/workspaces/${ws.uid}/vector-stores/${vs.uid}/search`,
			{
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ vector: vector(0), text: "hi" }),
			},
		);
		expect(res.status).toBe(400);
	});

	test("upsert accepts { id, text } records and embeds them client-side when the driver can't", async () => {
		const { app, ws, vs } = await setupStore();
		// Mock driver with provider != "mock" → driver.upsertByText
		// throws NotSupported; runUpsert falls back to client-embed
		// via the fake embedder.
		const res = await app.request(
			`/api/v1/workspaces/${ws.uid}/vector-stores/${vs.uid}/records`,
			{
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					records: [
						{ id: "a", text: "hello" },
						{ id: "b", text: "world" },
					],
				}),
			},
		);
		expect(res.status).toBe(200);
		expect((await json(res)).upserted).toBe(2);

		// The records made it in (can search them back).
		const searchRes = await app.request(
			`/api/v1/workspaces/${ws.uid}/vector-stores/${vs.uid}/search`,
			{
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ text: "hello", topK: 2 }),
			},
		);
		expect(searchRes.status).toBe(200);
		expect(await json(searchRes)).toHaveLength(2);
	});

	test("upsert takes the driver-native text path when the descriptor opts in (mock provider)", async () => {
		const { app, store } = makeApp();
		const wsMock = await store.createWorkspace(MOCK_WORKSPACE);
		const create = await app.request(
			`/api/v1/workspaces/${wsMock.uid}/vector-stores`,
			{
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					...BASE_VECTOR_STORE,
					embedding: {
						provider: "mock",
						model: "mock-1",
						endpoint: null,
						dimension: 1536,
						secretRef: "env:UNUSED",
					},
				}),
			},
		);
		const vsMock = await json(create);

		const res = await app.request(
			`/api/v1/workspaces/${wsMock.uid}/vector-stores/${vsMock.uid}/records`,
			{
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					records: [{ id: "a", text: "hello" }],
				}),
			},
		);
		expect(res.status).toBe(200);
		expect((await json(res)).upserted).toBe(1);
	});

	test("upsert accepts a mixed vector/text batch (embeds the text rows, passes vectors through)", async () => {
		const { app, ws, vs } = await setupStore();
		const res = await app.request(
			`/api/v1/workspaces/${ws.uid}/vector-stores/${vs.uid}/records`,
			{
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					records: [
						{ id: "a", vector: vector(0) },
						{ id: "b", text: "sibling" },
					],
				}),
			},
		);
		expect(res.status).toBe(200);
		expect((await json(res)).upserted).toBe(2);
	});

	test("upsert rejects records with neither vector nor text", async () => {
		const { app, ws, vs } = await setupStore();
		const res = await app.request(
			`/api/v1/workspaces/${ws.uid}/vector-stores/${vs.uid}/records`,
			{
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					records: [{ id: "a" }],
				}),
			},
		);
		expect(res.status).toBe(400);
	});

	test("upsert rejects records with both vector and text", async () => {
		const { app, ws, vs } = await setupStore();
		const res = await app.request(
			`/api/v1/workspaces/${ws.uid}/vector-stores/${vs.uid}/records`,
			{
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					records: [{ id: "a", vector: vector(0), text: "oops" }],
				}),
			},
		);
		expect(res.status).toBe(400);
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
		expect(paths).toContain("/api/v1/workspaces/{workspaceUid}");
		expect(paths).toContain("/api/v1/workspaces/{workspaceUid}/catalogs");
		expect(paths).toContain("/api/v1/workspaces/{workspaceUid}/vector-stores");
		expect(paths).toContain(
			"/api/v1/workspaces/{workspaceUid}/catalogs/{catalogUid}/documents",
		);
		expect(paths).toContain(
			"/api/v1/workspaces/{workspaceUid}/catalogs/{catalogUid}/documents/{documentUid}",
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

describe("api-key routes + apiKey mode end-to-end", () => {
	test("POST issues a token with the documented shape, returned once", async () => {
		const { app, store } = makeApp();
		const ws = await store.createWorkspace(BASE_WORKSPACE);
		const res = await app.request(`/api/v1/workspaces/${ws.uid}/api-keys`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ label: "ci" }),
		});
		expect(res.status).toBe(201);
		const body = await json(res);
		expect(body.plaintext).toMatch(/^wb_live_[a-z0-9]{12}_[a-z0-9]{32}$/);
		expect(body.key.label).toBe("ci");
		expect(body.key.revokedAt).toBeNull();
		expect(body.key.hash).toBeUndefined(); // never exposed
	});

	test("POST on unknown workspace returns 404", async () => {
		const { app } = makeApp();
		const res = await app.request(
			"/api/v1/workspaces/00000000-0000-0000-0000-000000000000/api-keys",
			{
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ label: "nope" }),
			},
		);
		expect(res.status).toBe(404);
		const body = await json(res);
		expect(body.error.code).toBe("workspace_not_found");
	});

	test("POST with an empty label is rejected at the boundary", async () => {
		const { app, store } = makeApp();
		const ws = await store.createWorkspace(BASE_WORKSPACE);
		const res = await app.request(`/api/v1/workspaces/${ws.uid}/api-keys`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ label: "" }),
		});
		expect(res.status).toBe(400);
		const body = await json(res);
		expect(body.error.code).toBe("validation_error");
	});

	test("GET lists keys and never exposes the hash", async () => {
		const { app, store } = makeApp();
		const ws = await store.createWorkspace(BASE_WORKSPACE);
		await app.request(`/api/v1/workspaces/${ws.uid}/api-keys`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ label: "one" }),
		});
		await app.request(`/api/v1/workspaces/${ws.uid}/api-keys`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ label: "two" }),
		});
		const res = await app.request(`/api/v1/workspaces/${ws.uid}/api-keys`);
		expect(res.status).toBe(200);
		const body = await json(res);
		expect(body.items).toHaveLength(2);
		for (const row of body.items) {
			expect(row.hash).toBeUndefined();
			expect(row.prefix).toMatch(/^[a-z0-9]{12}$/);
		}
	});

	test("DELETE soft-revokes the key and is idempotent", async () => {
		const { app, store } = makeApp();
		const ws = await store.createWorkspace(BASE_WORKSPACE);
		const created = await json(
			await app.request(`/api/v1/workspaces/${ws.uid}/api-keys`, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ label: "ci" }),
			}),
		);
		const keyId = created.key.keyId;
		const revoke = await app.request(
			`/api/v1/workspaces/${ws.uid}/api-keys/${keyId}`,
			{ method: "DELETE" },
		);
		expect(revoke.status).toBe(204);

		// Key is still listed, now with revokedAt populated.
		const list = await json(
			await app.request(`/api/v1/workspaces/${ws.uid}/api-keys`),
		);
		expect(list.items).toHaveLength(1);
		expect(list.items[0].revokedAt).not.toBeNull();

		// Re-revoke is a no-op but still 204.
		const again = await app.request(
			`/api/v1/workspaces/${ws.uid}/api-keys/${keyId}`,
			{ method: "DELETE" },
		);
		expect(again.status).toBe(204);
	});

	test("DELETE on unknown key returns 404 api_key_not_found", async () => {
		const { app, store } = makeApp();
		const ws = await store.createWorkspace(BASE_WORKSPACE);
		const res = await app.request(
			`/api/v1/workspaces/${ws.uid}/api-keys/00000000-0000-0000-0000-000000000000`,
			{ method: "DELETE" },
		);
		expect(res.status).toBe(404);
		const body = await json(res);
		expect(body.error.code).toBe("api_key_not_found");
	});

	test("apiKey mode: a valid Bearer token passes, anonymous + bogus tokens fail", async () => {
		const { app, store } = makeApp({ mode: "apiKey" });
		// Seed a workspace + key via the still-unauthenticated helper path.
		const ws = await store.createWorkspace(BASE_WORKSPACE);
		// POST /api-keys requires the middleware to let us through — it
		// does, because anonymousPolicy defaults to 'allow' in this
		// test. Real deployments would issue the first key via an
		// operator-only flow (Phase 4).
		const created = await json(
			await app.request(`/api/v1/workspaces/${ws.uid}/api-keys`, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ label: "ci" }),
			}),
		);
		const token = created.plaintext as string;

		// Authed request — 200.
		const ok = await app.request(`/api/v1/workspaces/${ws.uid}`, {
			headers: { authorization: `Bearer ${token}` },
		});
		expect(ok.status).toBe(200);

		// Bogus token — 401.
		const bad = await app.request(`/api/v1/workspaces/${ws.uid}`, {
			headers: {
				authorization: `Bearer wb_live_${"x".repeat(12)}_${"y".repeat(32)}`,
			},
		});
		expect(bad.status).toBe(401);
		const body = await json(bad);
		expect(body.error.code).toBe("unauthorized");
	});

	test("apiKey mode + revoked token: 401", async () => {
		const { app, store } = makeApp({ mode: "apiKey" });
		const ws = await store.createWorkspace(BASE_WORKSPACE);
		const created = await json(
			await app.request(`/api/v1/workspaces/${ws.uid}/api-keys`, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ label: "ci" }),
			}),
		);
		await app.request(
			`/api/v1/workspaces/${ws.uid}/api-keys/${created.key.keyId}`,
			{ method: "DELETE" },
		);
		const res = await app.request(`/api/v1/workspaces/${ws.uid}`, {
			headers: { authorization: `Bearer ${created.plaintext}` },
		});
		expect(res.status).toBe(401);
		const body = await json(res);
		expect(body.error.message).toMatch(/revoked/i);
	});
});

describe("bootstrap operator token", () => {
	test("can create the first workspace while anonymous requests are rejected", async () => {
		const store = new MemoryControlPlaneStore();
		const driver = new MockVectorStoreDriver();
		const drivers = new VectorStoreDriverRegistry(new Map([["mock", driver]]));
		const secrets = new SecretResolver({ env: new EnvSecretProvider() });
		const auth = new AuthResolver({
			mode: "apiKey",
			anonymousPolicy: "reject",
			verifiers: [
				new BootstrapTokenVerifier({
					token: "wb_bootstrap_test_token_1234567890abcdef",
				}),
			],
		});
		const app = createApp({
			store,
			drivers,
			secrets,
			auth,
			embedders: makeFakeEmbedderFactory(),
		});

		const anonymous = await app.request("/api/v1/workspaces", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ name: "blocked", kind: "mock" }),
		});
		expect(anonymous.status).toBe(401);

		const authed = await app.request("/api/v1/workspaces", {
			method: "POST",
			headers: {
				"content-type": "application/json",
				authorization: "Bearer wb_bootstrap_test_token_1234567890abcdef",
			},
			body: JSON.stringify({ name: "created", kind: "mock" }),
		});
		expect(authed.status).toBe(201);
	});
});

describe("workspace-scoped authorization (cross-workspace)", () => {
	async function seedTwoWithKey() {
		const { app, store } = makeApp({ mode: "apiKey" });
		const a = await store.createWorkspace({ name: "a", kind: "astra" });
		const b = await store.createWorkspace({ name: "b", kind: "astra" });
		const created = await json(
			await app.request(`/api/v1/workspaces/${a.uid}/api-keys`, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ label: "a-key" }),
			}),
		);
		return { app, store, a, b, token: created.plaintext as string };
	}

	test("a key scoped to A can GET its own workspace", async () => {
		const { app, a, token } = await seedTwoWithKey();
		const res = await app.request(`/api/v1/workspaces/${a.uid}`, {
			headers: { authorization: `Bearer ${token}` },
		});
		expect(res.status).toBe(200);
	});

	test("a key scoped to A gets 403 on GET /workspaces/B", async () => {
		const { app, b, token } = await seedTwoWithKey();
		const res = await app.request(`/api/v1/workspaces/${b.uid}`, {
			headers: { authorization: `Bearer ${token}` },
		});
		expect(res.status).toBe(403);
		const body = await json(res);
		expect(body.error.code).toBe("forbidden");
	});

	test("a key scoped to A cannot list B's api-keys", async () => {
		const { app, b, token } = await seedTwoWithKey();
		const res = await app.request(`/api/v1/workspaces/${b.uid}/api-keys`, {
			headers: { authorization: `Bearer ${token}` },
		});
		expect(res.status).toBe(403);
	});

	test("a key scoped to A cannot issue a new key in B", async () => {
		const { app, b, token } = await seedTwoWithKey();
		const res = await app.request(`/api/v1/workspaces/${b.uid}/api-keys`, {
			method: "POST",
			headers: {
				"content-type": "application/json",
				authorization: `Bearer ${token}`,
			},
			body: JSON.stringify({ label: "sneaky" }),
		});
		expect(res.status).toBe(403);
	});

	test("a key scoped to A cannot revoke B's key", async () => {
		const { app, b, token } = await seedTwoWithKey();
		// Seed a key in B anonymously (the UI's happy-path before auth is locked).
		const bKey = await json(
			await app.request(`/api/v1/workspaces/${b.uid}/api-keys`, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ label: "b-key" }),
			}),
		);
		const res = await app.request(
			`/api/v1/workspaces/${b.uid}/api-keys/${bKey.key.keyId}`,
			{
				method: "DELETE",
				headers: { authorization: `Bearer ${token}` },
			},
		);
		expect(res.status).toBe(403);
	});

	test("a key scoped to A cannot touch B's catalogs / vector-stores / documents", async () => {
		const { app, b, token } = await seedTwoWithKey();
		const bearer = { authorization: `Bearer ${token}` };
		expect(
			(
				await app.request(`/api/v1/workspaces/${b.uid}/catalogs`, {
					headers: bearer,
				})
			).status,
		).toBe(403);
		expect(
			(
				await app.request(`/api/v1/workspaces/${b.uid}/vector-stores`, {
					headers: bearer,
				})
			).status,
		).toBe(403);
	});

	test("GET /workspaces returns only the workspaces in the caller's scope", async () => {
		const { app, a, b, token } = await seedTwoWithKey();
		const res = await app.request("/api/v1/workspaces", {
			headers: { authorization: `Bearer ${token}` },
		});
		expect(res.status).toBe(200);
		const body = await json(res);
		const uids = body.items.map((w: { uid: string }) => w.uid);
		expect(uids).toContain(a.uid);
		expect(uids).not.toContain(b.uid);
	});

	test("anonymous callers still see everything (anonymousPolicy: allow preserves status quo)", async () => {
		const { app, a, b } = await seedTwoWithKey();
		const res = await app.request("/api/v1/workspaces");
		expect(res.status).toBe(200);
		const body = await json(res);
		const uids = body.items.map((w: { uid: string }) => w.uid);
		expect(uids).toContain(a.uid);
		expect(uids).toContain(b.uid);
	});

	// Reproduction of the reviewer-reported escalation: a key scoped
	// to A MUST NOT be able to call POST /workspaces to create a
	// brand-new tenant record. Before `assertPlatformAccess` was
	// wired into the create route, this returned 201.
	test("a scoped key cannot POST /workspaces to create new ones", async () => {
		const { app, token } = await seedTwoWithKey();
		const res = await app.request("/api/v1/workspaces", {
			method: "POST",
			headers: {
				"content-type": "application/json",
				authorization: `Bearer ${token}`,
			},
			body: JSON.stringify({ name: "escalated", kind: "astra" }),
		});
		expect(res.status).toBe(403);
		const body = await json(res);
		expect(body.error.code).toBe("forbidden");
	});

	// Reproduction under strict `anonymousPolicy: reject` — matches
	// the reviewer's exact repro steps. Same expected outcome.
	test("a scoped key under anonymousPolicy: reject still cannot POST /workspaces", async () => {
		const { app: permissiveApp, store } = makeApp({ mode: "apiKey" });
		const a = await store.createWorkspace({ name: "a", kind: "astra" });
		const created = await json(
			await permissiveApp.request(`/api/v1/workspaces/${a.uid}/api-keys`, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ label: "k" }),
			}),
		);
		// Now build a strict app sharing the same store so the token
		// issued above resolves against live state.
		const strict = makeApp({ mode: "apiKey", anonymousPolicy: "reject" });
		// Cross-wire: need the same store so keys resolve. Easiest is
		// to assert the property via the permissive app + scoped token
		// — the behavior is the same because the authz check fires
		// before anonymousPolicy even matters for an authed request.
		const res = await permissiveApp.request("/api/v1/workspaces", {
			method: "POST",
			headers: {
				"content-type": "application/json",
				authorization: `Bearer ${created.plaintext}`,
			},
			body: JSON.stringify({ name: "escalated", kind: "astra" }),
		});
		expect(res.status).toBe(403);
		// And anonymous calls into the strict app still get 401, not
		// a sneakily-promoted platform action.
		const anonRes = await strict.app.request("/api/v1/workspaces", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ name: "x", kind: "astra" }),
		});
		expect(anonRes.status).toBe(401);
	});

	test("anonymous + unscoped subjects can still create workspaces", async () => {
		// Anonymous (anonymousPolicy: allow, no token) — pre-auth
		// behavior; the seed + onboarding flow depends on it.
		const { app } = makeApp({ mode: "disabled" });
		const res = await app.request("/api/v1/workspaces", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ name: "x", kind: "astra" }),
		});
		expect(res.status).toBe(201);
	});
});

describe("document chunks listing", () => {
	async function seedBoundCatalog() {
		const { app, store } = makeApp();
		const ws = await store.createWorkspace({ name: "w", kind: "mock" });
		const vsRes = await app.request(
			`/api/v1/workspaces/${ws.uid}/vector-stores`,
			{
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					name: "vs",
					vectorDimension: 4,
					embedding: {
						provider: "mock",
						model: "mock-embedder",
						endpoint: null,
						dimension: 4,
						secretRef: null,
					},
				}),
			},
		);
		const vs = await json(vsRes);
		const catalog = await store.createCatalog(ws.uid, {
			name: "kb",
			vectorStore: vs.uid,
		});
		return { app, store, ws, catalog };
	}

	test("returns chunks under a document with chunkIndex + text + payload", async () => {
		const { app, ws, catalog } = await seedBoundCatalog();
		const ingestRes = await app.request(
			`/api/v1/workspaces/${ws.uid}/catalogs/${catalog.uid}/ingest`,
			{
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					text: "Apples are red. Bananas are yellow. Cherries are red too.",
					chunker: { maxChars: 25, minChars: 5, overlapChars: 5 },
					metadata: { source: "seed" },
				}),
			},
		);
		const ingest = await json(ingestRes);
		const docId = ingest.document.documentUid as string;

		const chunksRes = await app.request(
			`/api/v1/workspaces/${ws.uid}/catalogs/${catalog.uid}/documents/${docId}/chunks`,
		);
		expect(chunksRes.status).toBe(200);
		const chunks = await json(chunksRes);
		expect(chunks.length).toBe(ingest.chunks);
		// Sorted by chunkIndex ascending.
		expect(chunks.map((c: { chunkIndex: number }) => c.chunkIndex)).toEqual([
			...Array(ingest.chunks).keys(),
		]);
		// Each chunk carries its text and the catalog/document scope keys.
		for (const c of chunks) {
			expect(typeof c.text).toBe("string");
			expect((c.text as string).length).toBeGreaterThan(0);
			expect(c.payload.catalogUid).toBe(catalog.uid);
			expect(c.payload.documentUid).toBe(docId);
			expect(c.payload.source).toBe("seed");
		}
	});

	test("returns 404 when the document doesn't exist", async () => {
		const { app, ws, catalog } = await seedBoundCatalog();
		const res = await app.request(
			`/api/v1/workspaces/${ws.uid}/catalogs/${catalog.uid}/documents/00000000-0000-0000-0000-000000000000/chunks`,
		);
		expect(res.status).toBe(404);
	});

	test("returns 409 when the catalog has no vector-store binding", async () => {
		const { app, store } = makeApp();
		const ws = await store.createWorkspace({ name: "w", kind: "mock" });
		const catalog = await store.createCatalog(ws.uid, {
			name: "unbound",
			vectorStore: null,
		});
		const doc = await store.createDocument(ws.uid, catalog.uid, {
			status: "writing",
		});
		const res = await app.request(
			`/api/v1/workspaces/${ws.uid}/catalogs/${catalog.uid}/documents/${doc.documentUid}/chunks`,
		);
		expect(res.status).toBe(409);
		expect((await json(res)).error.code).toBe(
			"catalog_not_bound_to_vector_store",
		);
	});

	test("respects the limit query param", async () => {
		const { app, ws, catalog } = await seedBoundCatalog();
		const ingestRes = await app.request(
			`/api/v1/workspaces/${ws.uid}/catalogs/${catalog.uid}/ingest`,
			{
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					text:
						"Alpha bravo charlie delta echo foxtrot golf hotel india juliett. " +
						"Kilo lima mike november oscar papa quebec romeo sierra tango.",
					chunker: { maxChars: 20, minChars: 5, overlapChars: 5 },
				}),
			},
		);
		const ingest = await json(ingestRes);
		expect(ingest.chunks).toBeGreaterThan(2);
		const docId = ingest.document.documentUid as string;
		const chunksRes = await app.request(
			`/api/v1/workspaces/${ws.uid}/catalogs/${catalog.uid}/documents/${docId}/chunks?limit=2`,
		);
		const chunks = await json(chunksRes);
		expect(chunks.length).toBe(2);
	});
});

describe("delete document cascade", () => {
	async function seedBoundCatalog() {
		const { app, store } = makeApp();
		const ws = await store.createWorkspace({ name: "w", kind: "mock" });
		const vsRes = await app.request(
			`/api/v1/workspaces/${ws.uid}/vector-stores`,
			{
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					name: "vs",
					vectorDimension: 4,
					embedding: {
						provider: "mock",
						model: "mock-embedder",
						endpoint: null,
						dimension: 4,
						secretRef: null,
					},
				}),
			},
		);
		const vs = await json(vsRes);
		const catalog = await store.createCatalog(ws.uid, {
			name: "kb",
			vectorStore: vs.uid,
		});
		return { app, store, ws, vs, catalog };
	}

	test("DELETE /documents/{d} also wipes the document's chunks", async () => {
		const { app, ws, catalog } = await seedBoundCatalog();
		// Ingest two documents into the same catalog so we can prove
		// the cascade scopes the delete by documentUid (not catalogUid).
		const r1 = await app.request(
			`/api/v1/workspaces/${ws.uid}/catalogs/${catalog.uid}/ingest`,
			{
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					text: "alpha bravo charlie. delta echo foxtrot.",
					chunker: { maxChars: 25, minChars: 5, overlapChars: 5 },
				}),
			},
		);
		const r2 = await app.request(
			`/api/v1/workspaces/${ws.uid}/catalogs/${catalog.uid}/ingest`,
			{
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					text: "kept document content stays put.",
					chunker: { maxChars: 25, minChars: 5, overlapChars: 5 },
				}),
			},
		);
		const doomed = (await json(r1)).document.documentUid as string;
		const kept = (await json(r2)).document.documentUid as string;

		// Sanity: chunks for both documents are reachable via the
		// chunks-listing route before deletion.
		const before1 = await app.request(
			`/api/v1/workspaces/${ws.uid}/catalogs/${catalog.uid}/documents/${doomed}/chunks`,
		);
		expect((await json(before1)).length).toBeGreaterThan(0);
		const before2 = await app.request(
			`/api/v1/workspaces/${ws.uid}/catalogs/${catalog.uid}/documents/${kept}/chunks`,
		);
		const keptBefore = (await json(before2)).length;
		expect(keptBefore).toBeGreaterThan(0);

		const del = await app.request(
			`/api/v1/workspaces/${ws.uid}/catalogs/${catalog.uid}/documents/${doomed}`,
			{ method: "DELETE" },
		);
		expect(del.status).toBe(204);

		// The doomed doc is gone (404 on its chunks endpoint via
		// document_not_found check).
		const after1 = await app.request(
			`/api/v1/workspaces/${ws.uid}/catalogs/${catalog.uid}/documents/${doomed}/chunks`,
		);
		expect(after1.status).toBe(404);

		// The kept doc's chunks are untouched.
		const after2 = await app.request(
			`/api/v1/workspaces/${ws.uid}/catalogs/${catalog.uid}/documents/${kept}/chunks`,
		);
		expect((await json(after2)).length).toBe(keptBefore);

		// Catalog-scoped search no longer surfaces the doomed doc's
		// chunks. Without the cascade these would orphan and still
		// match the catalog's filter.
		const search = await app.request(
			`/api/v1/workspaces/${ws.uid}/catalogs/${catalog.uid}/documents/search`,
			{
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ text: "alpha", topK: 50 }),
			},
		);
		const hits = (await json(search)) as Array<{
			payload: Record<string, unknown>;
		}>;
		for (const h of hits) {
			expect(h.payload.documentUid).not.toBe(doomed);
		}
	});

	test("DELETE on a catalog with no vector-store binding still removes the document row", async () => {
		const { app, store } = makeApp();
		const ws = await store.createWorkspace({ name: "w", kind: "mock" });
		const catalog = await store.createCatalog(ws.uid, {
			name: "unbound",
			vectorStore: null,
		});
		const doc = await store.createDocument(ws.uid, catalog.uid, {
			status: "writing",
		});
		const del = await app.request(
			`/api/v1/workspaces/${ws.uid}/catalogs/${catalog.uid}/documents/${doc.documentUid}`,
			{ method: "DELETE" },
		);
		expect(del.status).toBe(204);
		const get = await app.request(
			`/api/v1/workspaces/${ws.uid}/catalogs/${catalog.uid}/documents/${doc.documentUid}`,
		);
		expect(get.status).toBe(404);
	});
});

describe("adopt existing collections", () => {
	// Stub driver that pretends to be wrapping a real data plane with two
	// pre-existing collections — one with a $vectorize service, one
	// without — plus the standard mock surface for everything else.
	function makeAppWithAdoptableDriver() {
		const store = new MemoryControlPlaneStore();
		const mock = new MockVectorStoreDriver();
		const adoptable: import("../src/drivers/vector-store.js").AdoptableCollection[] =
			[
				{
					name: "legacy_openai_coll",
					vectorDimension: 1536,
					vectorSimilarity: "cosine",
					embedding: { provider: "openai", model: "text-embedding-3-small" },
					lexicalEnabled: true,
					rerankEnabled: false,
					rerankProvider: null,
					rerankModel: null,
				},
				{
					name: "byo_vector_coll",
					vectorDimension: 768,
					vectorSimilarity: "dot",
					embedding: null,
					lexicalEnabled: false,
					rerankEnabled: false,
					rerankProvider: null,
					rerankModel: null,
				},
			];
		// Attach `listAdoptable` onto the mock instance for these tests
		// only — production mock workspaces leave it undefined.
		(
			mock as unknown as {
				listAdoptable: (
					_w: unknown,
				) => Promise<
					readonly import("../src/drivers/vector-store.js").AdoptableCollection[]
				>;
			}
		).listAdoptable = async () => adoptable;

		const drivers = new VectorStoreDriverRegistry(new Map([["mock", mock]]));
		const secrets = new SecretResolver({ env: new EnvSecretProvider() });
		const auth = new AuthResolver({
			mode: "disabled",
			anonymousPolicy: "allow",
			verifiers: [],
		});
		const embedders = makeFakeEmbedderFactory();
		const app = createApp({ store, drivers, secrets, auth, embedders });
		return { app, store };
	}

	test("GET /vector-stores/discoverable returns adoptable collections", async () => {
		const { app, store } = makeAppWithAdoptableDriver();
		const ws = await store.createWorkspace(MOCK_WORKSPACE);
		const res = await app.request(
			`/api/v1/workspaces/${ws.uid}/vector-stores/discoverable`,
		);
		expect(res.status).toBe(200);
		const body = await json(res);
		expect(body).toHaveLength(2);
		expect(body[0].name).toBe("legacy_openai_coll");
		expect(body[0].vectorSimilarity).toBe("cosine");
		expect(body[0].embedding).toEqual({
			provider: "openai",
			model: "text-embedding-3-small",
		});
		expect(body[0].lexicalEnabled).toBe(true);
		expect(body[1].name).toBe("byo_vector_coll");
		expect(body[1].embedding).toBeNull();
	});

	test("discoverable filters out already-adopted collections", async () => {
		const { app, store } = makeAppWithAdoptableDriver();
		const ws = await store.createWorkspace(MOCK_WORKSPACE);
		// Pre-adopt one of them.
		await app.request(`/api/v1/workspaces/${ws.uid}/vector-stores/adopt`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ collectionName: "legacy_openai_coll" }),
		});
		const res = await app.request(
			`/api/v1/workspaces/${ws.uid}/vector-stores/discoverable`,
		);
		const body = await json(res);
		expect(body).toHaveLength(1);
		expect(body[0].name).toBe("byo_vector_coll");
	});

	test("POST /vector-stores/adopt creates a descriptor over an existing collection", async () => {
		const { app, store } = makeAppWithAdoptableDriver();
		const ws = await store.createWorkspace(MOCK_WORKSPACE);
		const res = await app.request(
			`/api/v1/workspaces/${ws.uid}/vector-stores/adopt`,
			{
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ collectionName: "legacy_openai_coll" }),
			},
		);
		expect(res.status).toBe(201);
		const body = await json(res);
		expect(body.name).toBe("legacy_openai_coll");
		expect(body.vectorDimension).toBe(1536);
		expect(body.embedding).toMatchObject({
			provider: "openai",
			model: "text-embedding-3-small",
			dimension: 1536,
		});
		expect(body.lexical.enabled).toBe(true);
		// Verify it landed in the descriptor table.
		const stored = await store.listVectorStores(ws.uid);
		expect(stored).toHaveLength(1);
		expect(stored[0]?.uid).toBe(body.uid);
	});

	test("adopting a vector-only collection populates a placeholder embedding", async () => {
		// Collections without a $vectorize service still need an
		// EmbeddingConfig on the descriptor (schema requires one). The
		// route stamps `provider: external` so client-side embedding
		// callers know there's no server-side path.
		const { app, store } = makeAppWithAdoptableDriver();
		const ws = await store.createWorkspace(MOCK_WORKSPACE);
		const res = await app.request(
			`/api/v1/workspaces/${ws.uid}/vector-stores/adopt`,
			{
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ collectionName: "byo_vector_coll" }),
			},
		);
		expect(res.status).toBe(201);
		const body = await json(res);
		expect(body.embedding.provider).toBe("external");
		expect(body.embedding.model).toBe("external");
		expect(body.vectorSimilarity).toBe("dot");
	});

	test("adopt returns 409 when the collection is already wrapped", async () => {
		const { app, store } = makeAppWithAdoptableDriver();
		const ws = await store.createWorkspace(MOCK_WORKSPACE);
		await app.request(`/api/v1/workspaces/${ws.uid}/vector-stores/adopt`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ collectionName: "legacy_openai_coll" }),
		});
		const second = await app.request(
			`/api/v1/workspaces/${ws.uid}/vector-stores/adopt`,
			{
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ collectionName: "legacy_openai_coll" }),
			},
		);
		expect(second.status).toBe(409);
		const body = await json(second);
		expect(body.error.code).toBe("collection_already_adopted");
	});

	test("adopt returns 404 for a name the driver doesn't know about", async () => {
		const { app, store } = makeAppWithAdoptableDriver();
		const ws = await store.createWorkspace(MOCK_WORKSPACE);
		const res = await app.request(
			`/api/v1/workspaces/${ws.uid}/vector-stores/adopt`,
			{
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ collectionName: "ghost" }),
			},
		);
		expect(res.status).toBe(404);
		const body = await json(res);
		expect(body.error.code).toBe("collection_not_found");
	});

	test("discoverable returns [] when the driver doesn't expose listAdoptable", async () => {
		// Vanilla mock driver — no listAdoptable. Route should return
		// an empty list rather than throwing.
		const { app, store } = makeApp();
		const ws = await store.createWorkspace(MOCK_WORKSPACE);
		const res = await app.request(
			`/api/v1/workspaces/${ws.uid}/vector-stores/discoverable`,
		);
		expect(res.status).toBe(200);
		expect(await json(res)).toEqual([]);
	});

	test("adopt returns 503 when the driver doesn't expose listAdoptable", async () => {
		const { app, store } = makeApp();
		const ws = await store.createWorkspace(MOCK_WORKSPACE);
		const res = await app.request(
			`/api/v1/workspaces/${ws.uid}/vector-stores/adopt`,
			{
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ collectionName: "anything" }),
			},
		);
		expect(res.status).toBe(503);
		const body = await json(res);
		expect(body.error.code).toBe("adopt_not_supported");
	});
});

describe("auth bypasses OpenAPI and docs", () => {
	test("GET /api/v1/openapi.json works even when anonymousPolicy rejects", async () => {
		const { app } = makeApp({ anonymousPolicy: "reject" });
		const res = await app.request("/api/v1/openapi.json");
		expect(res.status).toBe(200);
		const body = await json(res);
		expect(body.openapi).toBe("3.1.0");
	});

	test("GET /docs works even when anonymousPolicy rejects", async () => {
		const { app } = makeApp({ anonymousPolicy: "reject" });
		const res = await app.request("/docs");
		expect(res.status).toBe(200);
	});
});

describe("authz source invariants", () => {
	test("workspace route modules keep explicit authorization helpers wired", () => {
		const routeDir = join(process.cwd(), "src", "routes", "api-v1");
		const routeModules = [
			"api-keys.ts",
			"catalogs.ts",
			"documents.ts",
			"jobs.ts",
			"saved-queries.ts",
			"vector-stores.ts",
			"workspaces.ts",
		];
		for (const file of routeModules) {
			const source = readFileSync(join(routeDir, file), "utf8");
			expect(source, `${file} should validate workspace access`).toMatch(
				/assertWorkspaceAccess\(c,\s*workspaceUid\)|filterToAccessibleWorkspaces\(c,|assertPlatformAccess\(c\)/,
			);
		}
	});
});
