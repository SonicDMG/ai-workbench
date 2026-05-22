/**
 * Shared E2E helpers for the onboarding flow.
 *
 * The setup wizard introduced in 0.2 prepends a "Credentials" step to
 * /onboarding on fresh memory-backed runs (no workspaces, no Astra
 * env vars, writable data dir). Existing specs assume the user lands
 * directly on the "Backend" picker — wrap their entrypoint with
 * {@link skipCredentialsStep} so they walk through the new step via
 * the explicit "Skip for now" affordance.
 */

import type { Page } from "@playwright/test";

/**
 * Click "Skip for now" iff the credentials step is currently rendered.
 * No-op when the wizard skipped straight to the Backend picker (which
 * happens when ASTRA_DB_API_ENDPOINT + ASTRA_DB_APPLICATION_TOKEN are
 * already in process.env, or when the runtime is too old to expose
 * /setup-status).
 *
 * The wizard renders the Backend picker first, then flips to
 * Credentials once /setup-status resolves (useEffect → setStep). A
 * point-in-time `isVisible()` racing that flip would no-op and then
 * the caller's `Mock` click would time out on the now-mounted
 * Credentials card. We instead race waitFor() on the two step
 * headings so the helper only acts once React has settled.
 */
export async function skipCredentialsStep(page: Page): Promise<void> {
	const credentialsHeading = page.getByRole("heading", {
		name: "Connect credentials",
	});
	const backendHeading = page.getByRole("heading", {
		name: "Choose a backend",
	});
	const winner = await Promise.race([
		credentialsHeading
			.waitFor({ state: "visible", timeout: 10_000 })
			.then(() => "credentials" as const)
			.catch(() => null),
		backendHeading
			.waitFor({ state: "visible", timeout: 10_000 })
			.then(() => "backend" as const)
			.catch(() => null),
	]);
	if (winner === "credentials") {
		await page.getByRole("button", { name: "Skip for now" }).click();
		await backendHeading.waitFor({ state: "visible" });
	}
}
