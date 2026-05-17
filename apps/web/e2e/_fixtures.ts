/**
 * Custom Playwright test fixture for the workbench E2E suite.
 *
 * The shared `page` is configured with an `addInitScript` that stamps
 * the "What's new" modal dismissal flag into `localStorage` before
 * any application JS runs. Without this, the modal auto-opens on
 * first visit and its Radix overlay intercepts every click, making
 * the existing golden-path / agent-templates / ingest specs fail.
 *
 * Specs that actually want to exercise the modal (e.g. a future
 * "verify the dialog opens on a fresh visit" spec) can opt out by
 * clearing the key themselves before navigation.
 */

import { test as base, expect } from "@playwright/test";

/** Match `WHATS_NEW_VERSION` in `apps/web/src/lib/whats-new-content.ts`. */
const WHATS_NEW_STORAGE_KEY = "aiw:wn:0.1.0";

const test = base.extend({
	page: async ({ page }, use) => {
		await page.addInitScript(
			([key]) => {
				try {
					window.localStorage.setItem(key, "1");
				} catch {
					// Best effort — Safari private mode etc. don't expose
					// localStorage. The auto-open path is the only thing this
					// guards; falling through still works for headless Chromium
					// which is the only E2E target today.
				}
			},
			[WHATS_NEW_STORAGE_KEY],
		);
		await use(page);
	},
});

export { expect, test };
