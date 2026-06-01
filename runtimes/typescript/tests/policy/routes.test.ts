/**
 * Route-level tests for the RLAC HTTP surface:
 *   - principal CRUD
 *   - policy compile-preview
 *   - policy audit list
 *   - KB documents filtered by the enforcer when policy is enabled
 *
 * These exercise the full Hono stack the way the SPA does — request
 * in, JSON envelope out — and confirm the enforcer wires through to
 * `/api/v1/.../documents` correctly.
 */

import { describe, expect, test } from "vitest";
import { createApp } from "../../src/app.js";
import { AuthResolver } from "../../src/auth/resolver.js";
import { MemoryControlPlaneStore } from "../../src/control-plane/memory/store.js";
import type { ControlPlaneStore } from "../../src/control-plane/store.js";
import { MockVectorStoreDriver } from "../../src/drivers/mock/store.js";
import { VectorStoreDriverRegistry } from "../../src/drivers/registry.js";
import { EnvSecretProvider } from "../../src/secrets/env.js";
import { SecretResolver } from "../../src/secrets/provider.js";
import { makeFakeEmbedderFactory } from "../helpers/embedder.js";

interface TestApp {
	readonly app: ReturnType<typeof createApp>;
	readonly store: ControlPlaneStore;
}

function makeTestApp(): TestApp {
	const store = new MemoryControlPlaneStore();
	const driver = new MockVectorStoreDriver();
	const drivers = new VectorStoreDriverRegistry(new Map([["mock", driver]]));
	const secrets = new SecretResolver({ env: new EnvSecretProvider() });
	const auth = new AuthResolver({
		mode: "disabled",
		anonymousPolicy: "allow",
		verifiers: [],
	});
	const app = createApp({
		store,
		drivers,
		secrets,
		auth,
		embedders: makeFakeEmbedderFactory(),
	});
	return { app, store };
}

async function seedWorkspace(store: ControlPlaneStore): Promise<{
	workspaceId: string;
	knowledgeBaseId: string;
}> {
	const ws = await store.createWorkspace({
		name: "rlac-tests",
		kind: "mock",
		url: null,
		credentials: {},
		keyspace: null,
	});
	const chunking = await store.createChunkingService(ws.uid, {
		name: "chunker",
		engine: "langchain_ts",
	});
	const embedding = await store.createEmbeddingService(ws.uid, {
		name: "embedder",
		provider: "openai",
		modelName: "text-embedding-3-small",
		embeddingDimension: 1536,
		distanceMetric: "cosine",
	});
	const kb = await store.createKnowledgeBase(ws.uid, {
		name: "mixed-docs",
		chunkingServiceId: chunking.chunkingServiceId,
		embeddingServiceId: embedding.embeddingServiceId,
	});
	return { workspaceId: ws.uid, knowledgeBaseId: kb.knowledgeBaseId };
}

