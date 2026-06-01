import { expect, test } from "./_fixtures";

// Workspace settings E2E coverage — verifies the admin-only API keys
// panel renders alongside the RLAC admin surface restored in 0.5.0 (P4):
// the "Access control" section with its RLAC enable/disable toggle.
// Principals and Policy-audit are gated behind an *enabled* policy, so on
// a fresh workspace (RLAC defaults off) they're intentionally not shown
// yet — the post-enable surface is covered by the RLAC admin E2E (#324).
// Workspace creation goes through the API so the spec stays focused on
// the settings page itself.
//
// Project-level config (apps/web/playwright.config.ts) already
// enforces `fullyParallel: false, workers: 1`, so an explicit
// `test.describe.configure({ mode: "serial" })` here would conflict
// with other specs that don't have it.

test("workspace settings: API keys + RLAC access-control surfaces render", async ({
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
	// Wait for the page to settle on its primary surface (the page's
	// h1 is just "Settings" — the workspace name lives in a sibling
	// subtitle line).
	await expect(
		page.getByRole("heading", { level: 1, name: "Settings" }),
	).toBeVisible();

	// API keys are a workspace's primary access-control surface — issue a
	// role-scoped key (viewer / editor / admin) and you're done.
	await expect(page.getByRole("heading", { name: "API keys" })).toBeVisible();

	// 0.5.0 restored the RLAC admin surface (P4): the "Access control"
	// section and its RLAC toggle always render for a workspace manager.
	await expect(
		page.getByRole("heading", { name: "Access control" }),
	).toBeVisible();
	await expect(page.getByRole("button", { name: "Enable RLAC" })).toBeVisible();

	// Principals + Policy audit only appear once RLAC is enabled; a fresh
	// workspace defaults it off, so they're not shown yet (the enabled
	// surface is covered by the RLAC admin E2E, #324).
	await expect(page.getByRole("heading", { name: "Principals" })).toHaveCount(
		0,
	);
	await expect(page.getByRole("heading", { name: /Policy audit/ })).toHaveCount(
		0,
	);
});
