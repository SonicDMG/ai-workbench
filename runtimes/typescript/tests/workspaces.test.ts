/**
 * Route-level coverage for `/api/v1/workspaces` create + update —
 * specifically the duplicate-prevention 409 wire envelopes.
 *
 * The contract suite (`tests/control-plane/contract.ts`) verifies the
 * storage-layer invariant across all backends; this file pins the
 * end-to-end mapping: a `ControlPlaneConflictError` thrown by the
 * store with code `workspace_name_conflict` /
 * `workspace_database_conflict` reaches the client as `409` with the
 * same code string.
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

describe("POST /api/v1/workspaces — duplicate prevention", () => {
	test("a duplicate name returns 409 with code `workspace_name_conflict`", async () => {
		const app = makeApp();
		const first = await app.request("/api/v1/workspaces", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ name: "Engineering Docs", kind: "mock" }),
		});
		expect(first.status).toBe(201);

		const dup = await app.request("/api/v1/workspaces", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ name: "Engineering Docs", kind: "mock" }),
		});
		expect(dup.status).toBe(409);
		expect((await json(dup)).error.code).toBe("workspace_name_conflict");
	});

	test("a duplicate (url, keyspace) returns 409 with code `workspace_database_conflict`", async () => {
		const app = makeApp();
		const url = "https://db-X.apps.astra.datastax.com";
		const first = await app.request("/api/v1/workspaces", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				name: "alpha",
				kind: "mock",
				url,
				keyspace: "default_keyspace",
			}),
		});
		expect(first.status).toBe(201);

		const dup = await app.request("/api/v1/workspaces", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				name: "beta",
				kind: "mock",
				url,
				keyspace: "default_keyspace",
			}),
		});
		expect(dup.status).toBe(409);
		expect((await json(dup)).error.code).toBe("workspace_database_conflict");
	});

	test("the same url with a different keyspace is allowed", async () => {
		const app = makeApp();
		const url = "https://db-X.apps.astra.datastax.com";
		const a = await app.request("/api/v1/workspaces", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				name: "alpha",
				kind: "mock",
				url,
				keyspace: "ks_one",
			}),
		});
		expect(a.status).toBe(201);
		const b = await app.request("/api/v1/workspaces", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				name: "beta",
				kind: "mock",
				url,
				keyspace: "ks_two",
			}),
		});
		expect(b.status).toBe(201);
	});
});

describe("PATCH /api/v1/workspaces/{w} — duplicate prevention", () => {
	test("renaming to another workspace's name returns 409 `workspace_name_conflict`", async () => {
		const app = makeApp();
		await app.request("/api/v1/workspaces", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ name: "alpha", kind: "mock" }),
		});
		const beta = await app.request("/api/v1/workspaces", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ name: "beta", kind: "mock" }),
		});
		const betaId = (await json(beta)).workspaceId as string;

		const res = await app.request(`/api/v1/workspaces/${betaId}`, {
			method: "PATCH",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ name: "alpha" }),
		});
		expect(res.status).toBe(409);
		expect((await json(res)).error.code).toBe("workspace_name_conflict");
	});

	test("renaming to the workspace's own current name is a no-op (200)", async () => {
		const app = makeApp();
		const create = await app.request("/api/v1/workspaces", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ name: "alpha", kind: "mock" }),
		});
		const id = (await json(create)).workspaceId as string;
		const res = await app.request(`/api/v1/workspaces/${id}`, {
			method: "PATCH",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ name: "alpha" }),
		});
		expect(res.status).toBe(200);
		expect((await json(res)).name).toBe("alpha");
	});
});
