/**
 * Integration coverage for `manageRouteScope()` — the REST-side gate
 * that requires the `manage` scope on admin-only workspace surfaces
 * (api-keys, principals, policy, and workspace destroy).
 *
 * This is the RBAC behavior split introduced in 0.4.0: before it, any
 * `write`-capable key could mint credentials or administer RLAC. The
 * gate sits after `mutatingRouteWriteScope()` (see `app.ts`), so this
 * file exercises the mounted pipeline end-to-end with three keys —
 * read-only (viewer), read+write (editor), and read+write+manage
 * (admin) — against representative admin and non-admin routes.
 */

import { describe, expect, test } from "vitest";
import { createApp } from "../../src/app.js";
import { mintToken } from "../../src/auth/apiKey/token.js";
import { ApiKeyVerifier } from "../../src/auth/apiKey/verifier.js";
import { AuthResolver } from "../../src/auth/resolver.js";
import { MemoryControlPlaneStore } from "../../src/control-plane/memory/store.js";
import type { ApiKeyScope } from "../../src/control-plane/types.js";
import { MockVectorStoreDriver } from "../../src/drivers/mock/store.js";
import { VectorStoreDriverRegistry } from "../../src/drivers/registry.js";
import { EnvSecretProvider } from "../../src/secrets/env.js";
import { SecretResolver } from "../../src/secrets/provider.js";
import { makeFakeEmbedderFactory } from "../helpers/embedder.js";

interface Harness {
	readonly app: ReturnType<typeof createApp>;
	readonly workspace: string;
	readonly editorToken: string;
	readonly adminToken: string;
	readonly viewerToken: string;
}

async function makeHarness(): Promise<Harness> {
	const store = new MemoryControlPlaneStore();
	const drivers = new VectorStoreDriverRegistry(
		new Map([["mock", new MockVectorStoreDriver()]]),
	);
	const secrets = new SecretResolver({ env: new EnvSecretProvider() });
	const auth = new AuthResolver({
		mode: "apiKey",
		anonymousPolicy: "reject",
		verifiers: [new ApiKeyVerifier({ store })],
	});
	const app = createApp({
		store,
		drivers,
		secrets,
		auth,
		embedders: makeFakeEmbedderFactory(),
		mcpConfig: { enabled: true, exposeChat: false },
	});

	const ws = await store.createWorkspace({ name: "ws", kind: "mock" });

	const mintFor = async (
		keyId: string,
		label: string,
		scopes: readonly ApiKeyScope[],
	): Promise<string> => {
		const minted = await mintToken();
		await store.persistApiKey(ws.uid, {
			keyId,
			prefix: minted.prefix,
			hash: minted.hash,
			label,
			scopes,
		});
		return minted.plaintext;
	};

	return {
		app,
		workspace: ws.uid,
		viewerToken: await mintFor(
			"00000000-0000-0000-0000-0000000000a1",
			"viewer",
			["read"],
		),
		editorToken: await mintFor(
			"00000000-0000-0000-0000-0000000000b2",
			"editor",
			["read", "write"],
		),
		adminToken: await mintFor("00000000-0000-0000-0000-0000000000c3", "admin", [
			"read",
			"write",
			"manage",
		]),
	};
}

function authHeader(token: string): Record<string, string> {
	return { authorization: `Bearer ${token}` };
}

describe("manageRouteScope — admin surfaces require the manage scope", () => {
	test("editor (read+write) is forbidden from issuing API keys", async () => {
		const h = await makeHarness();
		const res = await h.app.request(
			`/api/v1/workspaces/${h.workspace}/api-keys`,
			{
				method: "POST",
				headers: {
					"content-type": "application/json",
					...authHeader(h.editorToken),
				},
				body: JSON.stringify({ label: "editor-attempt" }),
			},
		);
		expect(res.status).toBe(403);
		const body = (await res.json()) as { error: { code: string } };
		expect(body.error.code).toBe("forbidden");
	});

	test("editor is forbidden from listing API keys (privileged read)", async () => {
		const h = await makeHarness();
		const res = await h.app.request(
			`/api/v1/workspaces/${h.workspace}/api-keys`,
			{ headers: authHeader(h.editorToken) },
		);
		expect(res.status).toBe(403);
	});

	test("admin (read+write+manage) can issue API keys", async () => {
		const h = await makeHarness();
		const res = await h.app.request(
			`/api/v1/workspaces/${h.workspace}/api-keys`,
			{
				method: "POST",
				headers: {
					"content-type": "application/json",
					...authHeader(h.adminToken),
				},
				body: JSON.stringify({ label: "minted-by-admin" }),
			},
		);
		expect(res.status).toBe(201);
	});

	test("editor is forbidden from creating a principal", async () => {
		const h = await makeHarness();
		const res = await h.app.request(
			`/api/v1/workspaces/${h.workspace}/principals`,
			{
				method: "POST",
				headers: {
					"content-type": "application/json",
					...authHeader(h.editorToken),
				},
				body: JSON.stringify({ principalId: "alice" }),
			},
		);
		expect(res.status).toBe(403);
	});

	test("admin can create a principal", async () => {
		const h = await makeHarness();
		const res = await h.app.request(
			`/api/v1/workspaces/${h.workspace}/principals`,
			{
				method: "POST",
				headers: {
					"content-type": "application/json",
					...authHeader(h.adminToken),
				},
				body: JSON.stringify({ principalId: "alice" }),
			},
		);
		expect(res.status).toBe(201);
	});

	test("editor is forbidden from deleting the workspace", async () => {
		const h = await makeHarness();
		const res = await h.app.request(`/api/v1/workspaces/${h.workspace}`, {
			method: "DELETE",
			headers: authHeader(h.editorToken),
		});
		expect(res.status).toBe(403);
	});

	test("viewer is forbidden from the policy audit log", async () => {
		const h = await makeHarness();
		const res = await h.app.request(
			`/api/v1/workspaces/${h.workspace}/policy/audit`,
			{ headers: authHeader(h.viewerToken) },
		);
		expect(res.status).toBe(403);
	});

	test("editor can still manage workspace content (rename) — write, not manage", async () => {
		const h = await makeHarness();
		const res = await h.app.request(`/api/v1/workspaces/${h.workspace}`, {
			method: "PATCH",
			headers: {
				"content-type": "application/json",
				...authHeader(h.editorToken),
			},
			body: JSON.stringify({ name: "renamed-by-editor" }),
		});
		expect(res.status).toBe(200);
	});
});
