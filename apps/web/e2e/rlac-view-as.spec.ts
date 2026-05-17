import { expect, test } from "./_fixtures";

// RLAC "View as" picker + per-document VisibilityEditor E2E coverage.
//
// rlac.spec.ts explicitly punts on this surface ("View-as picker
// scaffolding without sharpening anything the unit tests don't
// already pin"). This spec closes that gap by driving the full
// principal-switch → query-invalidation → document-visibility loop
// through the UI.
//
// Set-up trick: ingesting with the `x-view-as-principal: alice`
// header causes the runtime to stamp `ownerPrincipalId: "alice"` and
// `visibleTo: ["alice"]` on the resulting document. That gives us a
// document only alice can see without having to chain a PATCH after
// the ingest.
//
// State does not persist between specs.

test("RLAC: view-as picker filters the document list, visibility editor renders", async ({
	page,
	request,
}, testInfo) => {
	const wsRes = await request.post("/api/v1/workspaces", {
		data: {
			kind: "mock",
			name: `e2e-viewas-${testInfo.workerIndex}-${Date.now()}`,
			rlacEnabled: true,
		},
	});
	expect(wsRes.ok(), `workspace create: ${await wsRes.text()}`).toBe(true);
	const workspaceId = (await wsRes.json()).workspaceId as string;

	for (const principal of [
		{ principalId: "alice", label: "Alice" },
		{ principalId: "bob", label: "Bob" },
	]) {
		const res = await request.post(
			`/api/v1/workspaces/${workspaceId}/principals`,
			{ data: principal },
		);
		expect(res.ok(), `principal ${principal.principalId}`).toBe(true);
	}

	// Mock embedder so ingest runs inline without credentials.
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
	expect(embRes.ok(), `embedding-service: ${await embRes.text()}`).toBe(true);
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
		{ data: { name: "kb_rlac", embeddingServiceId, chunkingServiceId } },
	);
	expect(kbRes.ok()).toBe(true);
	const knowledgeBaseId = (await kbRes.json()).knowledgeBaseId as string;

	// Ingest as alice — the header stamps alice as owner + sole
	// visibility entry. Bob will be blind to this document.
	const ingestRes = await request.post(
		`/api/v1/workspaces/${workspaceId}/knowledge-bases/${knowledgeBaseId}/ingest`,
		{
			headers: { "x-view-as-principal": "alice" },
			data: {
				text: "alice-only document body for the view-as spec",
				sourceFilename: "alice-doc.md",
				fileType: "text/markdown",
			},
		},
	);
	expect(ingestRes.ok(), `ingest: ${await ingestRes.text()}`).toBe(true);

	// Stamp the workspace-scoped view-as selection into localStorage
	// before navigation. ViewAsPicker auto-defaults to the first
	// principal alphabetically on mount, but that's a useEffect — the
	// initial document list fetch fires first and 403s with
	// `policy_principal_required`, leaving the table stuck on its
	// error state until the operator clicks Retry. Pre-stamping is
	// the same pattern `_fixtures.ts` uses to silence the "What's new"
	// modal, applied to the picker's persistence key
	// (`apps/web/src/lib/viewAs.ts`).
	await page.addInitScript(
		([ws]) => {
			try {
				window.localStorage.setItem(
					"wb_view_as_principal",
					JSON.stringify({ [ws]: "alice" }),
				);
			} catch {
				// localStorage can throw in private browsing; the picker's
				// auto-default still runs in that case, so the spec just
				// degrades to the slower-but-still-correct retry path.
			}
		},
		[workspaceId],
	);

	await page.goto(
		`/workspaces/${workspaceId}/knowledge-bases/${knowledgeBaseId}`,
	);
	await expect(page.getByRole("heading", { name: "kb_rlac" })).toBeVisible();

	// ViewAsPicker mounts only when RLAC is on AND the workspace has
	// at least one principal. Its <select> has an explicit aria-label.
	const viewAs = page.getByRole("combobox", { name: "View as principal" });
	await expect(viewAs).toBeVisible();

	// alice was pre-stamped into the picker's localStorage above, so
	// the first document fetch goes out under her principal and
	// returns the alice-only document she ingested.
	const aliceRow = page.getByRole("row").filter({ hasText: "alice-doc.md" });
	await expect(aliceRow).toBeVisible();

	// Open the document; in RLAC mode DocumentDetailDialog renders an
	// extra VisibilityEditor block with the Save button.
	await aliceRow.click();
	const dialog = page.getByRole("dialog", { name: "alice-doc.md" });
	await expect(dialog).toBeVisible();

	// The VisibilityEditor only renders inside the dialog when RLAC
	// is on; the Save button is its primary affordance and unique to
	// it (the dialog's other buttons are Close + the picker chips).
	// Initial state is up-to-date — alice ingested the doc as
	// herself, so the staged + persisted visibility lists match.
	await expect(
		dialog.getByRole("button", { name: /Save visibility/ }),
	).toBeVisible();
	await expect(dialog.getByText("Up to date")).toBeVisible();

	// Close the dialog (Radix renders an X with sr-only "Close" text).
	await dialog.getByRole("button", { name: "Close" }).click();
	await expect(dialog).not.toBeVisible();

	// Switch the picker to bob. selectOption fires the same change
	// event the React handler listens for, so query invalidation
	// fires and the table refetches under bob's lens.
	await viewAs.selectOption("bob");

	// Alice's document disappears from the table. We assert the
	// empty-state copy rather than waiting on "no row" — the latter
	// races with the refetch settle.
	await expect(
		page.getByText(/No documents yet\. Use Ingest to add one/),
	).toBeVisible();
	await expect(aliceRow).toHaveCount(0);

	// Flip back to alice. Document re-appears.
	await viewAs.selectOption("alice");
	await expect(aliceRow).toBeVisible();
});
