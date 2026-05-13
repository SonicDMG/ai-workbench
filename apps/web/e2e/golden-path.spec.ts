import { expect, test } from "@playwright/test";

// End-to-end golden path:
//
//   onboarding → workspace (mock) → embedding service → chunking
//   service → knowledge base → upsert vector records → playground
//   vector query → hits → upsert text records → playground text query
//   → hits.
//
// The text-lane coverage uses `embedding.provider: "mock"`, which the
// production embedder factory now resolves to a deterministic
// FNV-hash embedder (see runtimes/typescript/src/embeddings/factory.ts).
// Same opt-in shape as the mock vector store driver — operators
// who flip a real workspace to provider:"mock" are explicitly
// opting out of real retrieval, but the seam lets E2E exercise the
// full embed-then-search dispatch without provisioning credentials.
//
// The runtime is memory-backed (default workbench.yaml). State does
// not persist between specs.
//
// Project-level `fullyParallel: false, workers: 1` in playwright.config.ts
// already enforces serial execution; calling
// `test.describe.configure({ mode: "serial" })` here would conflict with
// a future second spec that doesn't have the same call (Playwright
// disallows mixing) — hence not pinned at the file level.

test("golden path: onboard → services → knowledge base → upsert → run query", async ({
	page,
	request,
}, testInfo) => {
	const workspaceName = `e2e-golden-${testInfo.workerIndex}-${Date.now()}`;

	// 1. Start the onboarding flow directly. Local runs may reuse an
	//    already-running dev server with existing workspaces, so `/`
	//    is not guaranteed to be a first-run redirect.
	await page.goto("/onboarding");
	await expect(
		page.getByRole("heading", { name: "Choose a backend" }),
	).toBeVisible();

	// 2. Pick Mock, then proceed to details.
	await page.getByRole("button", { name: /Mock/ }).click();
	await page.getByRole("button", { name: "Continue" }).click();
	await expect(
		page.getByRole("heading", { name: "Workspace details" }),
	).toBeVisible();

	// 3. Fill workspace details. Mock kind needs no credentials.
	await page.getByLabel("Name").fill(workspaceName);
	await page.getByRole("button", { name: "Create workspace" }).click();

	// 4. Workspace POST succeeded; the onboarding flow now stops on
	//    the "Pick your agents" template-gallery step (ADR 0003,
	//    PR #174). The user can opt into more templates here, but
	//    Bobby + Maven are already auto-seeded, so the golden path
	//    just clicks straight through to the workspace.
	await expect(
		page.getByRole("heading", { name: "Pick your agents" }),
	).toBeVisible();
	await page.getByRole("button", { name: /Continue to workspace/ }).click();

	// 5. Land on workspace detail; capture ID for API calls.
	await expect(page).toHaveURL(/\/workspaces\/[0-9a-f-]{36}/);
	const workspaceId = page.url().split("/").pop() as string;
	await expect(
		page.getByRole("heading", { name: workspaceName }),
	).toBeVisible();

	// 6. Create the chunking + embedding services + knowledge base via
	//    API. The UI flow for these is a multi-dialog walk that's
	//    covered by component-level tests; here we just need a
	//    KB to query against.
	const embRes = await request.post(
		`/api/v1/workspaces/${workspaceId}/embedding-services`,
		{
			data: {
				name: "mock-embedder",
				provider: "mock",
				modelName: "mock-embedder",
				embeddingDimension: 4,
			},
		},
	);
	expect(embRes.ok(), `embedding-service create: ${await embRes.text()}`).toBe(
		true,
	);
	const emb = await embRes.json();

	const chunkRes = await request.post(
		`/api/v1/workspaces/${workspaceId}/chunking-services`,
		{ data: { name: "default-chunker", engine: "docling" } },
	);
	expect(
		chunkRes.ok(),
		`chunking-service create: ${await chunkRes.text()}`,
	).toBe(true);
	const chunk = await chunkRes.json();

	const kbRes = await request.post(
		`/api/v1/workspaces/${workspaceId}/knowledge-bases`,
		{
			data: {
				name: "kb",
				embeddingServiceId: emb.embeddingServiceId,
				chunkingServiceId: chunk.chunkingServiceId,
			},
		},
	);
	expect(kbRes.ok(), `knowledge-base create: ${await kbRes.text()}`).toBe(true);
	const kb = await kbRes.json();
	const knowledgeBaseId = kb.knowledgeBaseId as string;

	// 7. Drop straight to the data-plane upsert endpoint — direct
	//    upsert is the contract we're proving here.
	const upsert = await request.post(
		`/api/v1/workspaces/${workspaceId}/knowledge-bases/${knowledgeBaseId}/records`,
		{
			data: {
				records: [
					{ id: "alpha", vector: [1, 0, 0, 0], payload: { tag: "keep" } },
					{
						id: "bravo",
						vector: [0.9, 0.1, 0, 0],
						payload: { tag: "keep" },
					},
				],
			},
		},
	);
	expect(upsert.ok()).toBe(true);

	// 8. Vector lane: query the KB through the data-plane `/search`
	//    endpoint with the matching vector. The UI surface for
	//    KB-scoped retrieval was folded into the runtime API by the
	//    "AI design sweep" — the production retrieval path is the same
	//    POST `/search` either way, so the golden path now verifies
	//    that path directly rather than driving a removed widget.
	const vectorSearch = await request.post(
		`/api/v1/workspaces/${workspaceId}/knowledge-bases/${knowledgeBaseId}/search`,
		{ data: { vector: [1, 0, 0, 0], topK: 10 } },
	);
	expect(
		vectorSearch.ok(),
		`vector search: ${await vectorSearch.text()}`,
	).toBe(true);
	const vectorHits = (await vectorSearch.json()) as Array<{ id: string }>;
	const vectorIds = vectorHits.map((h) => h.id);
	expect(vectorIds).toContain("alpha");
	expect(vectorIds).toContain("bravo");

	// 9. Text lane: upsert two records by `text` — the runtime
	//    client-side embeds them through the mock embedder, producing
	//    deterministic vectors. Querying with the same text
	//    deterministically retrieves the matching record at cosine 1.0.
	const textUpsert = await request.post(
		`/api/v1/workspaces/${workspaceId}/knowledge-bases/${knowledgeBaseId}/records`,
		{
			data: {
				records: [
					{
						id: "text-cat",
						text: "cats sit on mats",
						payload: { tag: "animal" },
					},
					{
						id: "text-dog",
						text: "dogs chase balls",
						payload: { tag: "animal" },
					},
				],
			},
		},
	);
	expect(textUpsert.ok(), `text upsert: ${await textUpsert.text()}`).toBe(true);

	// 10. Query by text — the mock embedder hashes both the upserted
	//     text and the query text identically → cosine 1.0 → that
	//     record is the top hit.
	const textSearch = await request.post(
		`/api/v1/workspaces/${workspaceId}/knowledge-bases/${knowledgeBaseId}/search`,
		{ data: { text: "cats sit on mats", topK: 5 } },
	);
	expect(textSearch.ok(), `text search: ${await textSearch.text()}`).toBe(true);
	const textHits = (await textSearch.json()) as Array<{ id: string }>;
	expect(textHits[0]?.id).toBe("text-cat");

	// 11. UI smoke: the workspace-scoped Data API Playground is the
	//     remaining browser surface on the retrieval flow. We just
	//     prove the page renders for the freshly-created workspace —
	//     the command execution itself is covered by the runtime's
	//     own playground-route tests.
	await page.goto(`/workspaces/${workspaceId}/playground`);
	await expect(
		page.getByRole("heading", { name: "Data API Playground" }),
	).toBeVisible();
});
