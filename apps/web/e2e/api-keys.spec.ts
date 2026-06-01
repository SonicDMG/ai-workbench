import { expect, test } from "./_fixtures";

// API-key scope picker E2E (0.5.0 auth P5). Drives the full
// custom-scope mint flow through a real browser + runtime: open the
// create dialog, switch to the advanced "Custom" picker, tick two fine
// scopes, mint, and confirm the new key lands in the list rendered as
// per-scope chips (not collapsed to a role badge).
//
// Note on enforcement: the hermetic E2E runtime boots with
// `auth.mode: disabled` (workbench.memory.yaml has no `auth:` block), so
// a minted key's scopes are NOT gated here — asserting "custom key → 403"
// would need an apiKey-mode stack. That enforcement is covered at the
// integration layer by `runtimes/typescript/tests/auth/route-scope-resolution.test.ts`.

test("custom scope picker mints a fine-scoped key shown as per-scope chips", async ({
	page,
	request,
}, testInfo) => {
	const wsRes = await request.post("/api/v1/workspaces", {
		data: {
			kind: "mock",
			name: `e2e-keys-${testInfo.workerIndex}-${Date.now()}`,
		},
	});
	expect(wsRes.ok(), `workspace create: ${await wsRes.text()}`).toBe(true);
	const workspaceId = (await wsRes.json()).workspaceId as string;

	await page.goto(`/workspaces/${workspaceId}/settings`);
	await expect(page.getByRole("heading", { name: "API keys" })).toBeVisible();

	await page.getByRole("button", { name: "New key" }).click();
	const dialog = page.getByRole("dialog");
	await dialog.getByLabel("Label").fill("ingest-bot");

	// Switch to the advanced custom picker and tick two fine scopes.
	await dialog.getByRole("radio", { name: /Custom/ }).click();
	const create = dialog.getByRole("button", { name: "Create key" });
	// Nothing ticked yet → mint stays disabled.
	await expect(create).toBeDisabled();
	await dialog.getByRole("checkbox", { name: /read:content/ }).click();
	await dialog.getByRole("checkbox", { name: /write:ingest/ }).click();
	await expect(create).toBeEnabled();
	await create.click();

	// One-time reveal → acknowledge + close.
	await expect(dialog.getByText("Copy your key now")).toBeVisible();
	await dialog.getByRole("button", { name: /copied it/ }).click();

	// The new key renders with per-scope chips, not a collapsed role badge.
	await expect(page.getByText("read:content")).toBeVisible();
	await expect(page.getByText("write:ingest")).toBeVisible();
});
