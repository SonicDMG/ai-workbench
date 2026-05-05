/**
 * Coverage for the agent-template catalog surface:
 *
 *   GET  /api/v1/workspaces/{w}/agent-templates    — list catalog
 *   POST /api/v1/workspaces/{w}/agents/from-template — instantiate
 *
 * Plus the in-process catalog helpers (`findAgentTemplate`,
 * `defaultOnNewWorkspaceTemplates`, `templateToCreateAgentInput`)
 * exercised through the route surface where possible. The catalog
 * itself is static data, so most tests are about the wire-shape
 * contract rather than the data.
 */

import { describe, expect, test } from "vitest";
import { createApp } from "../src/app.js";
import { AuthResolver } from "../src/auth/resolver.js";
import {
	AGENT_TEMPLATES,
	defaultOnNewWorkspaceTemplates,
	findAgentTemplate,
} from "../src/control-plane/agent-templates.js";
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
	return createApp({
		store,
		drivers,
		secrets,
		auth,
		embedders,
		chatService: null,
		chatConfig: null,
	});
}

type AppHandle = ReturnType<typeof makeApp>;

async function createWorkspace(app: AppHandle): Promise<string> {
	const res = await app.request("/api/v1/workspaces", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ name: "ws", kind: "mock" }),
	});
	expect(res.status, await res.clone().text()).toBe(201);
	return (await json(res)).workspaceId as string;
}

describe("agent-template catalog (in-process)", () => {
	test("the catalog ships at least Bobby + Heidi as default-on", () => {
		const defaults = defaultOnNewWorkspaceTemplates();
		const ids = defaults.map((t) => t.templateId).sort();
		expect(ids).toEqual(expect.arrayContaining(["bobby", "heidi"]));
		// Default-on templates must all set the flag truthfully.
		for (const t of defaults) {
			expect(t.defaultOnNewWorkspace).toBe(true);
		}
	});

	test("every catalog entry has the required wire-shape fields", () => {
		for (const t of AGENT_TEMPLATES) {
			expect(t.templateId).toMatch(/^[a-z][a-z0-9-]*$/);
			expect(t.name.length).toBeGreaterThan(0);
			expect(t.description.length).toBeGreaterThan(0);
			expect(t.persona.length).toBeGreaterThan(0);
			expect(t.systemPrompt.length).toBeGreaterThan(0);
			expect(typeof t.defaultOnNewWorkspace).toBe("boolean");
		}
	});

	test("templateIds are unique across the catalog", () => {
		const ids = AGENT_TEMPLATES.map((t) => t.templateId);
		expect(new Set(ids).size).toBe(ids.length);
	});

	test("findAgentTemplate returns the entry for a known slug", () => {
		const found = findAgentTemplate("bobby");
		expect(found?.name).toBe("Bobby");
	});

	test("findAgentTemplate returns null for an unknown slug", () => {
		expect(findAgentTemplate("nonexistent-slug")).toBeNull();
	});
});

describe("GET /workspaces/{w}/agent-templates", () => {
	test("returns the full catalog with stable shape", async () => {
		const app = makeApp();
		const ws = await createWorkspace(app);

		const res = await app.request(`/api/v1/workspaces/${ws}/agent-templates`);
		expect(res.status).toBe(200);
		const body = await json(res);
		expect(Array.isArray(body.items)).toBe(true);
		expect(body.items.length).toBe(AGENT_TEMPLATES.length);

		// Every item carries every documented field.
		for (const item of body.items) {
			expect(item).toEqual(
				expect.objectContaining({
					templateId: expect.any(String),
					name: expect.any(String),
					description: expect.any(String),
					persona: expect.any(String),
					systemPrompt: expect.any(String),
					defaultOnNewWorkspace: expect.any(Boolean),
				}),
			);
		}

		// Catalog ordering is stable. Bobby anchors the front of the
		// list; Heidi anchors the back so opt-in personas (Maven,
		// Quill, Sage) read as a group between the two recommended
		// agents. The UI relies on this to render its "recommended"
		// rail without re-sorting.
		expect(body.items[0].templateId).toBe("bobby");
		expect(body.items[body.items.length - 1].templateId).toBe("heidi");
	});

	test("404 when the workspace doesn't exist", async () => {
		const app = makeApp();
		const res = await app.request(
			"/api/v1/workspaces/00000000-0000-4000-8000-000000000000/agent-templates",
		);
		expect(res.status).toBe(404);
	});
});

