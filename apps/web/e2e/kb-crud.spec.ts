import { expect, test } from "./_fixtures";

// KB delete confirmation flow E2E coverage.
//
// The delete-KB action drops the bound documents AND the underlying
// Astra collection — it's the only KB-scoped destructive operation
// in the UI, and prior to this spec it had no E2E pin. The confirm
// dialog requires the operator to retype the KB name before the
// Delete button enables (defense-in-depth against an errant click),
// so this spec verifies both the gate and the happy path.
//
// State does not persist between specs.

test("kb crud: delete confirm dialog requires name match, removes the KB card", async ({
	page,
	request,
}, testInfo) => {
	const wsRes = await request.post("/api/v1/workspaces", {
		data: {
			kind: "mock",
			name: `e2e-kbcrud-${testInfo.workerIndex}-${Date.now()}`,
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
	expect(embRes.ok()).toBe(true);
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
		{ data: { name: "kb_doomed", embeddingServiceId, chunkingServiceId } },
	);
	expect(kbRes.ok()).toBe(true);

	await page.goto(`/workspaces/${workspaceId}`);
	// Workspace detail page renders KnowledgeBasesPanel inline.
	await expect(
		page.getByRole("heading", { name: "Knowledge bases" }),
	).toBeVisible();
	// KB card name is a span, not a heading; the entire card is
	// wrapped in a link with `aria-label="Open <kb-name>"` (see
	// KnowledgeBasesPanel.tsx:165), which is the most stable
	// accessible anchor for the card.
	const kbCard = page.getByRole("link", { name: "Open kb_doomed" });
	await expect(kbCard).toBeVisible();

	// Per-card trash icon — aria-label is "Delete <kb-name>" so we
	// can target a specific card even when multiple KBs exist.
	await page.getByRole("button", { name: "Delete kb_doomed" }).click();

	const dialog = page.getByRole("dialog", { name: "Delete knowledge base" });
	await expect(dialog).toBeVisible();
	// The description tells the operator to type the KB name to
	// confirm — anchor on that copy so we'd catch a wording change.
	await expect(dialog.getByText(/Type kb_doomed to confirm/)).toBeVisible();

	const confirmInput = dialog.getByRole("textbox");
	const deleteBtn = dialog.getByRole("button", { name: "Delete", exact: true });

	// Gate: Delete button is disabled until the input matches.
	await expect(deleteBtn).toBeDisabled();

	// Type a deliberately wrong value — gate stays closed.
	await confirmInput.fill("kb_wrong");
	await expect(deleteBtn).toBeDisabled();

	// Correct name unlocks the button.
	await confirmInput.fill("kb_doomed");
	await expect(deleteBtn).toBeEnabled();

	await deleteBtn.click();

	// Dialog dismisses and the KB card disappears from the grid.
	await expect(dialog).not.toBeVisible();
	await expect(kbCard).toHaveCount(0);

	// Empty-state copy returns now that no KBs are left in the panel.
	await expect(page.getByText(/No knowledge bases yet\./)).toBeVisible();
});
