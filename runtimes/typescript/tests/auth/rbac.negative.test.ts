/**
 * RBAC negative-path suite (0.4.0, C1).
 *
 * Consolidates the authorization invariants the RBAC work (B1–B3)
 * established, and adds a self-maintaining **route-inventory guard**: a
 * read-only key must be forbidden from every mutating workspace route
 * except the documented read-shaped ones. A new mutating route added
 * without a scope gate fails this test automatically.
 *
 * Covered here:
 *   - tier matrix: viewer (read) / editor (read+write) / admin
 *     (read+write+manage) against representative routes;
 *   - cross-workspace isolation (a key scoped to ws A can't touch ws B);
 *   - credential lifecycle (revoked / expired keys → 401);
 *   - the route-inventory guard.
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
	readonly otherWorkspace: string;
	readonly viewerToken: string;
	readonly editorToken: string;
	readonly adminToken: string;
	readonly revokedToken: string;
	readonly expiredToken: string;
}

let keySeq = 0;
function keyId(): string {
	keySeq += 1;
	return `00000000-0000-0000-0000-${String(keySeq).padStart(12, "0")}`;
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

	const ws = await store.createWorkspace({ name: "primary", kind: "mock" });
	const other = await store.createWorkspace({ name: "other", kind: "mock" });

	const mint = async (
		scopes: ApiKeyScope[],
		opts?: { revoked?: boolean; expiresAt?: string },
	): Promise<string> => {
		const minted = await mintToken();
		const id = keyId();
		await store.persistApiKey(ws.uid, {
			keyId: id,
			prefix: minted.prefix,
			hash: minted.hash,
			label: scopes.join("+"),
			scopes,
			...(opts?.expiresAt ? { expiresAt: opts.expiresAt } : {}),
		});
		if (opts?.revoked) await store.revokeApiKey(ws.uid, id);
		return minted.plaintext;
	};

	return {
		app,
		workspace: ws.uid,
		otherWorkspace: other.uid,
		viewerToken: await mint(["read"]),
		editorToken: await mint(["read", "write"]),
		adminToken: await mint(["read", "write", "manage"]),
		revokedToken: await mint(["read"], { revoked: true }),
		expiredToken: await mint(["read"], {
			expiresAt: "2000-01-01T00:00:00.000Z",
		}),
	};
}

function authHeader(token: string): Record<string, string> {
	return { authorization: `Bearer ${token}` };
}

function jsonHeaders(token: string): Record<string, string> {
	return { "content-type": "application/json", ...authHeader(token) };
}

describe("RBAC tier matrix", () => {
	test("viewer can read but cannot write KB content", async () => {
		const h = await makeHarness();
		const list = await h.app.request(
			`/api/v1/workspaces/${h.workspace}/knowledge-bases`,
			{ headers: authHeader(h.viewerToken) },
		);
		expect(list.status).toBe(200);

		const create = await h.app.request(
			`/api/v1/workspaces/${h.workspace}/knowledge-bases`,
			{
				method: "POST",
				headers: jsonHeaders(h.viewerToken),
				body: JSON.stringify({
					name: "blocked",
					chunkingServiceId: "00000000-0000-0000-0000-000000000001",
					embeddingServiceId: "00000000-0000-0000-0000-000000000002",
				}),
			},
		);
		expect(create.status).toBe(403);
	});

	test("editor can write content but cannot perform admin (manage) ops", async () => {
		const h = await makeHarness();
		// Write-shaped content mutation passes the write gate (404 for the
		// missing KB, but crucially not 403).
		const rename = await h.app.request(`/api/v1/workspaces/${h.workspace}`, {
			method: "PATCH",
			headers: jsonHeaders(h.editorToken),
			body: JSON.stringify({ name: "renamed" }),
		});
		expect(rename.status).toBe(200);

		// Admin-only surface → 403.
		const issueKey = await h.app.request(
			`/api/v1/workspaces/${h.workspace}/api-keys`,
			{
				method: "POST",
				headers: jsonHeaders(h.editorToken),
				body: JSON.stringify({ label: "nope" }),
			},
		);
		expect(issueKey.status).toBe(403);
	});

	test("admin can perform manage ops", async () => {
		const h = await makeHarness();
		const issueKey = await h.app.request(
			`/api/v1/workspaces/${h.workspace}/api-keys`,
			{
				method: "POST",
				headers: jsonHeaders(h.adminToken),
				body: JSON.stringify({ label: "ok" }),
			},
		);
		expect(issueKey.status).toBe(201);
	});
});

describe("RBAC cross-workspace isolation", () => {
	test("a key scoped to workspace A cannot read workspace B", async () => {
		const h = await makeHarness();
		const res = await h.app.request(
			`/api/v1/workspaces/${h.otherWorkspace}/knowledge-bases`,
			{ headers: authHeader(h.adminToken) },
		);
		expect(res.status).toBe(403);
	});

	test("a key scoped to workspace A cannot write workspace B", async () => {
		const h = await makeHarness();
		const res = await h.app.request(`/api/v1/workspaces/${h.otherWorkspace}`, {
			method: "PATCH",
			headers: jsonHeaders(h.adminToken),
			body: JSON.stringify({ name: "x" }),
		});
		expect(res.status).toBe(403);
	});
});

describe("RBAC credential lifecycle", () => {
	test("a revoked key is rejected with 401", async () => {
		const h = await makeHarness();
		const res = await h.app.request(
			`/api/v1/workspaces/${h.workspace}/knowledge-bases`,
			{ headers: authHeader(h.revokedToken) },
		);
		expect(res.status).toBe(401);
	});

	test("an expired key is rejected with 401", async () => {
		const h = await makeHarness();
		const res = await h.app.request(
			`/api/v1/workspaces/${h.workspace}/knowledge-bases`,
			{ headers: authHeader(h.expiredToken) },
		);
		expect(res.status).toBe(401);
	});
});

describe("RBAC route-inventory guard", () => {
	// Mirrors `isReadShapedRoute` in `auth/authz.ts`: the routes a
	// read-only key is allowed to POST to because they don't mutate KB
	// content. Keep in sync with that allowlist.
	function isReadShaped(path: string): boolean {
		return (
			path.endsWith("/test-connection") ||
			path.endsWith("/connect/verify") ||
			path.endsWith("/mcp") ||
			path.endsWith("/search") ||
			path.includes("/conversations")
		);
	}

	test("a read-only key is forbidden from every mutating workspace route except read-shaped ones", async () => {
		const h = await makeHarness();
		const res = await h.app.request("/api/v1/openapi.json");
		const doc = (await res.json()) as {
			paths: Record<string, Record<string, unknown>>;
		};
		const DUMMY = "00000000-0000-0000-0000-0000000000ff";

		const violations: string[] = [];
		let checked = 0;
		for (const [pathName, ops] of Object.entries(doc.paths)) {
			if (!pathName.startsWith("/api/v1/workspaces/{workspaceId}")) continue;
			for (const method of ["post", "put", "patch", "delete"]) {
				if (!ops[method]) continue;
				const concrete = pathName
					.replace("{workspaceId}", h.workspace)
					.replace(/\{[^}]+\}/g, DUMMY);
				const r = await h.app.request(concrete, {
					method: method.toUpperCase(),
					headers: jsonHeaders(h.viewerToken),
					body: "{}",
				});
				checked += 1;
				const label = `${method.toUpperCase()} ${pathName} → ${r.status}`;
				if (isReadShaped(pathName)) {
					// Read-shaped routes must let a read-only key through the gate.
					if (r.status === 403) {
						violations.push(`${label} (read-shaped route should NOT 403)`);
					}
				} else if (r.status !== 403) {
					// Everything else must be gated (write or manage) → 403.
					violations.push(`${label} (expected 403 — route appears ungated)`);
				}
			}
		}

		expect(checked).toBeGreaterThan(5); // sanity: we actually swept routes
		expect(violations).toEqual([]);
	});
});
