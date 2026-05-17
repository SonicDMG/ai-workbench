import { expect, test } from "./_fixtures";

// RLAC (Row-Level Access Control) E2E coverage.
//
// Scoped to the UI surfaces operators actually touch: the principals
// panel CRUD that becomes available once a workspace flips
// `rlacEnabled: true`. The policy enforcer's filter math (which
// document a given principal can see, given the visibility list and
// the default DSL) is comprehensively covered at the integration-
// test layer in `runtimes/typescript/tests/policy/enforcer.integration.test.ts`
// — duplicating it through the SPA would add real ingest + the
// View-as picker scaffolding without sharpening anything the unit
// tests don't already pin.
//
// State does not persist between specs.

test("RLAC: principals panel creates a principal end-to-end through the dialog", async ({
	page,
	request,
}, testInfo) => {
	const wsRes = await request.post("/api/v1/workspaces", {
		data: {
			kind: "mock",
			name: `e2e-rlac-principals-${testInfo.workerIndex}-${Date.now()}`,
			rlacEnabled: true,
		},
	});
	expect(wsRes.ok(), `workspace create: ${await wsRes.text()}`).toBe(true);
	const workspaceId = (await wsRes.json()).workspaceId as string;

	await page.goto(`/workspaces/${workspaceId}/settings`);
	// PrincipalsPanel only renders when RLAC is on — its presence
	// doubles as a smoke check that `rlacEnabled: true` on the POST
	// landed. Use `exact: true` because the workspace name (which
	// contains "principals") also renders as a heading nearby.
	await expect(
		page.getByRole("heading", { name: "Principals", exact: true }),
	).toBeVisible();
	await expect(
		page.getByRole("heading", { name: /Policy audit/ }),
	).toBeVisible();

	await page.getByRole("button", { name: /New principal/ }).click();
	await expect(
		page.getByRole("heading", { name: "New principal" }),
	).toBeVisible();

	// Use aria-label roles rather than placeholders — "alice" matches
	// both the principal-id and the label placeholder under Playwright's
	// strict-mode partial match.
	await page.getByRole("textbox", { name: "Principal id" }).fill("alice");
	await page
		.getByRole("textbox", { name: /Label \(optional\)/ })
		.fill("Alice Anderson");

	await page.getByRole("button", { name: /^Create$/ }).click();

	// Toast confirms the round-trip. The new row renders in the panel.
	await expect(page.getByText("Created principal 'alice'")).toBeVisible();
	await expect(page.getByText("alice").first()).toBeVisible();
	await expect(page.getByText("Alice Anderson")).toBeVisible();
});
