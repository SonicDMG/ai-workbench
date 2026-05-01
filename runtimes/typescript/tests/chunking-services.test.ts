/**
 * Route-level coverage for `/api/v1/workspaces/{w}/chunking-services`.
 *
 * `knowledge-bases.test.ts` exercises chunking-service creation as a
 * setup step for KB tests, but doesn't drive the route's own CRUD
 * surface or its delete-while-referenced 409. This file fills both
 * gaps. Mirrors `llm-services.test.ts` patterns.
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

function makeApp(): ReturnType<typeof createApp> {
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

type AppHandle = ReturnType<typeof makeApp>;

async function createWorkspace(app: AppHandle): Promise<string> {
	const res = await app.request("/api/v1/workspaces", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ name: "ws", kind: "mock" }),
	});
	expect(res.status).toBe(201);
	return (await json(res)).workspaceId as string;
}

async function createChunker(
	app: AppHandle,
	ws: string,
	overrides: Record<string, unknown> = {},
): Promise<string> {
	const res = await app.request(`/api/v1/workspaces/${ws}/chunking-services`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({
			name: `chunker-${Math.random().toString(36).slice(2)}`,
			engine: "docling",
			...overrides,
		}),
	});
	expect(res.status, await res.clone().text()).toBe(201);
	return (await json(res)).chunkingServiceId as string;
}

describe("chunking-services routes", () => {
	test("POST → GET round-trip preserves the record", async () => {
		const app = makeApp();
		const ws = await createWorkspace(app);
		const id = await createChunker(app, ws, {
			name: "docling-default",
			engine: "docling",
			strategy: "recursive",
			maxChunkSize: 1024,
			minChunkSize: 64,
			chunkUnit: "chars",
			overlapSize: 128,
		});

		const get = await app.request(
			`/api/v1/workspaces/${ws}/chunking-services/${id}`,
		);
		expect(get.status).toBe(200);
		const body = await json(get);
		expect(body.chunkingServiceId).toBe(id);
		expect(body.workspaceId).toBe(ws);
		expect(body.name).toBe("docling-default");
		expect(body.engine).toBe("docling");
		expect(body.strategy).toBe("recursive");
		expect(body.maxChunkSize).toBe(1024);
		expect(body.minChunkSize).toBe(64);
		expect(body.overlapSize).toBe(128);
	});

	test("GET list paginates over the seeded chunkers + new rows", async () => {
		const app = makeApp();
		const ws = await createWorkspace(app);

		// Workspace POST auto-seeds one or more default chunkers.
		const baseline = await json(
			await app.request(`/api/v1/workspaces/${ws}/chunking-services`),
		);
		const baselineCount = baseline.items.length;
		expect(baselineCount).toBeGreaterThan(0);

		await createChunker(app, ws, { name: "a", engine: "docling" });
		await createChunker(app, ws, { name: "b", engine: "docling" });

		const list = await app.request(
			`/api/v1/workspaces/${ws}/chunking-services`,
		);
		expect(list.status).toBe(200);
		const page = await json(list);
		expect(page.items.length).toBe(baselineCount + 2);
	});

	test("PATCH mutates fields and returns updated record", async () => {
		const app = makeApp();
		const ws = await createWorkspace(app);
		const id = await createChunker(app, ws, { name: "before" });

		const patch = await app.request(
			`/api/v1/workspaces/${ws}/chunking-services/${id}`,
			{
				method: "PATCH",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					name: "after",
					maxChunkSize: 2048,
					strategy: "line",
				}),
			},
		);
		expect(patch.status).toBe(200);
		const body = await json(patch);
		expect(body.name).toBe("after");
		expect(body.maxChunkSize).toBe(2048);
		expect(body.strategy).toBe("line");
	});

	test("DELETE on existing service returns 204", async () => {
		const app = makeApp();
		const ws = await createWorkspace(app);
		const id = await createChunker(app, ws);

		const del = await app.request(
			`/api/v1/workspaces/${ws}/chunking-services/${id}`,
			{ method: "DELETE" },
		);
		expect(del.status).toBe(204);

		const after = await app.request(
			`/api/v1/workspaces/${ws}/chunking-services/${id}`,
		);
		expect(after.status).toBe(404);
	});

	test("DELETE while a KB still references the chunker returns 409", async () => {
		const app = makeApp();
		const ws = await createWorkspace(app);

		// Stand up the minimum services a KB needs.
		const chunkerId = await createChunker(app, ws);
		const embRes = await app.request(
			`/api/v1/workspaces/${ws}/embedding-services`,
			{
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					name: "openai-3-small",
					provider: "openai",
					modelName: "text-embedding-3-small",
					embeddingDimension: 1536,
				}),
			},
		);
		expect(embRes.status, await embRes.clone().text()).toBe(201);
		const embId = (await json(embRes)).embeddingServiceId;

		const kbRes = await app.request(
			`/api/v1/workspaces/${ws}/knowledge-bases`,
			{
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					name: "products",
					embeddingServiceId: embId,
					chunkingServiceId: chunkerId,
				}),
			},
		);
		expect(kbRes.status, await kbRes.clone().text()).toBe(201);

		const del = await app.request(
			`/api/v1/workspaces/${ws}/chunking-services/${chunkerId}`,
			{ method: "DELETE" },
		);
		expect(del.status).toBe(409);
		const body = await json(del);
		expect(body.error.code).toBe("chunking_service_in_use");
		expect(body.error.message).toMatch(/knowledge[_ ]base|in use|referenc/i);
	});

	test("GET unknown chunkingServiceId returns 404", async () => {
		const app = makeApp();
		const ws = await createWorkspace(app);
		const res = await app.request(
			`/api/v1/workspaces/${ws}/chunking-services/${randomUUID()}`,
		);
		expect(res.status).toBe(404);
	});

	test("DELETE unknown chunkingServiceId returns 404", async () => {
		const app = makeApp();
		const ws = await createWorkspace(app);
		const res = await app.request(
			`/api/v1/workspaces/${ws}/chunking-services/${randomUUID()}`,
			{ method: "DELETE" },
		);
		expect(res.status).toBe(404);
	});

	test("POST rejects missing required fields with 400", async () => {
		const app = makeApp();
		const ws = await createWorkspace(app);
		const res = await app.request(
			`/api/v1/workspaces/${ws}/chunking-services`,
			{
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ name: "" /* missing engine, empty name */ }),
			},
		);
		expect(res.status).toBe(400);
	});

	test("POST honors caller-supplied chunkingServiceId; duplicate returns 409", async () => {
		const app = makeApp();
		const ws = await createWorkspace(app);
		const supplied = randomUUID();

		const a = await app.request(`/api/v1/workspaces/${ws}/chunking-services`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				chunkingServiceId: supplied,
				name: "first",
				engine: "docling",
			}),
		});
		expect(a.status).toBe(201);
		expect((await json(a)).chunkingServiceId).toBe(supplied);

		const b = await app.request(`/api/v1/workspaces/${ws}/chunking-services`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				chunkingServiceId: supplied,
				name: "second",
				engine: "docling",
			}),
		});
		expect(b.status).toBe(409);
	});
});
