/**
 * "What's new" modal lifecycle E2E coverage.
 *
 * Every other spec imports from `./_fixtures`, which pre-stamps the
 * dismissal flag into localStorage so the modal doesn't intercept
 * clicks during normal flows. This spec is the inverse — we
 * deliberately OPT OUT of the fixture and import directly from
 * `@playwright/test`, so each visit starts with a fresh
 * localStorage and the auto-open path fires.
 *
 * The spec reads `WHATS_NEW_VERSION` + `WHATS_NEW_HIGHLIGHTS` from
 * the source module so the assertions stay coupled to the
 * content authors edit when they bump a release. Hard-coding
 * "What's new in 0.1.0" here would silently rot the moment
 * APP_VERSION bumps.
 */

import { expect, test } from "@playwright/test";
import {
	WHATS_NEW_HIGHLIGHTS,
	WHATS_NEW_VERSION,
} from "../src/lib/whats-new-content";

test("whats-new modal: auto-opens, dismissal persists, header trigger reopens", async ({
	page,
}) => {
	// Fresh visit. localStorage starts empty in a new browser context,
	// so the modal's `readDismissed` returns false and it auto-opens.
	await page.goto("/");

	const dialog = page.getByRole("dialog", {
		name: `What's new in ${WHATS_NEW_VERSION}`,
	});
	await expect(dialog).toBeVisible();

	// Every highlight title from the content module renders. This
	// catches both a content-render regression and an accidental
	// content-module export break.
	for (const item of WHATS_NEW_HIGHLIGHTS) {
		await expect(dialog.getByRole("heading", { name: item.title })).toBeVisible();
	}

	// Dismissing via the brand "Got it" button persists
	// `aiw:wn:<version>=1` in localStorage.
	await dialog.getByRole("button", { name: "Got it" }).click();
	await expect(dialog).not.toBeVisible();

	const storageKey = `aiw:wn:${WHATS_NEW_VERSION}`;
	const dismissed = await page.evaluate(
		(key) => window.localStorage.getItem(key),
		storageKey,
	);
	expect(dismissed).toBe("1");

	// Reload: the dismissal flag is honored, so the modal does NOT
	// auto-open again. Wait for the header to render before asserting
	// absence so we're not asserting against a still-loading SPA.
	await page.reload();
	const trigger = page.getByRole("button", {
		name: `What's new in ${WHATS_NEW_VERSION}`,
	});
	await expect(trigger).toBeVisible();
	await expect(dialog).not.toBeVisible();

	// The header trigger button (`WhatsNewTrigger`) reopens the modal
	// on demand even after dismissal — it dispatches a CustomEvent
	// the modal subscribes to.
	await trigger.click();
	await expect(dialog).toBeVisible();
	await expect(
		dialog.getByRole("heading", { name: WHATS_NEW_HIGHLIGHTS[0]!.title }),
	).toBeVisible();
});
