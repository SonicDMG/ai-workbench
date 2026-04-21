import { describe, expect, test } from "vitest";
import { createApp } from "../src/app.js";
import { ConfigSchema } from "../src/config/schema.js";
import { WorkspaceRegistry } from "../src/workspaces/registry.js";

// Tests fetch JSON and assert on properties; cast to `any` for ergonomic access.
// biome-ignore lint/suspicious/noExplicitAny: test helper returns untyped JSON for ergonomic property access
async function json(res: Response): Promise<any> {
	// biome-ignore lint/suspicious/noExplicitAny: test helper returns untyped JSON for ergonomic property access
	return (await res.json()) as any;
}

function mockConfig() {
	return ConfigSchema.parse({
		version: 1,
		workspaces: [
			{
				id: "mock",
				driver: "mock",
				description: "test mock",
				vectorStores: [{ id: "v1", collection: "c", dimensions: 128 }],
				catalogs: [{ id: "cat1", vectorStore: "v1" }],
			},
		],
	});
}

function astraConfig() {
	return ConfigSchema.parse({
		version: 1,
		workspaces: [
			{
				id: "prod",
				driver: "astra",
				description: "prod astra",
				astra: {
					endpoint: "https://example.apps.astra.datastax.com",
					token: "super-secret-token",
					keyspace: "default_keyspace",
				},
				auth: { kind: "bearer", tokens: ["wb-tok"] },
				vectorStores: [{ id: "v1", collection: "c", dimensions: 1536 }],
				catalogs: [{ id: "cat1", vectorStore: "v1" }],
			},
		],
	});
}

function makeApp(config = mockConfig()) {
	return createApp({ registry: new WorkspaceRegistry(config) });
}

describe("operational routes", () => {
	test("GET / returns service banner", async () => {
		const res = await makeApp().request("/");
		expect(res.status).toBe(200);
		const body = await json(res);
		expect(body).toMatchObject({ name: "ai-workbench", docs: "/docs" });
		expect(body.version).toBeDefined();
		expect(body.commit).toBeDefined();
	});

	test("GET /healthz returns ok", async () => {
		const res = await makeApp().request("/healthz");
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ status: "ok" });
	});

	test("GET /readyz returns ready when all workspaces ready", async () => {
		const res = await makeApp().request("/readyz");
		expect(res.status).toBe(200);
		expect(await res.json()).toMatchObject({
			status: "ready",
			workspaces: ["mock"],
		});
	});

	test("GET /readyz returns 503 when a workspace is unready", async () => {
		const cfg = ConfigSchema.parse({
			version: 1,
			workspaces: [
				{
					id: "prod",
					driver: "astra",
					astra: {
						endpoint: "https://x.apps.astra.datastax.com",
						token: "ok",
					},
					vectorStores: [],
					catalogs: [],
				},
			],
		});
		const registry = new WorkspaceRegistry(cfg);
		// Force the workspace into unready for the test.
		(registry as unknown as { workspaces: Map<string, unknown> }).workspaces =
			new Map([
				[
					"prod",
					{
						config: cfg.workspaces[0],
						status: "unready",
						error: "astra credentials missing",
					},
				],
			]);
		const app = createApp({ registry });
		const res = await app.request("/readyz");
		expect(res.status).toBe(503);
		const body = await json(res);
		expect(body.error.code).toBe("workspace_unready");
	});

	test("GET /version returns build metadata", async () => {
		const res = await makeApp().request("/version");
		expect(res.status).toBe(200);
		const body = await json(res);
		expect(body).toMatchObject({ node: process.version });
		expect(body.version).toBeDefined();
		expect(body.buildTime).toBeDefined();
	});

	test("responses carry X-Request-Id", async () => {
		const res = await makeApp().request("/healthz");
		expect(res.headers.get("X-Request-Id")).toBeTruthy();
	});

	test("echoes client-provided request id", async () => {
		const res = await makeApp().request("/healthz", {
			headers: { "X-Request-Id": "abc-123" },
		});
		expect(res.headers.get("X-Request-Id")).toBe("abc-123");
	});
});

describe("workspace routes", () => {
	test("GET /v1/workspaces lists workspaces", async () => {
		const res = await makeApp().request("/v1/workspaces");
		expect(res.status).toBe(200);
		const body = await json(res);
		expect(body.data).toHaveLength(1);
		expect(body.data[0]).toMatchObject({
			id: "mock",
			driver: "mock",
			description: "test mock",
		});
	});

	test("GET /v1/workspaces/:id returns details", async () => {
		const res = await makeApp().request("/v1/workspaces/mock");
		expect(res.status).toBe(200);
		const body = await json(res);
		expect(body.data.id).toBe("mock");
		expect(body.data.driver).toBe("mock");
	});

	test("GET /v1/workspaces/:id returns 404 for unknown", async () => {
		const res = await makeApp().request("/v1/workspaces/nope");
		expect(res.status).toBe(404);
		const body = await json(res);
		expect(body.error.code).toBe("workspace_not_found");
		expect(body.error.requestId).toBeTruthy();
	});

	test("redacts astra token", async () => {
		const res = await makeApp(astraConfig()).request("/v1/workspaces/prod", {
			headers: { Authorization: "Bearer wb-tok" },
		});
		expect(res.status).toBe(200);
		const body = await json(res);
		expect(body.data.astra.token).toBe("****");
		expect(body.data.astra.endpoint).toBe(
			"https://example.apps.astra.datastax.com",
		);
	});

	test("redacts bearer auth tokens", async () => {
		const res = await makeApp(astraConfig()).request("/v1/workspaces/prod", {
			headers: { Authorization: "Bearer wb-tok" },
		});
		const body = await json(res);
		expect(body.data.auth.tokens).toEqual(["****"]);
	});
});

