/**
 * Route-level coverage for KB document CRUD + ingest under
 * `/api/v1/workspaces/{w}/knowledge-bases/{kb}/...`.
 *
 * The conformance suite exercises the contract envelope; this file
 * goes deeper: full register-→list-→update-→delete cycle, sync
 * ingest via the in-memory chunker + fake embedder + mock vector
 * driver, async ingest with job poll, chunk listing through
 * `driver.listRecords`, and the cascade delete that drops chunk
 * rows before the doc row goes away.
 */

import { randomUUID } from "node:crypto";
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

interface AppHarness {
	readonly app: ReturnType<typeof createApp>;
	readonly driver: MockVectorStoreDriver;
}

function makeApp(): AppHarness {
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
	const app = createApp({ store, drivers, secrets, auth, embedders });
	return { app, driver };
}

async function createWorkspace(harness: AppHarness): Promise<string> {
	const res = await harness.app.request("/api/v1/workspaces", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ name: "ws", kind: "mock" }),
	});
	expect(res.status).toBe(201);
	return (await json(res)).workspaceId as string;
}

async function createService(
	harness: AppHarness,
	workspaceId: string,
	path: string,
	body: Record<string, unknown>,
): Promise<string> {
	const res = await harness.app.request(
		`/api/v1/workspaces/${workspaceId}/${path}`,
		{
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(body),
		},
	);
	expect(res.status, await res.clone().text()).toBe(201);
	const j = await json(res);
	return (j.embeddingServiceId ??
		j.chunkingServiceId ??
		j.rerankingServiceId) as string;
}

/** Stand up a workspace + KB with the minimum services wired in. */
async function setupKb(harness: AppHarness): Promise<{
	ws: string;
	kbId: string;
}> {
	const ws = await createWorkspace(harness);
	const embId = await createService(harness, ws, "embedding-services", {
		name: "openai-3-small",
		provider: "openai",
		modelName: "text-embedding-3-small",
		embeddingDimension: 8,
	});
	const chunkId = await createService(harness, ws, "chunking-services", {
		name: "in-process",
		engine: "langchain_ts",
		strategy: "recursive",
		maxChunkSize: 200,
		minChunkSize: 0,
		overlapSize: 0,
	});

	const kbRes = await harness.app.request(
		`/api/v1/workspaces/${ws}/knowledge-bases`,
		{
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				name: "products",
				embeddingServiceId: embId,
				chunkingServiceId: chunkId,
			}),
		},
	);
	expect(kbRes.status, await kbRes.clone().text()).toBe(201);
	const kbId = (await json(kbRes)).knowledgeBaseId as string;
	return { ws, kbId };
}

