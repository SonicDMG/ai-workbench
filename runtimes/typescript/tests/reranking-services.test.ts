/**
 * Route-level coverage for `/api/v1/workspaces/{w}/reranking-services`.
 * Mirrors the patterns used for the other workspace-scoped service
 * surfaces (chunking / embedding / llm) — happy path plus the
 * conflict / not-found branches that the route layer guards.
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
	return (await json(res)).workspaceId;
}

async function createRerankingService(
	app: AppHandle,
	ws: string,
	overrides: Record<string, unknown> = {},
): Promise<string> {
	const res = await app.request(`/api/v1/workspaces/${ws}/reranking-services`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({
			name: "default-rerank",
			provider: "cohere",
			modelName: "rerank-3",
			...overrides,
		}),
	});
	expect(res.status, await res.clone().text()).toBe(201);
	return (await json(res)).rerankingServiceId;
}

describe("reranking-services routes", () => {
	test("POST → GET round-trip returns the same record", async () => {
		const app = makeApp();
		const ws = await createWorkspace(app);
		const id = await createRerankingService(app, ws);

		const get = await app.request(
			`/api/v1/workspaces/${ws}/reranking-services/${id}`,
		);
		expect(get.status).toBe(200);
		const body = await json(get);
		expect(body.rerankingServiceId).toBe(id);
		expect(body.provider).toBe("cohere");
		expect(body.modelName).toBe("rerank-3");
	});

	test("GET list pages results", async () => {
		const app = makeApp();
		const ws = await createWorkspace(app);
		await createRerankingService(app, ws, { name: "a" });
		await createRerankingService(app, ws, { name: "b" });

		const list = await app.request(
			`/api/v1/workspaces/${ws}/reranking-services`,
		);
		expect(list.status).toBe(200);
		const body = await json(list);
		expect(body.items.length).toBeGreaterThanOrEqual(2);
		expect(body.nextCursor).toBeDefined();
	});

	test("GET on a missing service is a 404", async () => {
		const app = makeApp();
		const ws = await createWorkspace(app);
		const res = await app.request(
			`/api/v1/workspaces/${ws}/reranking-services/00000000-0000-0000-0000-000000000000`,
		);
		expect(res.status).toBe(404);
		const body = await json(res);
		expect(body.error.code).toBe("reranking_service_not_found");
	});

	test("POST with a duplicate explicit id is a 409", async () => {
		const app = makeApp();
		const ws = await createWorkspace(app);
		const id = randomUUID();
		const first = await app.request(
			`/api/v1/workspaces/${ws}/reranking-services`,
			{
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					rerankingServiceId: id,
					name: "first",
					provider: "cohere",
					modelName: "rerank-3",
				}),
			},
		);
		expect(first.status).toBe(201);

		const dup = await app.request(
			`/api/v1/workspaces/${ws}/reranking-services`,
			{
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					rerankingServiceId: id,
					name: "second",
					provider: "cohere",
					modelName: "rerank-3",
				}),
			},
		);
		expect(dup.status).toBe(409);
	});

	test("PATCH updates mutable fields", async () => {
		const app = makeApp();
		const ws = await createWorkspace(app);
		const id = await createRerankingService(app, ws);

		const patch = await app.request(
			`/api/v1/workspaces/${ws}/reranking-services/${id}`,
			{
				method: "PATCH",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					description: "updated",
					maxCandidates: 50,
				}),
			},
		);
		expect(patch.status).toBe(200);
		const body = await json(patch);
		expect(body.description).toBe("updated");
		expect(body.maxCandidates).toBe(50);
	});

	test("DELETE removes the service; subsequent GET is 404", async () => {
		const app = makeApp();
		const ws = await createWorkspace(app);
		const id = await createRerankingService(app, ws);

		const del = await app.request(
			`/api/v1/workspaces/${ws}/reranking-services/${id}`,
			{ method: "DELETE" },
		);
		expect(del.status).toBe(204);

		const get = await app.request(
			`/api/v1/workspaces/${ws}/reranking-services/${id}`,
		);
		expect(get.status).toBe(404);
	});

	test("DELETE on a missing service is a 404", async () => {
		const app = makeApp();
		const ws = await createWorkspace(app);
		const res = await app.request(
			`/api/v1/workspaces/${ws}/reranking-services/00000000-0000-0000-0000-000000000000`,
			{ method: "DELETE" },
		);
		expect(res.status).toBe(404);
	});

	test("POST rejects an SSRF-class endpointBaseUrl", async () => {
		const app = makeApp();
		const ws = await createWorkspace(app);
		const res = await app.request(
			`/api/v1/workspaces/${ws}/reranking-services`,
			{
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					name: "ssrf",
					provider: "cohere",
					modelName: "rerank-3",
					endpointBaseUrl: "http://169.254.169.254/",
				}),
			},
		);
		expect(res.status).toBe(400);
	});
});