describe("error handling", () => {
	test("unknown routes return 404 envelope", async () => {
		const res = await makeApp().request("/no-such-path");
		expect(res.status).toBe(404);
		const body = await json(res);
		expect(body.error.code).toBe("not_found");
	});
});

describe("per-workspace auth", () => {
	function bearerConfig() {
		return ConfigSchema.parse({
			version: 1,
			workspaces: [
				{
					id: "secured",
					driver: "mock",
					auth: { kind: "bearer", tokens: ["right-token", "alt-token"] },
					vectorStores: [{ id: "v1", collection: "c", dimensions: 128 }],
					catalogs: [{ id: "cat1", vectorStore: "v1" }],
				},
				{
					id: "open",
					driver: "mock",
					auth: { kind: "none" },
					vectorStores: [],
					catalogs: [],
				},
			],
		});
	}

	test("workspace with kind:none requires no auth", async () => {
		const app = makeApp(bearerConfig());
		const res = await app.request("/v1/workspaces/open");
		expect(res.status).toBe(200);
	});

	test("bearer workspace returns 401 with no Authorization header", async () => {
		const app = makeApp(bearerConfig());
		const res = await app.request("/v1/workspaces/secured");
		expect(res.status).toBe(401);
		const body = await json(res);
		expect(body.error.code).toBe("missing_authorization");
	});

	test("bearer workspace returns 401 for malformed header", async () => {
		const app = makeApp(bearerConfig());
		const res = await app.request("/v1/workspaces/secured", {
			headers: { Authorization: "Basic abc" },
		});
		expect(res.status).toBe(401);
		const body = await json(res);
		expect(body.error.code).toBe("invalid_authorization");
	});

	test("bearer workspace returns 403 for wrong token", async () => {
		const app = makeApp(bearerConfig());
		const res = await app.request("/v1/workspaces/secured", {
			headers: { Authorization: "Bearer wrong-token" },
		});
		expect(res.status).toBe(403);
		const body = await json(res);
		expect(body.error.code).toBe("invalid_token");
	});

	test("bearer workspace accepts a valid token", async () => {
		const app = makeApp(bearerConfig());
		const res = await app.request("/v1/workspaces/secured", {
			headers: { Authorization: "Bearer right-token" },
		});
		expect(res.status).toBe(200);
		const body = await json(res);
		expect(body.data.id).toBe("secured");
	});

	test("bearer workspace accepts any configured token", async () => {
		const app = makeApp(bearerConfig());
		const res = await app.request("/v1/workspaces/secured", {
			headers: { Authorization: "Bearer alt-token" },
		});
		expect(res.status).toBe(200);
	});

	test("404 for unknown workspace is returned before auth check", async () => {
		const app = makeApp(bearerConfig());
		const res = await app.request("/v1/workspaces/does-not-exist");
		expect(res.status).toBe(404);
		const body = await json(res);
		expect(body.error.code).toBe("workspace_not_found");
	});

	test("list endpoint remains public even when workspaces have auth", async () => {
		const app = makeApp(bearerConfig());
		const res = await app.request("/v1/workspaces");
		expect(res.status).toBe(200);
		const body = await json(res);
		expect(body.data).toHaveLength(2);
	});
});

describe("openapi", () => {
	test("GET /v1/openapi.json returns a 3.1 document", async () => {
		const res = await makeApp().request("/v1/openapi.json");
		expect(res.status).toBe(200);
		const body = await json(res);
		expect(body.openapi).toBe("3.1.0");
		expect(body.info.title).toBe("AI Workbench");
	});

	test("openapi document lists all six Phase 0 paths", async () => {
		const res = await makeApp().request("/v1/openapi.json");
		const body = await json(res);
		const paths = Object.keys(body.paths);
		expect(paths).toContain("/");
		expect(paths).toContain("/healthz");
		expect(paths).toContain("/readyz");
		expect(paths).toContain("/version");
		expect(paths).toContain("/v1/workspaces");
		expect(paths).toContain("/v1/workspaces/{workspaceId}");
	});

	test("openapi document includes shared error envelope schema", async () => {
		const res = await makeApp().request("/v1/openapi.json");
		const body = await json(res);
		expect(body.components.schemas.ErrorEnvelope).toBeDefined();
	});

	test("openapi document declares BearerAuth security scheme", async () => {
		const res = await makeApp().request("/v1/openapi.json");
		const body = await json(res);
		expect(body.components.securitySchemes.BearerAuth).toMatchObject({
			type: "http",
			scheme: "bearer",
		});
	});

	test("workspace detail route advertises 401 and 403 responses", async () => {
		const res = await makeApp().request("/v1/openapi.json");
		const body = await json(res);
		const detail = body.paths["/v1/workspaces/{workspaceId}"].get;
		expect(detail.responses["401"]).toBeDefined();
		expect(detail.responses["403"]).toBeDefined();
	});

	test("GET /docs serves the Scalar reference UI", async () => {
		const res = await makeApp().request("/docs");
		expect(res.status).toBe(200);
		const text = await res.text();
		expect(text).toContain("/v1/openapi.json");
	});
});
