import { expect, test } from "@playwright/test";

// Coverage for the agent template gallery (PR #174 / ADR 0003) end
// to end: a fresh workspace lands with Bobby + Maven auto-seeded,
// and the user can opt into a third persona from the onboarding
// step-3 gallery in a single click.
//
// The runtime is memory-backed. State does not persist between
// specs. We use the `request` fixture for the workspace POST so we
// don't have to recreate the existing onboarding-chrome assertions —
// PR #174 / golden-path already pin those.

// Project-level config (apps/web/playwright.config.ts) already enforces
// `fullyParallel: false, workers: 1`, so an explicit
// `test.describe.configure({ mode: "serial" })` here would conflict
// with the equivalent call in golden-path.spec.ts at module load.

test("agent template gallery: onboarding step 3 instantiates an opt-in template", async ({
	page,
}, testInfo) => {
	const workspaceName = `e2e-templates-${testInfo.workerIndex}-${Date.now()}`;

	await page.goto("/onboarding");
	await page.getByRole("button", { name: /Mock/ }).click();
	await page.getByRole("button", { name: "Continue" }).click();
	await page.getByLabel("Name").fill(workspaceName);
	await page.getByRole("button", { name: "Create workspace" }).click();

	// Step 3: the template gallery. Bobby + Maven were auto-seeded by
	// the workspace POST so they show as "Added"; Quill is opt-in.
	await expect(
		page.getByRole("heading", { name: "Pick your agents" }),
	).toBeVisible();
	// We assert against the per-card "Add <name>" buttons rather than
	// text matches — descriptions in the cards can contain template
	// names (e.g. "A no-nonsense data analyst. … Bobby gets to the
	// point.") and trip strict-mode getByText.
	const bobbyAdd = page.getByRole("button", { name: /Add Bobby/ });
	const mavenAdd = page.getByRole("button", { name: /Add Maven/ });
	const quillAdd = page.getByRole("button", { name: /Add Quill/ });
	await expect(bobbyAdd).toBeVisible();
	await expect(mavenAdd).toBeVisible();
	await expect(quillAdd).toBeVisible();
	// Bobby + Maven were seeded — their Add buttons are disabled.
	await expect(bobbyAdd).toBeDisabled();
	await expect(mavenAdd).toBeDisabled();
	// Quill (opt-in) is addable. Click flips it to disabled.
	await expect(quillAdd).toBeEnabled();
	await quillAdd.click();
	await expect(quillAdd).toBeDisabled();

	// Continue to the workspace and verify all three agents land in the
	// agents page.
	await page.getByRole("button", { name: /Continue to workspace/ }).click();
	await expect(page).toHaveURL(/\/workspaces\/[0-9a-f-]{36}$/);
	const workspaceId = page.url().split("/").pop() as string;
	await page.goto(`/workspaces/${workspaceId}/agents`);
	await expect(
		page.getByRole("heading", { level: 1, name: "Agents" }),
	).toBeVisible();
	// All three names show up in the agents list.
	for (const name of ["Bobby", "Maven", "Quill"]) {
		await expect(page.getByText(name).first()).toBeVisible();
	}
});

test("agent template gallery: workspace-page 'From template' dialog adds an agent", async ({
	page,
	request,
}, testInfo) => {
	// Skip the onboarding flow — drive workspace creation through the
	// API to keep this spec focused on the dialog behavior.
	const wsRes = await request.post("/api/v1/workspaces", {
		data: {
			kind: "mock",
			name: `e2e-template-dialog-${testInfo.workerIndex}-${Date.now()}`,
		},
	});
	expect(wsRes.ok()).toBe(true);
	const workspaceId = (await wsRes.json()).workspaceId as string;

	await page.goto(`/workspaces/${workspaceId}/agents`);
	await expect(
		page.getByRole("heading", { level: 1, name: "Agents" }),
	).toBeVisible();

	// Open the "From template" dialog and instantiate Quill (opt-in).
	await page.getByRole("button", { name: /From template/ }).click();
	await expect(
		page.getByRole("heading", {
			name: /Add an agent from the template catalog/,
		}),
	).toBeVisible();
	await page.getByRole("button", { name: /Add Quill/ }).click();
	// Adding marks the card as "In workspace" without closing the dialog,
	// so the user can drop multiple templates in one trip.
	await expect(page.getByRole("button", { name: /Add Quill/ })).toBeDisabled();
	await page.getByRole("button", { name: "Done" }).click();

	// Quill now appears alongside the seeded agents.
	await expect(page.getByText("Quill").first()).toBeVisible();
});
