import { expect, test } from "./_fixtures";

// Coverage for the ingest queue dialog (apps/web/src/components/
// workspaces/IngestQueueDialog.tsx). The dialog has a non-trivial
// state machine — sequential drain through async-ingest jobs, with
// a re-entry guard preventing double-fires — and was a regression
// hotspot historically. This spec drives the happy path through
// the real runtime + memory control plane.
//
// Strategy:
//   1. API: workspace + chunking + embedding services + KB.
//   2. UI: open the KB explorer, open the ingest dialog, drop a
//      single text file, wait for the row to land in the "completed"
//      state, and let the dialog auto-close.
//   3. Verify: the document table on the explorer shows the file.
//
// Memory backend, no real LLM / embedding provider — embedding
// service uses `provider: "mock"` so the FNV-hash embedder runs
// inline without credentials.

// See agent-templates.spec.ts for why we don't call
// `test.describe.configure({ mode: "serial" })` here.

test("ingest dialog: drop a text file → see it land in the document table", async ({
	page,
	request,
}, testInfo) => {
	// 1. API setup — workspace + services + KB.
	const wsRes = await request.post("/api/v1/workspaces", {
		data: {
			kind: "mock",
			name: `e2e-ingest-${testInfo.workerIndex}-${Date.now()}`,
		},
	});
	expect(wsRes.ok()).toBe(true);
	const workspaceId = (await wsRes.json()).workspaceId as string;

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

	// `engine: "docling"` is accepted by the schema but rejected at
	// run-time by the chunker dispatch (the in-process runner only
	// understands `langchain_ts`). Use the same shape the seeded
	// `recursive-char-1000` preset uses so the ingest job actually
	// progresses to "succeeded".
	const chunkRes = await request.post(
		`/api/v1/workspaces/${workspaceId}/chunking-services`,
		{
			data: {
				name: "default-chunker",
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
	expect(kbRes.ok()).toBe(true);
	const kbId = (await kbRes.json()).knowledgeBaseId as string;

	// 2. Open the KB explorer and trigger the ingest dialog.
	await page.goto(`/workspaces/${workspaceId}/knowledge-bases/${kbId}`);
	await expect(page.getByRole("heading", { name: "kb" })).toBeVisible();
	// Document table starts empty — the "no documents yet" callout
	// renders an Ingest CTA.
	await page
		.getByRole("button", { name: /Ingest/ })
		.first()
		.click();

	// 3. Set the file via the filechooser pattern. Clicking the visible
	// "Files…" button opens the native file picker; Playwright
	// intercepts it via `waitForEvent("filechooser")` and we hand it
	// the in-memory buffer. The drop zone's two `<input type="file">`s
	// are CSS-hidden, so `setInputFiles` directly on them is brittle
	// across runner versions.
	await expect(
		page.getByRole("heading", { name: /Ingest into/i }),
	).toBeVisible();
	const filechooserPromise = page.waitForEvent("filechooser");
	await page.getByRole("button", { name: /^Files…/ }).click();
	const chooser = await filechooserPromise;
	await chooser.setFiles({
		name: "intro.md",
		mimeType: "text/markdown",
		buffer: Buffer.from(
			"# AI Workbench\n\nA self-hosted retrieval workbench for Astra.",
			"utf-8",
		),
	});

	// 4. The dialog queues files first; the user kicks off the drain
	// by clicking "Start ingest". Confirm the queue picked up the file
	// before clicking so we don't race the click against the React
	// state update.
	await expect(page.getByText(/intro\.md/).first()).toBeVisible();
	await page.getByRole("button", { name: /Start ingest/i }).click();

	// 5. Wait for the queue row to reach a terminal "succeeded" state.
	// The mock embedder runs inline but the async job queue polls
	// through the sweeper, so we give it a generous ceiling. The
	// success row surfaces a "N chunk(s)" label that doesn't appear
	// on the running row (which says "0/N chunks" instead).
	await expect(page.getByText(/^\d+ chunks?$/).first()).toBeVisible({
		timeout: 60_000,
	});

	// 6. The dialog now auto-closes after a clean terminal batch and
	// invalidates the document list, so the explorer page should pick
	// up the ingested document without a manual Close click.
	await expect(
		page.getByRole("heading", { name: /Ingest into/i }),
	).not.toBeVisible({ timeout: 10_000 });
	await expect(page.getByText(/intro\.md/).first()).toBeVisible();
});
