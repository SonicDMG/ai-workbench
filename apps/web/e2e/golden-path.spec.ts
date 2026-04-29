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

test.describe.configure({ mode: "serial" });

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

	// 4. Land on workspace detail; capture UID for API calls.
	await expect(page).toHaveURL(/\/workspaces\/[0-9a-f-]{36}/);
	const workspaceUid = page.url().split("/").pop() as string;
	await expect(
		page.getByRole("heading", { name: workspaceName }),
	).toBeVisible();

	// 5. Create the chunking + embedding services + knowledge base via
	//    API. The UI flow for these is a multi-dialog walk that's
	//    covered by component-level tests; here we just need a
	//    KB to query against.
	const embRes = await request.post(
		`/api/v1/workspaces/${workspaceUid}/embedding-services`,
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
		`/api/v1/workspaces/${workspaceUid}/chunking-services`,
		{ data: { name: "default-chunker", engine: "docling" } },
	);
	expect(
		chunkRes.ok(),
		`chunking-service create: ${await chunkRes.text()}`,
	).toBe(true);
	const chunk = await chunkRes.json();

	const kbRes = await request.post(
		`/api/v1/workspaces/${workspaceUid}/knowledge-bases`,
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
	const knowledgeBaseUid = kb.knowledgeBaseId as string;

	// 6. Drop straight to the data-plane upsert endpoint — direct
	//    upsert is the contract we're proving here.
	const upsert = await request.post(
		`/api/v1/workspaces/${workspaceUid}/knowledge-bases/${knowledgeBaseUid}/records`,
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

	// 7. Navigate to the KB-scoped playground via a fresh load. We
	//    deliberately use `page.goto` instead of clicking through the
	//    UI: the services + KB were created via the `request` fixture,
	//    which is invisible to the page's React Query cache until a
	//    hard load remounts the route.
	await page.goto(
		`/workspaces/${workspaceUid}/knowledge-bases/${knowledgeBaseUid}/playground`,
	);
	await expect(page.getByRole("heading", { name: "Playground" })).toBeVisible();

	// 8. Switch to the Vector tab and paste a matching vector.
	await page.getByRole("button", { name: "Vector", exact: true }).click();
	await page.getByLabel(/Vector \(/).fill("[1, 0, 0, 0]");

	// 9. Run the query — both rows visible.
	await page.getByRole("button", { name: /Run query/ }).click();
	await expect(page.getByText(/alpha/, { exact: false })).toBeVisible();
	await expect(page.getByText(/bravo/, { exact: false })).toBeVisible();

	// 10. Cover the text lane. Upsert two records by `text` — the
	//     runtime client-side embeds them through the mock embedder,
	//     producing deterministic vectors. Querying with the same text
	//     deterministically retrieves the matching record at cosine 1.0.
	const textUpsert = await request.post(
		`/api/v1/workspaces/${workspaceUid}/knowledge-bases/${knowledgeBaseUid}/records`,
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

	// 11. Switch back to the Text tab (default, but the previous step
	//     left us on Vector) and query with one of the upserted texts.
	//     The mock embedder hashes both the upserted text and the
	//     query text identically → cosine 1.0 → that record is the top
	//     hit.
	await page.getByRole("button", { name: "Text", exact: true }).click();
	await page.getByLabel("Query").fill("cats sit on mats");
	await page.getByRole("button", { name: /Run query/ }).click();
	await expect(page.getByText("text-cat", { exact: false })).toBeVisible();
});