describe("kb-documents routes", () => {
	test("POST .../documents → GET .../documents/{id} round-trips a metadata record", async () => {
		const harness = makeApp();
		const { ws, kbId } = await setupKb(harness);

		const create = await harness.app.request(
			`/api/v1/workspaces/${ws}/knowledge-bases/${kbId}/documents`,
			{
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					sourceFilename: "spec.md",
					fileType: "markdown",
					fileSize: 4096,
					metadata: { author: "alice" },
				}),
			},
		);
		expect(create.status).toBe(201);
		const doc = await json(create);
		expect(doc.workspaceId).toBe(ws);
		expect(doc.knowledgeBaseId).toBe(kbId);
		expect(doc.sourceFilename).toBe("spec.md");
		expect(doc.metadata.author).toBe("alice");

		const get = await harness.app.request(
			`/api/v1/workspaces/${ws}/knowledge-bases/${kbId}/documents/${doc.documentId}`,
		);
		expect(get.status).toBe(200);
		const fetched = await json(get);
		expect(fetched.documentId).toBe(doc.documentId);
		expect(fetched.metadata.author).toBe("alice");
	});

	test("PATCH on a document mutates fields and returns the updated row", async () => {
		const harness = makeApp();
		const { ws, kbId } = await setupKb(harness);

		const created = await json(
			await harness.app.request(
				`/api/v1/workspaces/${ws}/knowledge-bases/${kbId}/documents`,
				{
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({ sourceFilename: "old.md" }),
				},
			),
		);

		const patch = await harness.app.request(
			`/api/v1/workspaces/${ws}/knowledge-bases/${kbId}/documents/${created.documentId}`,
			{
				method: "PATCH",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					sourceFilename: "new.md",
					metadata: { reviewed: "yes" },
				}),
			},
		);
		expect(patch.status).toBe(200);
		const updated = await json(patch);
		expect(updated.sourceFilename).toBe("new.md");
		expect(updated.metadata.reviewed).toBe("yes");
	});

	test("GET .../documents lists every document in the KB", async () => {
		const harness = makeApp();
		const { ws, kbId } = await setupKb(harness);

		for (const name of ["a.md", "b.md", "c.md"]) {
			await harness.app.request(
				`/api/v1/workspaces/${ws}/knowledge-bases/${kbId}/documents`,
				{
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({ sourceFilename: name }),
				},
			);
		}

		const list = await harness.app.request(
			`/api/v1/workspaces/${ws}/knowledge-bases/${kbId}/documents`,
		);
		expect(list.status).toBe(200);
		const page = await json(list);
		expect(page.items).toHaveLength(3);
		const names = page.items
			.map((d: { sourceFilename: string }) => d.sourceFilename)
			.sort();
		expect(names).toEqual(["a.md", "b.md", "c.md"]);
	});

	test("POST .../ingest (sync) chunks + embeds + upserts and surfaces chunk count", async () => {
		const harness = makeApp();
		const { ws, kbId } = await setupKb(harness);

		const text = "alpha bravo charlie delta. ".repeat(40); // ≈ 1100 chars
		const ingest = await harness.app.request(
			`/api/v1/workspaces/${ws}/knowledge-bases/${kbId}/ingest`,
			{
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					text,
					sourceFilename: "ramble.txt",
					fileType: "text",
				}),
			},
		);
		expect(ingest.status, await ingest.clone().text()).toBe(201);
		const body = await json(ingest);
		expect(body.chunks).toBeGreaterThan(0);
		expect(body.document.status).toBe("ready");
		expect(body.document.chunkTotal).toBe(body.chunks);

		// Listing chunks back through the route returns the same number
		// of records (sorted by chunkIndex).
		const chunksRes = await harness.app.request(
			`/api/v1/workspaces/${ws}/knowledge-bases/${kbId}/documents/${body.document.documentId}/chunks`,
		);
		expect(chunksRes.status).toBe(200);
		const chunks = await json(chunksRes);
		expect(chunks).toHaveLength(body.chunks);
		expect(chunks[0].chunkIndex).toBe(0);
		expect(typeof chunks[0].text).toBe("string");
	});

	test("POST .../ingest with empty text returns 400", async () => {
		const harness = makeApp();
		const { ws, kbId } = await setupKb(harness);

		const res = await harness.app.request(
			`/api/v1/workspaces/${ws}/knowledge-bases/${kbId}/ingest`,
			{
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ text: "" }),
			},
		);
		expect(res.status).toBe(400);
	});

	test("POST .../ingest?async=true returns 202 with a job pointer", async () => {
		const harness = makeApp();
		const { ws, kbId } = await setupKb(harness);

		const res = await harness.app.request(
			`/api/v1/workspaces/${ws}/knowledge-bases/${kbId}/ingest?async=true`,
			{
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					text: "background ingest payload",
					sourceFilename: "bg.txt",
				}),
			},
		);
		expect(res.status, await res.clone().text()).toBe(202);
		const body = await json(res);
		expect(body.job.status).toMatch(/pending|running|succeeded/);
		expect(body.document.documentId).toBeTruthy();
		const expectedLocation = `/api/v1/workspaces/${ws}/jobs/${body.job.jobId}`;
		expect(res.headers.get("location")).toBe(expectedLocation);

		// Poll until the in-process worker finishes (it's fired off
		// synchronously via `void` but resolves quickly under the
		// in-memory store + fake embedder).
		let final: { status: string; processed: number } = body.job;
		for (
			let i = 0;
			i < 50 && !["succeeded", "failed"].includes(final.status);
			i++
		) {
			await new Promise((r) => setTimeout(r, 10));
			const poll = await harness.app.request(expectedLocation);
			expect(poll.status).toBe(200);
			final = await json(poll);
		}
		expect(final.status).toBe("succeeded");
		expect(final.processed).toBeGreaterThan(0);
	});

	test("DELETE .../documents/{id} cascades chunk removal then drops the row", async () => {
		const harness = makeApp();
		const { ws, kbId } = await setupKb(harness);

		const ingest = await json(
			await harness.app.request(
				`/api/v1/workspaces/${ws}/knowledge-bases/${kbId}/ingest`,
				{
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({
						text: "small body to chunk into a couple of pieces.",
						sourceFilename: "small.txt",
					}),
				},
			),
		);
		expect(ingest.chunks).toBeGreaterThan(0);
		const docId = ingest.document.documentId as string;

		// Sanity: chunks exist before delete.
		const beforeChunks = await json(
			await harness.app.request(
				`/api/v1/workspaces/${ws}/knowledge-bases/${kbId}/documents/${docId}/chunks`,
			),
		);
		expect(beforeChunks.length).toBe(ingest.chunks);

		// Delete cascades.
		const del = await harness.app.request(
			`/api/v1/workspaces/${ws}/knowledge-bases/${kbId}/documents/${docId}`,
			{ method: "DELETE" },
		);
		expect(del.status).toBe(204);

		// Doc itself is gone.
		const after = await harness.app.request(
			`/api/v1/workspaces/${ws}/knowledge-bases/${kbId}/documents/${docId}`,
		);
		expect(after.status).toBe(404);

		// And chunks are no longer reachable through the chunks route
		// (returns 404 since the doc lookup happens before the listing).
		const chunksAfter = await harness.app.request(
			`/api/v1/workspaces/${ws}/knowledge-bases/${kbId}/documents/${docId}/chunks`,
		);
		expect(chunksAfter.status).toBe(404);
	});

	test("GET .../documents/{id} for unknown document returns 404", async () => {
		const harness = makeApp();
		const { ws, kbId } = await setupKb(harness);
		const res = await harness.app.request(
			`/api/v1/workspaces/${ws}/knowledge-bases/${kbId}/documents/${randomUUID()}`,
		);
		expect(res.status).toBe(404);
	});

	test("DELETE on unknown document returns 404", async () => {
		const harness = makeApp();
		const { ws, kbId } = await setupKb(harness);
		const res = await harness.app.request(
			`/api/v1/workspaces/${ws}/knowledge-bases/${kbId}/documents/${randomUUID()}`,
			{ method: "DELETE" },
		);
		expect(res.status).toBe(404);
	});

	test("ingest into unknown KB returns 404", async () => {
		const harness = makeApp();
		const ws = await createWorkspace(harness);
		const res = await harness.app.request(
			`/api/v1/workspaces/${ws}/knowledge-bases/${randomUUID()}/ingest`,
			{
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ text: "something" }),
			},
		);
		expect(res.status).toBe(404);
	});
});
