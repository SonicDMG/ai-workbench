import { expect, test } from "./_fixtures";

// Regression + feature coverage for the unified agent editor (0.4.1).
//
// The tool picker must appear on EVERY agent create/edit surface. The
// 0.4.0 bug was that the workspace-overview agent dialog never fetched
// the tool catalog, so the Tools section silently vanished there (it
// only worked on the dedicated Agents page). 0.4.1 routes all three
// surfaces through one shared dialog that owns the catalog fetch.
//
// This spec drives the overview surface (the regression) end to end —
// open the dialog, confirm the built-in tool group renders, check a
// tool, create, then reopen the agent in edit mode and confirm the
// selection round-tripped — and asserts the Agents-page dialog wires
// the same picker. The runtime is memory-backed; workspace creation
// goes through the API. playwright.config.ts enforces
// `fullyParallel: false, workers: 1`.

async function createMockWorkspace(
	request: import("@playwright/test").APIRequestContext,
	name: string,
): Promise<string> {
	const res = await request.post("/api/v1/workspaces", {
		data: { kind: "mock", name },
	});
	expect(res.ok(), `workspace create: ${await res.text()}`).toBe(true);
	return (await res.json()).workspaceId as string;
}

test("unified agent editor: tool picker works + round-trips on the workspace overview", async ({
	page,
	request,
}, testInfo) => {
	const workspaceId = await createMockWorkspace(
		request,
		`e2e-agent-tools-${testInfo.workerIndex}-${Date.now()}`,
	);

	await page.goto(`/workspaces/${workspaceId}`);
	await page.getByRole("button", { name: "New agent" }).click();

	const dialog = page.getByRole("dialog");
	await expect(
		dialog.getByRole("heading", { name: "New agent" }),
	).toBeVisible();
	// Regression: the built-in tool group must render on THIS surface.
	// In 0.4.0 the overview dialog hid the whole Tools section.
	await expect(dialog.getByTestId("tool-group-builtin")).toBeVisible();

	const searchKb = dialog.getByRole("checkbox", { name: /^search_kb/ });
	await expect(searchKb).toBeVisible();
	await dialog.getByLabel(/^Name/).fill("Tooler");
	await searchKb.check();
	await dialog.getByRole("button", { name: "Create agent" }).click();

	// The new agent's summary card shows the "1 tool" scope badge.
	await expect(page.getByText("1 tool", { exact: true })).toBeVisible();

	// Reopen in edit mode → the tool selection persisted through create.
	await page.getByRole("button", { name: "Edit Tooler" }).click();
	const editDialog = page.getByRole("dialog");
	await expect(
		editDialog.getByRole("heading", { name: "Edit agent" }),
	).toBeVisible();
	await expect(
		editDialog.getByRole("checkbox", { name: /^search_kb/ }),
	).toBeChecked();
});

test("unified agent editor: the Agents-page dialog exposes the same tool picker", async ({
	page,
	request,
}, testInfo) => {
	const workspaceId = await createMockWorkspace(
		request,
		`e2e-agent-tools-pg-${testInfo.workerIndex}-${Date.now()}`,
	);

	await page.goto(`/workspaces/${workspaceId}/agents`);
	await expect(
		page.getByRole("heading", { level: 1, name: "Agents" }),
	).toBeVisible();
	await page.getByRole("button", { name: "New agent" }).click();

	const dialog = page.getByRole("dialog");
	await expect(dialog.getByTestId("tool-group-builtin")).toBeVisible();
	await dialog.getByLabel(/^Name/).fill("PageTooler");
	await dialog.getByRole("checkbox", { name: /^search_kb/ }).check();
	await dialog.getByRole("button", { name: "Create agent" }).click();

	// The new agent row renders with its tool-scope label.
	await expect(page.getByText("PageTooler")).toBeVisible();
	await expect(page.getByText(/· 1 tool/).first()).toBeVisible();
});
