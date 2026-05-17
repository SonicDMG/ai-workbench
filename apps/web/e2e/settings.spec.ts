import { expect, test } from "./_fixtures";

// Workspace settings E2E coverage — focuses on the RLAC toggle and
// the two panels that appear/disappear with it. Driven through the
// UI (the toggle is the surface operators actually flip), with
// workspace creation through the API so the spec stays focused on
// the settings page itself.
//
// Project-level config (apps/web/playwright.config.ts) already
// enforces `fullyParallel: false, workers: 1`, so an explicit
// `test.describe.configure({ mode: "serial" })` here would conflict
// with other specs that don't have it.

test("workspace settings: RLAC toggle reveals + hides principals/audit panels", async ({
	page,
	request,
}, testInfo) => {
	const wsRes = await request.post("/api/v1/workspaces", {
		data: {
			kind: "mock",
			name: `e2e-settings-${testInfo.workerIndex}-${Date.now()}`,
		},
	});
	expect(wsRes.ok(), `workspace create: ${await wsRes.text()}`).toBe(true);
	const workspaceId = (await wsRes.json()).workspaceId as string;

	await page.goto(`/workspaces/${workspaceId}/settings`);
	// Wait for the page to settle on its primary surface (the
	// page's h1 is just "Settings" — the workspace name lives in a
	// sibling subtitle line).
	await expect(
		page.getByRole("heading", { level: 1, name: "Settings" }),
	).toBeVisible();

	// RLAC card is always visible; the Preview chip ships with it.
	await expect(
		page.getByRole("heading", { name: "Access control" }),
	).toBeVisible();
	await expect(page.getByText("Preview").first()).toBeVisible();

	const toggle = page.getByRole("checkbox", { name: "Enable access control" });
	await expect(toggle).toBeVisible();
	await expect(toggle).not.toBeChecked();

	// Off baseline: Principals + Audit panels are hidden.
	await expect(page.getByRole("heading", { name: "Principals" })).toHaveCount(
		0,
	);
	await expect(page.getByRole("heading", { name: /Policy audit/ })).toHaveCount(
		0,
	);

	// Flip on. The toggle is a controlled checkbox driven by a PATCH;
	// `.check()` / `.uncheck()` would assert the DOM state flipped
	// immediately, but the input's `checked` is derived from a
	// TanStack-Query refetch, so we use raw `.click()` and wait for
	// the toast + checkbox state as the proof of round-trip.
	await toggle.click();
	await expect(page.getByText("Access control enabled")).toBeVisible();
	await expect(toggle).toBeChecked();

	// Panels now appear.
	await expect(page.getByRole("heading", { name: "Principals" })).toBeVisible();
	await expect(
		page.getByRole("heading", { name: /Policy audit/ }),
	).toBeVisible();

	// Flip off. Wait for the mutation pending-state to clear before
	// clicking again so the second click isn't dropped against a
	// `disabled` input.
	await expect(toggle).toBeEnabled();
	await toggle.click();
	await expect(page.getByText("Access control disabled")).toBeVisible();
	await expect(toggle).not.toBeChecked();
	await expect(page.getByRole("heading", { name: "Principals" })).toHaveCount(
		0,
	);
	await expect(page.getByRole("heading", { name: /Policy audit/ })).toHaveCount(
		0,
	);
});
