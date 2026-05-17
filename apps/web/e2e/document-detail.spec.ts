import { expect, test } from "./_fixtures";

// Document detail dialog (apps/web/src/components/workspaces/
// DocumentDetailDialog.tsx) E2E coverage.
//
// Natural extension of ingest.spec.ts: ingest.spec.ts pins the
// drop-zone state machine; this spec pins the read-side surface
// operators land on after an ingest finishes — the row-click that
// opens the dialog, the chunk list, and the metadata KV grid.
//
// We bypass the file-chooser dance here. ingest.spec.ts already
// covers that path; this spec uses the JSON `/ingest` endpoint to
// land a document directly (text body → chunker → embedder → ready
// document row) so the ~30s drop-zone wait isn't paid twice.

test("document detail: row click opens dialog with chunks + metadata", async ({
	page,
	request,
}, testInfo) => {
	const wsRes = await request.post("/api/v1/workspaces", {
		data: {
			kind: "mock",
			name: `e2e-docdetail-${testInfo.workerIndex}-${Date.now()}`,
		},
	});
	expect(wsRes.ok()).toBe(true);
	const workspaceId = (await wsRes.json()).workspaceId as string;

	const embRes = await request.post(
		`/api/v1/workspaces/${workspaceId}/embedding-services`,
		{
			data: {
				name: "mock_emb",
				provider: "mock",
				modelName: "mock-embedder",
				embeddingDimension: 4,
			},
		},
	);
	expect(embRes.ok(), `embedding-service create: ${await embRes.text()}`).toBe(
		true,
	);
	const embeddingServiceId = (await embRes.json()).embeddingServiceId as string;

	const chunkRes = await request.post(
		`/api/v1/workspaces/${workspaceId}/chunking-services`,
		{
			data: {
				name: "chunker",
				engine: "langchain_ts",
				strategy: "recursive",
				chunkUnit: "characters",
				maxChunkSize: 1000,
				minChunkSize: 100,
				overlapSize: 150,
				overlapUnit: "characters",
				preserveStructure: true,
			},
		},
	);
	expect(chunkRes.ok()).toBe(true);
	const chunkingServiceId = (await chunkRes.json()).chunkingServiceId as string;

	const kbRes = await request.post(
		`/api/v1/workspaces/${workspaceId}/knowledge-bases`,
		{ data: { name: "kb1", embeddingServiceId, chunkingServiceId } },
	);
	expect(kbRes.ok()).toBe(true);
	const knowledgeBaseId = (await kbRes.json()).knowledgeBaseId as string;

	// JSON-ingest path lands a fully-formed document in one round trip:
	// chunker runs synchronously, embedder is the mock FNV hash, and
	// the document row reaches `status: ready` before the POST
	// returns. No async sweeper wait needed.
	const docBody =
		"intro paragraph for the document detail spec. Second sentence. Third sentence so the chunker has something to split on if it wants to.";
	const ingestRes = await request.post(
		`/api/v1/workspaces/${workspaceId}/knowledge-bases/${knowledgeBaseId}/ingest`,
		{
			data: {
				text: docBody,
				sourceFilename: "intro.md",
				fileType: "text/markdown",
			},
		},
	);
	expect(ingestRes.ok(), `ingest: ${await ingestRes.text()}`).toBe(true);
	const ingested = await ingestRes.json();
	const documentId = ingested.document.documentId as string;

	await page.goto(
		`/workspaces/${workspaceId}/knowledge-bases/${knowledgeBaseId}`,
	);
	await expect(page.getByRole("heading", { name: "kb1" })).toBeVisible();

	// The row click is the documented affordance — the panel's
	// description literally says "Click a row to see the chunks".
	// Use a getByRole row filter so we don't pick up the header row.
	const docRow = page.getByRole("row").filter({ hasText: "intro.md" });
	await expect(docRow).toBeVisible();
	await docRow.click();

	// DocumentDetailDialog opens. DialogTitle is the filename.
	const dialog = page.getByRole("dialog", { name: "intro.md" });
	await expect(dialog).toBeVisible();

	// Metadata KV grid: every label is rendered uppercase in tracking
	// wider, but the visible text is unchanged. The Document ID we
	// know from the ingest response; pinning it proves the dialog is
	// wired to the right record. The chunk-id rows also embed the
	// documentId as a prefix (`<documentId>:0`), so we anchor on the
	// exact-match KV cell to disambiguate.
	await expect(dialog.getByText(documentId, { exact: true })).toBeVisible();
	await expect(dialog.getByText("text/markdown")).toBeVisible();

	// Chunks section. The chunks query loads async via
	// `useDocumentChunks`; once it settles, the list renders the
	// original document body verbatim. We assert on the body text
	// (unique to this spec) — pin that and we've proven both the
	// chunk-list render AND the chunkText payload round-trip.
	await expect(dialog.getByText(docBody.slice(0, 30))).toBeVisible();

	// Dialog closes via Radix's built-in Close button (rendered as an
	// X with sr-only "Close" label).
	await dialog.getByRole("button", { name: "Close" }).click();
	await expect(dialog).not.toBeVisible();
});