describe("RLAC routes — principals CRUD", () => {
	test("create / list / get / patch / delete a principal", async () => {
		const { app, store } = makeTestApp();
		const { workspaceId } = await seedWorkspace(store);

		const created = await app.request(
			`/api/v1/workspaces/${workspaceId}/principals`,
			{
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					principalId: "alice",
					label: "Alice",
					attributes: { role: "viewer" },
				}),
			},
		);
		expect(created.status).toBe(201);
		const createdBody = (await created.json()) as { principalId: string };
		expect(createdBody.principalId).toBe("alice");

		const listed = await app.request(
			`/api/v1/workspaces/${workspaceId}/principals`,
		);
		expect(listed.status).toBe(200);
		const listedBody = (await listed.json()) as {
			items: Array<{ principalId: string }>;
		};
		expect(listedBody.items.map((p) => p.principalId)).toEqual(["alice"]);

		const got = await app.request(
			`/api/v1/workspaces/${workspaceId}/principals/alice`,
		);
		expect(got.status).toBe(200);

		const patched = await app.request(
			`/api/v1/workspaces/${workspaceId}/principals/alice`,
			{
				method: "PATCH",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ label: "Alice A." }),
			},
		);
		expect(patched.status).toBe(200);
		const patchedBody = (await patched.json()) as { label: string };
		expect(patchedBody.label).toBe("Alice A.");

		const deleted = await app.request(
			`/api/v1/workspaces/${workspaceId}/principals/alice`,
			{ method: "DELETE" },
		);
		expect(deleted.status).toBe(204);
	});

	test("RBAC role defaults to viewer and round-trips an explicit role", async () => {
		const { app, store } = makeTestApp();
		const { workspaceId } = await seedWorkspace(store);

		// Omitting `role` defaults to the viewer floor.
		const def = await app.request(
			`/api/v1/workspaces/${workspaceId}/principals`,
			{
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ principalId: "viewer-default" }),
			},
		);
		expect(def.status).toBe(201);
		expect(((await def.json()) as { role: string }).role).toBe("viewer");

		// An explicit role persists and is returned on create.
		const admin = await app.request(
			`/api/v1/workspaces/${workspaceId}/principals`,
			{
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ principalId: "ada", role: "admin" }),
			},
		);
		expect(admin.status).toBe(201);
		expect(((await admin.json()) as { role: string }).role).toBe("admin");

		// PATCH updates the role.
		const patched = await app.request(
			`/api/v1/workspaces/${workspaceId}/principals/ada`,
			{
				method: "PATCH",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ role: "editor" }),
			},
		);
		expect(patched.status).toBe(200);
		expect(((await patched.json()) as { role: string }).role).toBe("editor");

		// An unknown role is rejected by the schema.
		const bad = await app.request(
			`/api/v1/workspaces/${workspaceId}/principals`,
			{
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ principalId: "nope", role: "superadmin" }),
			},
		);
		expect(bad.status).toBe(400);
	});

	test("creating a duplicate principal returns 409", async () => {
		const { app, store } = makeTestApp();
		const { workspaceId } = await seedWorkspace(store);
		await app.request(`/api/v1/workspaces/${workspaceId}/principals`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ principalId: "alice" }),
		});
		const second = await app.request(
			`/api/v1/workspaces/${workspaceId}/principals`,
			{
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ principalId: "alice" }),
			},
		);
		expect(second.status).toBe(409);
	});
});

describe("RLAC routes — policy compile-preview", () => {
	test("returns parsed filter for canonical DSL with a principal", async () => {
		const { app, store } = makeTestApp();
		const { workspaceId } = await seedWorkspace(store);
		await app.request(`/api/v1/workspaces/${workspaceId}/principals`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ principalId: "alice" }),
		});
		const res = await app.request(
			`/api/v1/workspaces/${workspaceId}/policy/compile-preview`,
			{
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					dsl: "current_principal_id() = ANY(visible_to) OR '*' = ANY(visible_to)",
					principalId: "alice",
				}),
			},
		);
		expect(res.status).toBe(200);
		const body = (await res.json()) as {
			ok: boolean;
			parseError: string | null;
			issues: unknown[];
			compiledFilter: unknown;
			principalId: string | null;
		};
		expect(body.ok).toBe(true);
		expect(body.parseError).toBeNull();
		expect(body.issues).toEqual([]);
		expect(body.principalId).toBe("alice");
		expect(body.compiledFilter).toEqual({
			$or: [{ visible_to: "alice" }, { visible_to: "*" }],
		});
	});

	test("flags translatability gaps", async () => {
		const { app, store } = makeTestApp();
		const { workspaceId } = await seedWorkspace(store);
		const res = await app.request(
			`/api/v1/workspaces/${workspaceId}/policy/compile-preview`,
			{
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ dsl: "owner_id = parent_id" }),
			},
		);
		expect(res.status).toBe(200);
		const body = (await res.json()) as {
			ok: boolean;
			issues: Array<{ code: string }>;
		};
		expect(body.ok).toBe(false);
		expect(body.issues.map((i) => i.code)).toContain("row_to_row_comparison");
	});

	test("returns parseError for garbage DSL", async () => {
		const { app, store } = makeTestApp();
		const { workspaceId } = await seedWorkspace(store);
		const res = await app.request(
			`/api/v1/workspaces/${workspaceId}/policy/compile-preview`,
			{
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ dsl: "@@@" }),
			},
		);
		expect(res.status).toBe(200);
		const body = (await res.json()) as {
			ok: boolean;
			parseError: string | null;
		};
		expect(body.ok).toBe(false);
		expect(body.parseError).toMatch(/policy parse error/);
	});
});

