/**
 * Route-level coverage for `/api/v1/workspaces/{w}/llm-services`.
 * Mirrors the patterns used for the other workspace-scoped service
 * surfaces (chunking / embedding / reranking) — happy path plus the
 * conflict / not-found branches that the route layer guards.
 */

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

async function createLlmService(
	app: AppHandle,
	ws: string,
	overrides: Record<string, unknown> = {},
): Promise<string> {
	const res = await app.request(`/api/v1/workspaces/${ws}/llm-services`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({
			name: "default-llm",
			provider: "huggingface",
			modelName: "mistralai/Mistral-7B-Instruct-v0.3",
			...overrides,
		}),
	});
	expect(res.status).toBe(201);
	return (await json(res)).llmServiceId;
}

describe("llm-services routes", () => {
	test("POST → GET round-trip returns the same record", async () => {
		const app = makeApp();
		const ws = await createWorkspace(app);
		const id = await createLlmService(app, ws);

		const get = await app.request(
			`/api/v1/workspaces/${ws}/llm-services/${id}`,
		);
		expect(get.status).toBe(200);
		const body = await json(get);
		expect(body.llmServiceId).toBe(id);
		expect(body.provider).toBe("huggingface");
		expect(body.modelName).toBe("mistralai/Mistral-7B-Instruct-v0.3");
	});

	test("GET list pages results", async () => {
		const app = makeApp();
		const ws = await createWorkspace(app);
		await createLlmService(app, ws, { name: "a" });
		await createLlmService(app, ws, { name: "b" });

		const list = await app.request(`/api/v1/workspaces/${ws}/llm-services`);
		expect(list.status).toBe(200);
		const body = await json(list);
		expect(body.items.length).toBeGreaterThanOrEqual(2);
		expect(body.nextCursor).toBeDefined();
	});

	test("GET on a missing service is a 404", async () => {
		const app = makeApp();
		const ws = await createWorkspace(app);
		const res = await app.request(
			`/api/v1/workspaces/${ws}/llm-services/00000000-0000-0000-0000-000000000000`,
		);
		expect(res.status).toBe(404);
		const body = await json(res);
		expect(body.error.code).toBe("llm_service_not_found");
	});

	test("POST with a duplicate explicit id is a 409", async () => {
		const app = makeApp();
		const ws = await createWorkspace(app);
		const { randomUUID } = await import("node:crypto");
		const id = randomUUID();
		const first = await app.request(`/api/v1/workspaces/${ws}/llm-services`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				llmServiceId: id,
				name: "first",
				provider: "huggingface",
				modelName: "m",
			}),
		});
		expect(first.status).toBe(201);

		const dup = await app.request(`/api/v1/workspaces/${ws}/llm-services`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				llmServiceId: id,
				name: "second",
				provider: "huggingface",
				modelName: "m",
			}),
		});
		expect(dup.status).toBe(409);
	});

	test("PATCH updates mutable fields", async () => {
		const app = makeApp();
		const ws = await createWorkspace(app);
		const id = await createLlmService(app, ws);

		const patch = await app.request(
			`/api/v1/workspaces/${ws}/llm-services/${id}`,
			{
				method: "PATCH",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					description: "rename me",
					maxOutputTokens: 2048,
				}),
			},
		);
		expect(patch.status).toBe(200);
		const body = await json(patch);
		expect(body.description).toBe("rename me");
		expect(body.maxOutputTokens).toBe(2048);
	});

	test("DELETE removes the service; subsequent GET is 404", async () => {
		const app = makeApp();
		const ws = await createWorkspace(app);
		const id = await createLlmService(app, ws);

		const del = await app.request(
			`/api/v1/workspaces/${ws}/llm-services/${id}`,
			{ method: "DELETE" },
		);
		expect(del.status).toBe(204);

		const get = await app.request(
			`/api/v1/workspaces/${ws}/llm-services/${id}`,
		);
		expect(get.status).toBe(404);
	});

	test("DELETE on a missing service is a 404", async () => {
		const app = makeApp();
		const ws = await createWorkspace(app);
		const res = await app.request(
			`/api/v1/workspaces/${ws}/llm-services/00000000-0000-0000-0000-000000000000`,
			{ method: "DELETE" },
		);
		expect(res.status).toBe(404);
	});

	test("DELETE refuses with 409 when an agent still references the service", async () => {
		const app = makeApp();
		const ws = await createWorkspace(app);
		const id = await createLlmService(app, ws);

		const agent = await app.request(`/api/v1/workspaces/${ws}/agents`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ name: "bound-agent", llmServiceId: id }),
		});
		expect(agent.status).toBe(201);

		const del = await app.request(
			`/api/v1/workspaces/${ws}/llm-services/${id}`,
			{ method: "DELETE" },
		);
		expect(del.status).toBe(409);
	});

	test("agent create rejects an llmServiceId that doesn't exist", async () => {
		const app = makeApp();
		const ws = await createWorkspace(app);
		const res = await app.request(`/api/v1/workspaces/${ws}/agents`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				name: "broken-agent",
				llmServiceId: "00000000-0000-0000-0000-000000000000",
			}),
		});
		expect(res.status).toBe(404);
	});
});
