/**
 * Route-level coverage for `/api/v1/workspaces/{w}/llm-services`.
 * Mirrors the patterns used for the other workspace-scoped service
 * surfaces (chunking / embedding / reranking) — happy path plus the
 * conflict / not-found branches that the route layer guards.
 */

import { describe, expect, test, vi } from "vitest";
import { createApp } from "../src/app.js";
import { AuthResolver } from "../src/auth/resolver.js";
import type { ChatModelProbe } from "../src/chat/model-probe.js";
import { MemoryControlPlaneStore } from "../src/control-plane/memory/store.js";
import { MockVectorStoreDriver } from "../src/drivers/mock/store.js";
import { VectorStoreDriverRegistry } from "../src/drivers/registry.js";
import { RoutePluginRegistry } from "../src/plugins/registry.js";
import { llmServiceRoutes } from "../src/routes/api-v1/llm-services.js";
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

/**
 * Config-time chat-model probe (issue: "<model> is not a chat model").
 *
 * The route runs a fail-open HuggingFace probe before persisting so a
 * non-chat model is rejected at create/update with a clear 422 instead
 * of surfacing as a cryptic send-time error later. These tests inject a
 * fake probe + a resolvable credential so the gate is exercised without
 * touching the network.
 */
describe("llm-services config-time chat-model probe", () => {
	function makeProbeApp(probe: ChatModelProbe): {
		app: ReturnType<typeof createApp>;
		store: MemoryControlPlaneStore;
	} {
		const store = new MemoryControlPlaneStore();
		const driver = new MockVectorStoreDriver();
		const drivers = new VectorStoreDriverRegistry(new Map([["mock", driver]]));
		// A bespoke `test:` provider so a service `credentialRef: "test:hf"`
		// resolves to a token and the probe actually fires.
		const secrets = new SecretResolver({
			test: { resolve: async () => "fake-token" },
		});
		const auth = new AuthResolver({
			mode: "disabled",
			anonymousPolicy: "allow",
			verifiers: [],
		});
		const embedders = makeFakeEmbedderFactory();
		const registry = new RoutePluginRegistry();
		registry.register({
			id: "llm_services",
			mountPath: "/api/v1/workspaces",
			build: () =>
				llmServiceRoutes({
					store,
					secrets,
					chatConfig: null,
					probeChatModel: probe,
				}),
		});
		const app = createApp({
			store,
			drivers,
			secrets,
			auth,
			embedders,
			routePlugins: registry,
		});
		return { app, store };
	}

	test("POST rejects a model the probe flags as not-a-chat-model (422)", async () => {
		const probe = vi.fn<ChatModelProbe>().mockResolvedValue({
			kind: "not_chat_model",
			detail: '"acme/not-chat" is not a chat model',
		});
		const { app, store } = makeProbeApp(probe);
		const ws = await store.createWorkspace({ name: "ws", kind: "mock" });

		const res = await app.request(`/api/v1/workspaces/${ws.uid}/llm-services`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				name: "bad",
				provider: "huggingface",
				modelName: "acme/not-chat",
				credentialRef: "test:hf",
			}),
		});

		expect(res.status).toBe(422);
		const body = await json(res);
		expect(body.error.code).toBe("llm_model_not_chat");
		expect(probe).toHaveBeenCalledWith({
			modelName: "acme/not-chat",
			token: "fake-token",
		});
		// Rejected saves must not persist.
		expect(await store.listLlmServices(ws.uid)).toHaveLength(0);
	});

	test("POST allows a model the probe reports as served", async () => {
		const probe = vi.fn<ChatModelProbe>().mockResolvedValue({ kind: "served" });
		const { app, store } = makeProbeApp(probe);
		const ws = await store.createWorkspace({ name: "ws", kind: "mock" });

		const res = await app.request(`/api/v1/workspaces/${ws.uid}/llm-services`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				name: "good",
				provider: "huggingface",
				modelName: "Qwen/Qwen2.5-7B-Instruct",
				credentialRef: "test:hf",
			}),
		});

		expect(res.status).toBe(201);
		expect(probe).toHaveBeenCalledTimes(1);
		expect(await store.listLlmServices(ws.uid)).toHaveLength(1);
	});

	test("skips the probe when no credential resolves (fail-open CRUD)", async () => {
		const probe = vi.fn<ChatModelProbe>().mockResolvedValue({ kind: "served" });
		const { app, store } = makeProbeApp(probe);
		const ws = await store.createWorkspace({ name: "ws", kind: "mock" });

		// No credentialRef + chatConfig:null ⇒ nothing to probe with.
		const res = await app.request(`/api/v1/workspaces/${ws.uid}/llm-services`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				name: "untokened",
				provider: "huggingface",
				modelName: "acme/whatever",
			}),
		});

		expect(res.status).toBe(201);
		expect(probe).not.toHaveBeenCalled();
	});

	test("skips the probe for non-HuggingFace providers", async () => {
		const probe = vi.fn<ChatModelProbe>().mockResolvedValue({ kind: "served" });
		const { app, store } = makeProbeApp(probe);
		const ws = await store.createWorkspace({ name: "ws", kind: "mock" });

		const res = await app.request(`/api/v1/workspaces/${ws.uid}/llm-services`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				name: "openai-svc",
				provider: "openai",
				modelName: "gpt-4o-mini",
				credentialRef: "test:openai",
			}),
		});

		expect(res.status).toBe(201);
		expect(probe).not.toHaveBeenCalled();
	});

	test("PATCH re-probes when the model changes and rejects a non-chat model", async () => {
		const probe = vi.fn<ChatModelProbe>().mockResolvedValue({ kind: "served" });
		const { app, store } = makeProbeApp(probe);
		const ws = await store.createWorkspace({ name: "ws", kind: "mock" });

		const created = await app.request(
			`/api/v1/workspaces/${ws.uid}/llm-services`,
			{
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					name: "svc",
					provider: "huggingface",
					modelName: "Qwen/Qwen2.5-7B-Instruct",
					credentialRef: "test:hf",
				}),
			},
		);
		expect(created.status).toBe(201);
		const id = (await json(created)).llmServiceId;

		probe.mockResolvedValueOnce({
			kind: "not_chat_model",
			detail: '"acme/not-chat" is not a chat model',
		});
		const patch = await app.request(
			`/api/v1/workspaces/${ws.uid}/llm-services/${id}`,
			{
				method: "PATCH",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ modelName: "acme/not-chat" }),
			},
		);

		expect(patch.status).toBe(422);
		expect((await json(patch)).error.code).toBe("llm_model_not_chat");
		// The rejected model must not have been written.
		const after = await store.getLlmService(ws.uid, id);
		expect(after?.modelName).toBe("Qwen/Qwen2.5-7B-Instruct");
	});

	test("PATCH that leaves the model untouched does not re-probe", async () => {
		const probe = vi.fn<ChatModelProbe>().mockResolvedValue({ kind: "served" });
		const { app, store } = makeProbeApp(probe);
		const ws = await store.createWorkspace({ name: "ws", kind: "mock" });

		const created = await app.request(
			`/api/v1/workspaces/${ws.uid}/llm-services`,
			{
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					name: "svc",
					provider: "huggingface",
					modelName: "Qwen/Qwen2.5-7B-Instruct",
					credentialRef: "test:hf",
				}),
			},
		);
		const id = (await json(created)).llmServiceId;
		probe.mockClear();

		const patch = await app.request(
			`/api/v1/workspaces/${ws.uid}/llm-services/${id}`,
			{
				method: "PATCH",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ description: "just a label change" }),
			},
		);

		expect(patch.status).toBe(200);
		expect(probe).not.toHaveBeenCalled();
	});
});