describe("RLAC routes — KB documents enforced by policy", () => {
	async function setupPolicyEnabledKb(): Promise<{
		app: ReturnType<typeof createApp>;
		store: ControlPlaneStore;
		workspaceId: string;
		knowledgeBaseId: string;
	}> {
		const { app, store } = makeTestApp();
		const { workspaceId, knowledgeBaseId } = await seedWorkspace(store);
		// Enable RLAC at the workspace level.
		await app.request(`/api/v1/workspaces/${workspaceId}`, {
			method: "PATCH",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ rlacEnabled: true }),
		});
		// Enable policy on the KB via the PATCH route.
		await app.request(
			`/api/v1/workspaces/${workspaceId}/knowledge-bases/${knowledgeBaseId}`,
			{
				method: "PATCH",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					policyDsl:
						"current_principal_id() = ANY(visible_to) OR '*' = ANY(visible_to)",
					policyEnabled: true,
				}),
			},
		);
		// Seed alice + bob, then docs with mixed visibility.
		for (const principalId of ["alice", "bob"]) {
			await app.request(`/api/v1/workspaces/${workspaceId}/principals`, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ principalId }),
			});
		}
		const seeds: Array<{ name: string; visibleTo: string[] }> = [
			{ name: "public.md", visibleTo: ["*"] },
			{ name: "alice-only.md", visibleTo: ["alice"] },
			{ name: "bob-only.md", visibleTo: ["bob"] },
		];
		for (const seed of seeds) {
			await store.createRagDocument(workspaceId, knowledgeBaseId, {
				sourceFilename: seed.name,
				visibleTo: seed.visibleTo,
				ownerPrincipalId: seed.visibleTo[0] ?? null,
			});
		}
		return { app, store, workspaceId, knowledgeBaseId };
	}

	test("filters list by visible_to when view-as supplied (auth.mode=disabled, no WB_DEV_MODE)", async () => {
		// Regression: this test previously set `WB_DEV_MODE=1` to opt in
		// to the view-as header, which masked the bug where the
		// `disabled` auth-mode quickstart ignored the header entirely
		// and trapped the user in `policy_principal_required`. The
		// resolver now honors view-as whenever there's no auth subject;
		// production deployments use `apiKey` / `oidc` and aren't
		// affected. Keep `WB_DEV_MODE` unset here so a future regression
		// surfaces immediately.
		expect(process.env.WB_DEV_MODE).not.toBe("1");
		const { app, workspaceId, knowledgeBaseId } = await setupPolicyEnabledKb();
		const aliceRes = await app.request(
			`/api/v1/workspaces/${workspaceId}/knowledge-bases/${knowledgeBaseId}/documents`,
			{ headers: { "x-view-as-principal": "alice" } },
		);
		expect(aliceRes.status).toBe(200);
		const aliceBody = (await aliceRes.json()) as {
			items: Array<{ sourceFilename: string | null }>;
		};
		expect(aliceBody.items.map((d) => d.sourceFilename).sort()).toEqual([
			"alice-only.md",
			"public.md",
		]);

		const bobRes = await app.request(
			`/api/v1/workspaces/${workspaceId}/knowledge-bases/${knowledgeBaseId}/documents`,
			{ headers: { "x-view-as-principal": "bob" } },
		);
		expect(bobRes.status).toBe(200);
		const bobBody = (await bobRes.json()) as {
			items: Array<{ sourceFilename: string | null }>;
		};
		expect(bobBody.items.map((d) => d.sourceFilename).sort()).toEqual([
			"bob-only.md",
			"public.md",
		]);
	});

	test("returns 401 when policy is enabled but no principal is resolvable", async () => {
		const { app, workspaceId, knowledgeBaseId } = await setupPolicyEnabledKb();
		// No view-as header, no auth. Disabled auth → anonymous → no
		// principal resolved → policy denies.
		const res = await app.request(
			`/api/v1/workspaces/${workspaceId}/knowledge-bases/${knowledgeBaseId}/documents`,
		);
		expect(res.status).toBe(401);
		const body = (await res.json()) as { error: { code: string } };
		expect(body.error.code).toBe("policy_principal_required");
	});

	test("search merges policy filter into the body filter when policy is enabled", async () => {
		try {
			const { app, workspaceId, knowledgeBaseId } =
				await setupPolicyEnabledKb();
			// Drive a search; the mock vector driver returns whatever was
			// passed to it, so we don't need to assert ranking — we assert
			// the route accepted the request and wrote an audit decision
			// with the compiled filter.
			const searchRes = await app.request(
				`/api/v1/workspaces/${workspaceId}/knowledge-bases/${knowledgeBaseId}/search`,
				{
					method: "POST",
					headers: {
						"content-type": "application/json",
						"x-view-as-principal": "alice",
					},
					body: JSON.stringify({ vector: [0.1, 0.2, 0.3], topK: 5 }),
				},
			);
			// Search may legitimately 4xx/503 in this test harness (the
			// mock vector store + missing driver registry for the mock
			// kind), but the route ran the enforcer first — the audit
			// invariant is what we care about here.
			expect([200, 400, 404, 503]).toContain(searchRes.status);
			const auditRes = await app.request(
				`/api/v1/workspaces/${workspaceId}/policy/audit`,
			);
			const auditBody = (await auditRes.json()) as {
				items: Array<{
					principalId: string | null;
					action: string;
					decision: string;
					compiledFilterJson: string | null;
				}>;
			};
			const searchAudit = auditBody.items.find(
				(a) => a.action === "search" && a.principalId === "alice",
			);
			expect(searchAudit).toBeDefined();
			expect(searchAudit?.decision).toBe("filter");
			expect(searchAudit?.compiledFilterJson).toContain('"visible_to"');
			expect(searchAudit?.compiledFilterJson).toContain('"alice"');
		} finally {
			// no-op: the try/finally wrapper used to delete WB_DEV_MODE,
			// which is no longer required to make view-as work.
		}
	});

	test("search returns 401 when no principal context exists and policy is enabled", async () => {
		const { app, workspaceId, knowledgeBaseId } = await setupPolicyEnabledKb();
		const res = await app.request(
			`/api/v1/workspaces/${workspaceId}/knowledge-bases/${knowledgeBaseId}/search`,
			{
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ vector: [0.1, 0.2, 0.3], topK: 5 }),
			},
		);
		expect(res.status).toBe(401);
		const body = (await res.json()) as { error: { code: string } };
		expect(body.error.code).toBe("policy_principal_required");
	});

	test("audit endpoint surfaces decisions made during a request", async () => {
		const { app, workspaceId, knowledgeBaseId } = await setupPolicyEnabledKb();
		await app.request(
			`/api/v1/workspaces/${workspaceId}/knowledge-bases/${knowledgeBaseId}/documents`,
			{ headers: { "x-view-as-principal": "alice" } },
		);
		const auditRes = await app.request(
			`/api/v1/workspaces/${workspaceId}/policy/audit`,
		);
		expect(auditRes.status).toBe(200);
		const auditBody = (await auditRes.json()) as {
			items: Array<{
				principalId: string | null;
				decision: string;
				action: string;
			}>;
		};
		const filtered = auditBody.items.filter((a) => a.principalId === "alice");
		expect(filtered.length).toBeGreaterThan(0);
		expect(filtered[0]?.decision).toBe("filter");
		expect(filtered[0]?.action).toBe("list");
	});

	test("HTTP DELETE of a doc the view-as principal can't see is rejected by the route", async () => {
		// Closes the residual RLAC gap: mutation enforcement was
		// unit-tested at the enforcer level (`enforcer.integration.test.ts`)
		// but never driven through the actual Hono route. This test runs
		// the full request stack — view-as resolution → workspace authz →
		// enforcer.assertMutation → route handler — and asserts the
		// response is 4xx, not 200/204, when alice tries to delete a
		// document marked visible_to=["bob"]. The doc must still exist
		// in the store afterward.
		const { app, store, workspaceId, knowledgeBaseId } =
			await setupPolicyEnabledKb();
		const all = await store.listRagDocuments(workspaceId, knowledgeBaseId);
		const bobOnly = all.find((d) => d.sourceFilename === "bob-only.md");
		expect(bobOnly).toBeDefined();

		const deleteAsAlice = await app.request(
			`/api/v1/workspaces/${workspaceId}/knowledge-bases/${knowledgeBaseId}/documents/${bobOnly?.documentId}`,
			{
				method: "DELETE",
				headers: { "x-view-as-principal": "alice" },
			},
		);
		// 403 (forbidden) or 404 (filtered to invisible) are both correct
		// outcomes — the only wrong outcome is a 2xx (mutation succeeded).
		expect(deleteAsAlice.status).toBeGreaterThanOrEqual(400);
		expect(deleteAsAlice.status).toBeLessThan(500);

		// The document must still exist after the rejected mutation.
		const stillThere = await store.listRagDocuments(
			workspaceId,
			knowledgeBaseId,
		);
		expect(
			stillThere.find((d) => d.documentId === bobOnly?.documentId),
		).toBeDefined();

		// And the rejection must show up in the audit log as a deny on
		// alice's account, not just a silent 4xx.
		const auditRes = await app.request(
			`/api/v1/workspaces/${workspaceId}/policy/audit`,
		);
		const auditBody = (await auditRes.json()) as {
			items: Array<{
				principalId: string | null;
				action: string;
				decision: string;
			}>;
		};
		const denies = auditBody.items.filter(
			(a) => a.principalId === "alice" && a.decision === "deny",
		);
		expect(denies.length).toBeGreaterThan(0);
	});

	// RLAC-enabled KB created through the HTTP route so the mock vector
	// collection is actually provisioned — required for ingest (unlike the
	// metadata-only `setupPolicyEnabledKb`, which seeds rows directly).
	async function setupIngestableRlacKb(): Promise<{
		app: ReturnType<typeof createApp>;
		workspaceId: string;
		knowledgeBaseId: string;
	}> {
		const { app, store } = makeTestApp();
		const ws = await store.createWorkspace({
			name: "rlac-ingest",
			kind: "mock",
			url: null,
			credentials: {},
			keyspace: null,
		});
		await app.request(`/api/v1/workspaces/${ws.uid}`, {
			method: "PATCH",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ rlacEnabled: true }),
		});
		const chunking = await store.createChunkingService(ws.uid, {
			name: "chunker",
			engine: "langchain_ts",
		});
		const embedding = await store.createEmbeddingService(ws.uid, {
			name: "embedder",
			provider: "mock",
			modelName: "mock",
			embeddingDimension: 4,
		});
		const kbRes = await app.request(
			`/api/v1/workspaces/${ws.uid}/knowledge-bases`,
			{
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					name: "docs",
					chunkingServiceId: chunking.chunkingServiceId,
					embeddingServiceId: embedding.embeddingServiceId,
				}),
			},
		);
		const kb = (await kbRes.json()) as { knowledgeBaseId: string };
		await app.request(
			`/api/v1/workspaces/${ws.uid}/knowledge-bases/${kb.knowledgeBaseId}`,
			{
				method: "PATCH",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					policyDsl:
						"current_principal_id() = ANY(visible_to) OR '*' = ANY(visible_to)",
					policyEnabled: true,
				}),
			},
		);
		for (const principalId of ["alice", "bob"]) {
			await app.request(`/api/v1/workspaces/${ws.uid}/principals`, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ principalId }),
			});
		}
		return { app, workspaceId: ws.uid, knowledgeBaseId: kb.knowledgeBaseId };
	}

	test("chunk listing is enforced: only a principal who can see the doc reads its chunks", async () => {
		const { app, workspaceId, knowledgeBaseId } = await setupIngestableRlacKb();
		// Ingest as alice → the doc defaults to visible_to=["alice"] and its
		// chunks are stamped to match.
		const ingest = await app.request(
			`/api/v1/workspaces/${workspaceId}/knowledge-bases/${knowledgeBaseId}/ingest`,
			{
				method: "POST",
				headers: {
					"content-type": "application/json",
					"x-view-as-principal": "alice",
				},
				body: JSON.stringify({
					text: "alpha bravo charlie delta echo foxtrot",
				}),
			},
		);
		expect(ingest.status, await ingest.clone().text()).toBe(201);
		const documentId = (
			(await ingest.json()) as { document: { documentId: string } }
		).document.documentId;
		const chunksUrl = `/api/v1/workspaces/${workspaceId}/knowledge-bases/${knowledgeBaseId}/documents/${documentId}/chunks`;

		// alice (the owner) can read the chunks.
		const asAlice = await app.request(chunksUrl, {
			headers: { "x-view-as-principal": "alice" },
		});
		expect(asAlice.status).toBe(200);
		expect(((await asAlice.json()) as unknown[]).length).toBeGreaterThan(0);

		// bob cannot — 404, matching the document-get path (the row
		// "doesn't exist" to him).
		const asBob = await app.request(chunksUrl, {
			headers: { "x-view-as-principal": "bob" },
		});
		expect(asBob.status).toBe(404);

		// No principal at all + policy enabled → 401.
		const anon = await app.request(chunksUrl);
		expect(anon.status).toBe(401);
		expect(
			((await anon.json()) as { error: { code: string } }).error.code,
		).toBe("policy_principal_required");
	});

	test("PATCH visibleTo re-tags the document's chunks in the data plane", async () => {
		const { app, workspaceId, knowledgeBaseId } = await setupIngestableRlacKb();
		// Ingest as alice → chunks visible to alice only.
		const ingest = await app.request(
			`/api/v1/workspaces/${workspaceId}/knowledge-bases/${knowledgeBaseId}/ingest`,
			{
				method: "POST",
				headers: {
					"content-type": "application/json",
					"x-view-as-principal": "alice",
				},
				body: JSON.stringify({ text: "alpha bravo charlie delta echo" }),
			},
		);
		expect(ingest.status).toBe(201);
		const documentId = (
			(await ingest.json()) as { document: { documentId: string } }
		).document.documentId;
		const chunksUrl = `/api/v1/workspaces/${workspaceId}/knowledge-bases/${knowledgeBaseId}/documents/${documentId}/chunks`;

		// Initially bob can't read the chunks.
		expect(
			(
				await app.request(chunksUrl, {
					headers: { "x-view-as-principal": "bob" },
				})
			).status,
		).toBe(404);

		// alice broadens visibility to include bob.
		const patch = await app.request(
			`/api/v1/workspaces/${workspaceId}/knowledge-bases/${knowledgeBaseId}/documents/${documentId}`,
			{
				method: "PATCH",
				headers: {
					"content-type": "application/json",
					"x-view-as-principal": "alice",
				},
				body: JSON.stringify({ visibleTo: ["alice", "bob"] }),
			},
		);
		expect(patch.status, await patch.clone().text()).toBe(200);

		// The chunks were re-tagged: bob can now read them, and the chunk
		// payloads carry the broadened set.
		const asBob = await app.request(chunksUrl, {
			headers: { "x-view-as-principal": "bob" },
		});
		expect(asBob.status).toBe(200);
		const chunks = (await asBob.json()) as Array<{
			payload: { visible_to?: string[] };
		}>;
		expect(chunks.length).toBeGreaterThan(0);
		for (const ch of chunks) {
			expect(new Set(ch.payload.visible_to)).toEqual(new Set(["alice", "bob"]));
		}
	});
});
