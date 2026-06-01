/**
 * Auth scopes P1 — the route → fine-scope resolver and its enforcement.
 *
 * `manage-route-scope.test.ts` is the *legacy* regression sweep (the
 * three role sets behave exactly as in 0.4.x). This file pins the new
 * surface: the path → fine-scope mapping, and that a *narrowly*-scoped
 * key reaches only its own facet (a `write:ingest` key can ingest but
 * not create a KB; a `manage:keys` key can mint keys but not administer
 * RLAC). Both rest on P0's containment primitive.
 */

import { describe, expect, test } from "vitest";
import { createApp } from "../../src/app.js";
import { mintToken } from "../../src/auth/apiKey/token.js";
import { ApiKeyVerifier } from "../../src/auth/apiKey/verifier.js";
import {
	manageScopeForRoute,
	writeScopeForRoute,
} from "../../src/auth/authz.js";
import { AuthResolver } from "../../src/auth/resolver.js";
import { MemoryControlPlaneStore } from "../../src/control-plane/memory/store.js";
import type { ApiKeyScope } from "../../src/control-plane/types.js";
import { MockVectorStoreDriver } from "../../src/drivers/mock/store.js";
import { VectorStoreDriverRegistry } from "../../src/drivers/registry.js";
import { EnvSecretProvider } from "../../src/secrets/env.js";
import { SecretResolver } from "../../src/secrets/provider.js";
import { makeFakeEmbedderFactory } from "../helpers/embedder.js";

const W = "/api/v1/workspaces/ws";

describe("writeScopeForRoute — write-content routes map under the write tier", () => {
	test("content / structure / infra / agents / fallback", () => {
		expect(writeScopeForRoute(`${W}/knowledge-bases/kb/ingest`)).toBe(
			"write:ingest",
		);
		expect(writeScopeForRoute(`${W}/knowledge-bases/kb/ingest/file`)).toBe(
			"write:ingest",
		);
		expect(writeScopeForRoute(`${W}/knowledge-bases/kb/documents/d`)).toBe(
			"write:ingest",
		);
		expect(writeScopeForRoute(`${W}/knowledge-bases/kb/records`)).toBe(
			"write:ingest",
		);
		expect(writeScopeForRoute(`${W}/knowledge-bases/kb`)).toBe("write:kb");
		expect(writeScopeForRoute(`${W}/knowledge-bases/kb/filters/f`)).toBe(
			"write:kb",
		);
		expect(writeScopeForRoute(`${W}/embedding-services/e`)).toBe(
			"write:services",
		);
		expect(writeScopeForRoute(`${W}/mcp-servers/m`)).toBe("write:services");
		expect(writeScopeForRoute(`${W}/agents/a`)).toBe("write:agents");
		// Workspace rename (unmatched mutating path) → coarse floor.
		expect(writeScopeForRoute(W)).toBe("write");
	});
});

describe("manageScopeForRoute — admin routes map under the manage tier", () => {
	test("keys / access / workspace", () => {
		expect(manageScopeForRoute(`${W}/api-keys`)).toBe("manage:keys");
		expect(manageScopeForRoute(`${W}/principals/alice`)).toBe("manage:access");
		expect(manageScopeForRoute(`${W}/policy/audit`)).toBe("manage:access");
		// Workspace destroy (no sub-resource).
		expect(manageScopeForRoute(W)).toBe("manage:workspace");
	});
});

async function makeHarness() {
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
	});
	const ws = await store.createWorkspace({ name: "ws", kind: "mock" });
	let n = 0;
	const mint = async (scopes: readonly ApiKeyScope[]): Promise<string> => {
		const minted = await mintToken();
		n += 1;
		await store.persistApiKey(ws.uid, {
			keyId: `00000000-0000-0000-0000-0000000000${String(n).padStart(2, "0")}`,
			prefix: minted.prefix,
			hash: minted.hash,
			label: `k${n}`,
			scopes,
		});
		return minted.plaintext;
	};
	return { app, workspace: ws.uid, mint };
}

const auth = (t: string) => ({ authorization: `Bearer ${t}` });
const json = (t: string) => ({
	"content-type": "application/json",
	...auth(t),
});

describe("fine-grained scope gates (end-to-end)", () => {
	test("a write:ingest key reaches ingest but not KB creation or key issuance", async () => {
		const h = await makeHarness();
		const token = await h.mint(["read", "write:ingest"]);

		// write:kb route — rejected (sibling facet).
		const kb = await h.app.request(
			`/api/v1/workspaces/${h.workspace}/knowledge-bases`,
			{
				method: "POST",
				headers: json(token),
				body: JSON.stringify({
					name: "kb",
					embeddingServiceId: "00000000-0000-4000-8000-000000000100",
					chunkingServiceId: "00000000-0000-4000-8000-000000000101",
				}),
			},
		);
		expect(kb.status).toBe(403);

		// manage:keys route — rejected.
		const key = await h.app.request(
			`/api/v1/workspaces/${h.workspace}/api-keys`,
			{
				method: "POST",
				headers: json(token),
				body: JSON.stringify({ label: "x" }),
			},
		);
		expect(key.status).toBe(403);

		// write:ingest route — the scope gate passes (a missing KB 404s
		// downstream, but it is NOT a scope rejection).
		const ingest = await h.app.request(
			`/api/v1/workspaces/${h.workspace}/knowledge-bases/00000000-0000-4000-8000-0000000000aa/ingest`,
			{
				method: "POST",
				headers: json(token),
				body: JSON.stringify({ text: "hi" }),
			},
		);
		expect(ingest.status).not.toBe(403);
	});

	test("a write:kb key reaches KB creation but not ingest", async () => {
		const h = await makeHarness();
		const token = await h.mint(["read", "write:kb"]);
		const ingest = await h.app.request(
			`/api/v1/workspaces/${h.workspace}/knowledge-bases/00000000-0000-4000-8000-0000000000aa/ingest`,
			{
				method: "POST",
				headers: json(token),
				body: JSON.stringify({ text: "hi" }),
			},
		);
		expect(ingest.status).toBe(403);
	});

	test("a manage:keys key can mint keys but not administer principals", async () => {
		const h = await makeHarness();
		const token = await h.mint(["manage:keys"]);

		const key = await h.app.request(
			`/api/v1/workspaces/${h.workspace}/api-keys`,
			{
				method: "POST",
				headers: json(token),
				body: JSON.stringify({ label: "minted-by-narrow-key" }),
			},
		);
		expect(key.status).toBe(201);

		const principal = await h.app.request(
			`/api/v1/workspaces/${h.workspace}/principals`,
			{
				method: "POST",
				headers: json(token),
				body: JSON.stringify({ principalId: "alice" }),
			},
		);
		expect(principal.status).toBe(403);
	});
});
