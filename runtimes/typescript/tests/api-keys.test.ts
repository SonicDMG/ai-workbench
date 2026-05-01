/**
 * Route-level coverage for `/api/v1/workspaces/{w}/api-keys`.
 *
 * The unit-level token primitives (`mintToken`, `verifyToken`) have
 * dedicated coverage in `auth/apiKey/`; this file exercises the
 * full HTTP CRUD lifecycle: issue → list → revoke → idempotent
 * re-revoke, plus the 404 branches.
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
	return (await json(res)).workspaceId as string;
}

describe("api-keys routes", () => {
	test("POST returns plaintext exactly once + record without hash", async () => {
		const app = makeApp();
		const ws = await createWorkspace(app);

		const create = await app.request(`/api/v1/workspaces/${ws}/api-keys`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ label: "ci runner" }),
		});
		expect(create.status).toBe(201);
		const body = await json(create);

		expect(typeof body.plaintext).toBe("string");
		expect(body.plaintext.length).toBeGreaterThan(20);
		expect(body.key.workspaceId).toBe(ws);
		expect(body.key.label).toBe("ci runner");
		expect(typeof body.key.prefix).toBe("string");
		expect(body.key.revokedAt).toBeNull();
		// Hash never crosses the API boundary.
		expect(Object.keys(body.key)).not.toContain("hash");
	});

	test("GET lists every key including revoked rows", async () => {
		const app = makeApp();
		const ws = await createWorkspace(app);

		const a = await json(
			await app.request(`/api/v1/workspaces/${ws}/api-keys`, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ label: "a" }),
			}),
		);
		const b = await json(
			await app.request(`/api/v1/workspaces/${ws}/api-keys`, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ label: "b" }),
			}),
		);

		// Revoke the second one.
		const revoke = await app.request(
			`/api/v1/workspaces/${ws}/api-keys/${b.key.keyId}`,
			{ method: "DELETE" },
		);
		expect(revoke.status).toBe(204);

		const list = await app.request(`/api/v1/workspaces/${ws}/api-keys`);
		expect(list.status).toBe(200);
		const page = await json(list);
		expect(page.items).toHaveLength(2);
		const labels = page.items.map((k: { label: string }) => k.label).sort();
		expect(labels).toEqual(["a", "b"]);

		const aRow = page.items.find(
			(k: { keyId: string }) => k.keyId === a.key.keyId,
		);
		const bRow = page.items.find(
			(k: { keyId: string }) => k.keyId === b.key.keyId,
		);
		expect(aRow.revokedAt).toBeNull();
		expect(typeof bRow.revokedAt).toBe("string");
	});

	test("DELETE on already-revoked key is idempotent", async () => {
		const app = makeApp();
		const ws = await createWorkspace(app);
		const created = await json(
			await app.request(`/api/v1/workspaces/${ws}/api-keys`, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ label: "tmp" }),
			}),
		);
		const keyId = created.key.keyId as string;

		const first = await app.request(
			`/api/v1/workspaces/${ws}/api-keys/${keyId}`,
			{ method: "DELETE" },
		);
		expect(first.status).toBe(204);

		const second = await app.request(
			`/api/v1/workspaces/${ws}/api-keys/${keyId}`,
			{ method: "DELETE" },
		);
		expect(second.status).toBe(204);

		const list = await json(
			await app.request(`/api/v1/workspaces/${ws}/api-keys`),
		);
		expect(list.items).toHaveLength(1);
		expect(list.items[0].revokedAt).toBeTruthy();
	});

	test("DELETE for unknown keyId returns 404", async () => {
		const app = makeApp();
		const ws = await createWorkspace(app);
		const res = await app.request(
			`/api/v1/workspaces/${ws}/api-keys/00000000-0000-4000-8000-000000000000`,
			{ method: "DELETE" },
		);
		expect(res.status).toBe(404);
		const body = await json(res);
		expect(body.error.code).toBe("api_key_not_found");
	});

	test("POST rejects empty label with 400", async () => {
		const app = makeApp();
		const ws = await createWorkspace(app);
		const res = await app.request(`/api/v1/workspaces/${ws}/api-keys`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ label: "" }),
		});
		expect(res.status).toBe(400);
	});

	test("POST rejects label longer than 120 chars with 400", async () => {
		const app = makeApp();
		const ws = await createWorkspace(app);
		const res = await app.request(`/api/v1/workspaces/${ws}/api-keys`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ label: "x".repeat(121) }),
		});
		expect(res.status).toBe(400);
	});
});
