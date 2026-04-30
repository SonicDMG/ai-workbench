/**
 * Route-level coverage for `/api/v1/workspaces/{w}/jobs/{jobId}`.
 *
 * The SSE `/events` route is exercised end-to-end through the ingest
 * pipeline (knowledge-bases.test.ts); this file focuses on the polling
 * GET — happy path, 404, and the workspace-isolation guard that keeps
 * a scoped token from reading another tenant's job.
 */

import { randomUUID } from "node:crypto";
import { describe, expect, test } from "vitest";
import { createApp } from "../src/app.js";
import { mintToken } from "../src/auth/apiKey/token.js";
import { ApiKeyVerifier } from "../src/auth/apiKey/verifier.js";
import { AuthResolver } from "../src/auth/resolver.js";
import { MemoryControlPlaneStore } from "../src/control-plane/memory/store.js";
import { MockVectorStoreDriver } from "../src/drivers/mock/store.js";
import { VectorStoreDriverRegistry } from "../src/drivers/registry.js";
import { MemoryJobStore } from "../src/jobs/memory-store.js";
import { EnvSecretProvider } from "../src/secrets/env.js";
import { SecretResolver } from "../src/secrets/provider.js";
import { makeFakeEmbedderFactory } from "./helpers/embedder.js";

// biome-ignore lint/suspicious/noExplicitAny: test helper returns untyped JSON
async function json(res: Response): Promise<any> {
	// biome-ignore lint/suspicious/noExplicitAny: test helper returns untyped JSON
	return (await res.json()) as any;
}

interface Harness {
	readonly app: ReturnType<typeof createApp>;
	readonly store: MemoryControlPlaneStore;
	readonly jobs: MemoryJobStore;
}

function makeHarness(opts?: { authMode?: "disabled" | "apiKey" }): Harness {
	const store = new MemoryControlPlaneStore();
	const driver = new MockVectorStoreDriver();
	const drivers = new VectorStoreDriverRegistry(new Map([["mock", driver]]));
	const secrets = new SecretResolver({ env: new EnvSecretProvider() });
	const mode = opts?.authMode ?? "disabled";
	const auth = new AuthResolver({
		mode,
		anonymousPolicy: mode === "apiKey" ? "reject" : "allow",
		verifiers: mode === "apiKey" ? [new ApiKeyVerifier({ store })] : [],
	});
	const embedders = makeFakeEmbedderFactory();
	const jobs = new MemoryJobStore();
	const app = createApp({ store, drivers, secrets, auth, embedders, jobs });
	return { app, store, jobs };
}

async function createWorkspace(h: Harness): Promise<string> {
	const res = await h.app.request("/api/v1/workspaces", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ name: "ws", kind: "mock" }),
	});
	expect(res.status).toBe(201);
	return (await json(res)).workspaceId;
}

describe("jobs route — GET /jobs/{jobId}", () => {
	test("returns the job record when the workspace owns it", async () => {
		const h = makeHarness();
		const ws = await createWorkspace(h);
		const job = await h.jobs.create({
			workspace: ws,
			kind: "ingest",
			jobId: randomUUID(),
			knowledgeBaseId: randomUUID(),
			documentId: randomUUID(),
			total: 4,
		});

		const res = await h.app.request(
			`/api/v1/workspaces/${ws}/jobs/${job.jobId}`,
		);
		expect(res.status).toBe(200);
		const body = await json(res);
		expect(body.jobId).toBe(job.jobId);
		expect(body.status).toBe("pending");
		expect(body.kind).toBe("ingest");
	});

	test("returns 404 when the jobId is unknown to the workspace", async () => {
		const h = makeHarness();
		const ws = await createWorkspace(h);
		const res = await h.app.request(
			`/api/v1/workspaces/${ws}/jobs/00000000-0000-0000-0000-000000000000`,
		);
		expect(res.status).toBe(404);
		const body = await json(res);
		expect(body.error.code).toBe("job_not_found");
	});

	test("isolates jobs between workspaces — wsB cannot read wsA's job", async () => {
		const h = makeHarness();
		const wsA = await createWorkspace(h);
		// Create a second workspace under a different name.
		const wsBRes = await h.app.request("/api/v1/workspaces", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ name: "ws-b", kind: "mock" }),
		});
		expect(wsBRes.status).toBe(201);
		const wsB = (await json(wsBRes)).workspaceId;

		const job = await h.jobs.create({
			workspace: wsA,
			kind: "ingest",
			jobId: randomUUID(),
			knowledgeBaseId: null,
			documentId: null,
			total: null,
		});

		// wsA can fetch.
		const okRes = await h.app.request(
			`/api/v1/workspaces/${wsA}/jobs/${job.jobId}`,
		);
		expect(okRes.status).toBe(200);

		// wsB asking for the same jobId is treated as not-found, not as
		// a leak — the route scopes by (workspace, jobId).
		const isolatedRes = await h.app.request(
			`/api/v1/workspaces/${wsB}/jobs/${job.jobId}`,
		);
		expect(isolatedRes.status).toBe(404);
	});

	test("invalid jobId UUID is rejected with 400", async () => {
		const h = makeHarness();
		const ws = await createWorkspace(h);
		const res = await h.app.request(`/api/v1/workspaces/${ws}/jobs/not-a-uuid`);
		expect(res.status).toBe(400);
	});

	test("scoped API-key cannot read jobs from a workspace it doesn't own", async () => {
		const h = makeHarness({ authMode: "apiKey" });
		// Two workspaces and a key scoped only to A.
		const wsA = await h.store.createWorkspace({ name: "a", kind: "mock" });
		const wsB = await h.store.createWorkspace({ name: "b", kind: "mock" });
		const minted = await mintToken();
		await h.store.persistApiKey(wsA.uid, {
			keyId: randomUUID(),
			prefix: minted.prefix,
			hash: minted.hash,
			label: "scoped-to-a",
		});

		const job = await h.jobs.create({
			workspace: wsB.uid,
			kind: "ingest",
			jobId: randomUUID(),
			knowledgeBaseId: null,
			documentId: null,
			total: null,
		});

		const res = await h.app.request(
			`/api/v1/workspaces/${wsB.uid}/jobs/${job.jobId}`,
			{ headers: { authorization: `Bearer ${minted.plaintext}` } },
		);
		expect(res.status).toBe(403);
	});
});
