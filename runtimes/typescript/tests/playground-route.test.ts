/**
 * HTTP-level coverage for the workspace-scoped playground route.
 * These cases stop before any live Data API call, so they pin route
 * wiring and validation without needing Astra credentials.
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

async function createWorkspace(
	app: ReturnType<typeof createApp>,
	kind: "astra" | "mock",
): Promise<string> {
	const res = await app.request("/api/v1/workspaces", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ name: `${kind}-ws`, kind }),
	});
	expect(res.status).toBe(201);
	return (await json(res)).workspaceId as string;
}

describe("playground route", () => {
	test("rejects non-Astra workspaces", async () => {
		const app = makeApp();
		const ws = await createWorkspace(app, "mock");

		const res = await app.request(
			`/api/v1/workspaces/${ws}/playground/execute`,
			{
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					commandName: "findCollections",
					command: { findCollections: {} },
				}),
			},
		);

		expect(res.status).toBe(422);
		expect((await json(res)).error.code).toBe("unsupported_workspace_kind");
	});

	test("validates the selected command envelope before resolving credentials", async () => {
		const app = makeApp();
		const ws = await createWorkspace(app, "astra");

		const res = await app.request(
			`/api/v1/workspaces/${ws}/playground/execute`,
			{
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					commandName: "find",
					collection: "docs",
					command: { findOne: { filter: {} } },
				}),
			},
		);

		expect(res.status).toBe(400);
		expect((await json(res)).error.code).toBe("invalid_playground_command");
	});

	test("validates table target mode before resolving credentials", async () => {
		const app = makeApp();
		const ws = await createWorkspace(app, "astra");

		const res = await app.request(
			`/api/v1/workspaces/${ws}/playground/execute`,
			{
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					commandName: "listIndexes",
					targetKind: "table",
					command: { listIndexes: { options: { explain: false } } },
				}),
			},
		);

		expect(res.status).toBe(400);
		expect((await json(res)).error.message).toContain(
			"requires a table target",
		);
	});
});