describe("POST /workspaces/{w}/agents/from-template", () => {
	test("instantiates a known template with the catalog's name + prompt", async () => {
		const app = makeApp();
		const ws = await createWorkspace(app);

		const res = await app.request(
			`/api/v1/workspaces/${ws}/agents/from-template`,
			{
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ templateId: "maven" }),
			},
		);
		expect(res.status, await res.clone().text()).toBe(201);
		const created = await json(res);
		expect(created.name).toBe("Maven");
		expect(created.systemPrompt).toContain("Maven");
		expect(created.systemPrompt).toContain("search_kb");
		expect(created.workspaceId).toBe(ws);
		expect(created.agentId).toMatch(/^[0-9a-f-]{36}$/);
	});

	test("binds the new agent to the workspace's first LLM service so tool calling works", async () => {
		// Bobby + Heidi (auto-seeded on workspace POST) get the seeded
		// gpt-4o-mini service wired in. Until this fix, from-template
		// agents had llmServiceId: null and fell back to the runtime's
		// global chat config — which routes through a path that can't
		// natively invoke tools, so search_kb came out as plain text.
		const app = makeApp();
		const ws = await createWorkspace(app);

		const llmList = await app.request(`/api/v1/workspaces/${ws}/llm-services`);
		const llmItems = (await json(llmList)).items as Array<{
			llmServiceId: string;
		}>;
		expect(llmItems.length).toBeGreaterThan(0);
		const expectedLlmServiceId = llmItems[0]?.llmServiceId;

		const res = await app.request(
			`/api/v1/workspaces/${ws}/agents/from-template`,
			{
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ templateId: "sage" }),
			},
		);
		expect(res.status).toBe(201);
		const created = await json(res);
		expect(created.llmServiceId).toBe(expectedLlmServiceId);
	});

	test("leaves llmServiceId null when the workspace has no LLM services", async () => {
		// Edge case: an operator who deleted every seeded LLM service
		// before clicking 'from template' should still get an agent —
		// just one that falls back to the runtime's global chat config,
		// matching the prior behavior. Don't synthesise an llmServiceId
		// out of thin air.
		const app = makeApp();
		const ws = await createWorkspace(app);
		// Delete the seeded agents first — they reference the seeded
		// LLM service, so the LLM-service deletion would 409 with
		// `llm_service_in_use` otherwise.
		const agentList = await app.request(`/api/v1/workspaces/${ws}/agents`);
		const seededAgents = (await json(agentList)).items as Array<{
			agentId: string;
		}>;
		for (const a of seededAgents) {
			await app.request(`/api/v1/workspaces/${ws}/agents/${a.agentId}`, {
				method: "DELETE",
			});
		}
		const llmList = await app.request(`/api/v1/workspaces/${ws}/llm-services`);
		const seededLlms = (await json(llmList)).items as Array<{
			llmServiceId: string;
		}>;
		for (const svc of seededLlms) {
			const del = await app.request(
				`/api/v1/workspaces/${ws}/llm-services/${svc.llmServiceId}`,
				{ method: "DELETE" },
			);
			expect(del.ok, `delete llm-service: ${await del.clone().text()}`).toBe(
				true,
			);
		}

		const res = await app.request(
			`/api/v1/workspaces/${ws}/agents/from-template`,
			{
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ templateId: "quill" }),
			},
		);
		expect(res.status, await res.clone().text()).toBe(201);
		const created = await json(res);
		expect(created.llmServiceId).toBeNull();
	});

	test("the new agent shows up in the workspace's agent list", async () => {
		const app = makeApp();
		const ws = await createWorkspace(app);

		const create = await app.request(
			`/api/v1/workspaces/${ws}/agents/from-template`,
			{
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ templateId: "quill" }),
			},
		);
		const created = await json(create);

		const list = await app.request(`/api/v1/workspaces/${ws}/agents`);
		expect(list.status).toBe(200);
		const ids = ((await json(list)).items as Array<{ agentId: string }>).map(
			(a) => a.agentId,
		);
		expect(ids).toContain(created.agentId);
	});

	test("404 for an unknown templateId", async () => {
		const app = makeApp();
		const ws = await createWorkspace(app);

		const res = await app.request(
			`/api/v1/workspaces/${ws}/agents/from-template`,
			{
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ templateId: "no-such-template" }),
			},
		);
		expect(res.status).toBe(404);
		const body = await json(res);
		expect(body.error.code).toBe("agent_template_not_found");
	});

	test("404 when the workspace doesn't exist", async () => {
		const app = makeApp();
		const res = await app.request(
			"/api/v1/workspaces/00000000-0000-4000-8000-000000000000/agents/from-template",
			{
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ templateId: "bobby" }),
			},
		);
		expect(res.status).toBe(404);
	});

	test("400 on a body missing templateId", async () => {
		const app = makeApp();
		const ws = await createWorkspace(app);

		const res = await app.request(
			`/api/v1/workspaces/${ws}/agents/from-template`,
			{
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({}),
			},
		);
		expect(res.status).toBe(400);
	});

	test("instantiating the same template twice produces two distinct agents", async () => {
		const app = makeApp();
		const ws = await createWorkspace(app);

		const a = await app.request(
			`/api/v1/workspaces/${ws}/agents/from-template`,
			{
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ templateId: "sage" }),
			},
		);
		const b = await app.request(
			`/api/v1/workspaces/${ws}/agents/from-template`,
			{
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ templateId: "sage" }),
			},
		);
		expect(a.status).toBe(201);
		expect(b.status).toBe(201);
		const aBody = await json(a);
		const bBody = await json(b);
		expect(aBody.agentId).not.toBe(bBody.agentId);
		expect(aBody.name).toBe("Sage");
		expect(bBody.name).toBe("Sage");
	});
});
