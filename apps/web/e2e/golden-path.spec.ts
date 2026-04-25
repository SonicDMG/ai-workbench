import { expect, test } from "@playwright/test";

// End-to-end golden path:
//
//   onboarding → workspace (mock) → vector store (mock embed dim 4)
//   → upsert two records via API → playground vector query → hits.
//
// We deliberately stay on the vector lane: text retrieval goes
// through the route's resolveQuery() path, which always builds an
// `Embedder` (even when the driver could handle it natively) so that
// hybrid search has a vector handle. With an `embedding.provider:
// "mock"` descriptor the production embedder factory throws
// `embedding_unavailable` — exercising the text path here would
// require either a real provider key or a runtime override that
// doesn't exist yet. Vector input bypasses the embedder entirely
// and is enough to prove the end-to-end shell works.
//
// The runtime is memory-backed (default workbench.yaml). State does
// not persist between specs; if more specs join later, give each
// its own `test.describe.configure({ mode: "serial" })` and a
// dedicated workspace name to keep them isolated.

test.describe.configure({ mode: "serial" });

test("golden path: onboard → vector store → upsert → run query", async ({
	page,
	request,
}) => {
	// 1. Visit root. With no workspaces, the workspaces page redirects
	//    to /onboarding.
	await page.goto("/");
	await expect(page).toHaveURL(/\/onboarding/);
	await expect(
		page.getByRole("heading", { name: /Let's create your first workspace/ }),
	).toBeVisible();

	// 2. Pick the Mock backend, then proceed to the details step.
	await page.getByRole("button", { name: /Mock/ }).click();
	await page.getByRole("button", { name: "Continue" }).click();
	await expect(
		page.getByRole("heading", { name: "Workspace details" }),
	).toBeVisible();

	// 3. Fill in the workspace details form. The mock kind needs no
	//    credentials — name is the only required field.
	await page.getByLabel("Name").fill("e2e-golden");
	await page.getByRole("button", { name: "Create workspace" }).click();

	// 4. Land on the workspace detail page; capture the workspace UID
	//    from the URL for subsequent API calls.
	await expect(page).toHaveURL(/\/workspaces\/[0-9a-f-]{36}/);
	const workspaceUid = page.url().split("/").pop() as string;
	await expect(page.getByRole("heading", { name: "e2e-golden" })).toBeVisible();

	// 5. Open the create-vector-store dialog and fill it for a mock
	//    embedding (dimension 4 to match our test vectors below).
	await page.getByRole("button", { name: /New vector store/ }).click();
	await expect(
		page.getByRole("heading", { name: "Create a vector store" }),
	).toBeVisible();

	await page.getByLabel("Name").fill("vs");
	// The vector dimension input is pre-populated with 1536; clear
	// before filling so React Hook Form sees a fresh numeric value.
	await page.getByLabel("Vector dimension").fill("4");

	// Override the embedding defaults (which point at OpenAI) so the
	// descriptor matches the mock driver's expectations.
	await page.getByLabel("Provider").fill("mock");
	await page.getByLabel("Model").fill("mock-embedder");
	// Secret ref must satisfy the "<provider>:<path>" regex even
	// though the mock driver never resolves it. Use a sentinel.
	await page.getByLabel("Secret ref").fill("env:E2E_DUMMY");

	await page.getByRole("button", { name: "Create vector store" }).click();
	await expect(page.getByText(/Vector store 'vs' created/)).toBeVisible();

	// 6. Drop the playwright APIRequest fixture down to the data-plane
	//    upsert endpoint — the UI only exposes data ingestion through
	//    the catalog ingest flow, which would route through an
	//    embedder. Direct upsert is the contract we're proving here.
	const stores = await request
		.get(`/api/v1/workspaces/${workspaceUid}/vector-stores`)
		.then((r) => r.json());
	expect(Array.isArray(stores) && stores.length === 1).toBe(true);
	const vectorStoreUid = stores[0].uid as string;

	const upsert = await request.post(
		`/api/v1/workspaces/${workspaceUid}/vector-stores/${vectorStoreUid}/records`,
		{
			data: {
				records: [
					{ id: "alpha", vector: [1, 0, 0, 0], payload: { tag: "keep" } },
					{
						id: "bravo",
						vector: [0.9, 0.1, 0, 0],
						payload: { tag: "keep" },
					},
				],
			},
		},
	);
	expect(upsert.ok()).toBe(true);

	// 7. Navigate into the playground via the top-nav link. The
	//    workspace detail page also surfaces a per-row "Query in
	//    playground" affordance, so we anchor on the exact nav label.
	await page.getByRole("link", { name: "Playground", exact: true }).click();
	await expect(page.getByRole("heading", { name: "Playground" })).toBeVisible();

	// 8. Pick the workspace + vector store from the two Radix selects.
	//    Radix renders triggers as `combobox` role; clicking opens a
	//    listbox we then select an option from.
	await page.getByLabel("Workspace").click();
	await page.getByRole("option", { name: /e2e-golden/ }).click();
	await page.getByLabel("Vector store").click();
	await page.getByRole("option", { name: /vs/ }).click();

	// 9. Switch to the Vector tab and paste a vector matching one of
	//    our upserted records — gives us a deterministic top hit.
	await page.getByRole("button", { name: "Vector", exact: true }).click();
	await page.getByLabel(/Vector \(/).fill("[1, 0, 0, 0]");

	// 10. Run the query. Results table should render two rows.
	await page.getByRole("button", { name: /Run query/ }).click();
	await expect(page.getByText(/alpha/, { exact: false })).toBeVisible();
	await expect(page.getByText(/bravo/, { exact: false })).toBeVisible();
});
