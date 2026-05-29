import { expect, test } from "./_fixtures";

// Workspace settings E2E coverage — verifies the admin-only API keys
// panel renders and that the advanced RLAC surfaces (access-control
// toggle, principals, policy audit) are absent after the 0.4.1
// access-control simplification. Workspace creation goes through the
// API so the spec stays focused on the settings page itself.
//
// Project-level config (apps/web/playwright.config.ts) already
// enforces `fullyParallel: false, workers: 1`, so an explicit
// `test.describe.configure({ mode: "serial" })` here would conflict
// with other specs that don't have it.

test("workspace settings: API keys panel renders and advanced RLAC surfaces are gone", async ({
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

	// API keys are the workspace's access-control surface — issue a
	// role-scoped key (viewer / editor / admin) and you're done.
	await expect(page.getByRole("heading", { name: "API keys" })).toBeVisible();

	// The advanced RLAC prototype UI was removed in 0.4.1: no
	// access-control toggle, no principals panel, no policy-audit log.
	// The backend still supports them via the API / aiw CLI; they're
	// just no longer surfaced in the app.
	await expect(
		page.getByRole("checkbox", { name: "Enable access control" }),
	).toHaveCount(0);
	await expect(
		page.getByRole("heading", { name: "Access control" }),
	).toHaveCount(0);
	await expect(page.getByRole("heading", { name: "Principals" })).toHaveCount(
		0,
	);
	await expect(page.getByRole("heading", { name: /Policy audit/ })).toHaveCount(
		0,
	);
});
