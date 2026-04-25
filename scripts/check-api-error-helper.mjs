#!/usr/bin/env node
/**
 * Lint guard: keep `formatApiError(err)` sticky across the web app.
 *
 * #66 centralized 16 sites that all repeated:
 *
 *   const msg = err instanceof ApiError
 *     ? `${err.code}: ${err.message}`
 *     : err instanceof Error ? err.message : "Unknown error";
 *
 * into a single helper. This script fails CI if anyone re-introduces
 * the `instanceof ApiError` pattern outside the two locations that
 * are explicitly allowed:
 *
 *   1. `apps/web/src/lib/api.ts` — defines the helper.
 *   2. `apps/web/src/pages/WorkspaceDetailPage.tsx` — has a
 *      `workspace_not_found` short-circuit that needs the typed
 *      check before falling through to the helper.
 *
 * Add new exemptions intentionally. Most call sites should use
 * `formatApiError(err)` instead.
 *
 * Run via `npm run lint:guard` at the root, which is also chained
 * into `npm run lint`. Exits 0 on success, 1 on any drift.
 */

import { readdir, readFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..");
const WEB_SRC = resolve(REPO_ROOT, "apps/web/src");

const ALLOWLIST = new Set([
	resolve(WEB_SRC, "lib/api.ts"),
	resolve(WEB_SRC, "pages/WorkspaceDetailPage.tsx"),
]);

const PATTERN = /instanceof\s+ApiError\b/;

/** @param {string} dir @returns {AsyncGenerator<string>} */
async function* walk(dir) {
	for (const entry of await readdir(dir, { withFileTypes: true })) {
		const full = join(dir, entry.name);
		if (entry.isDirectory()) {
			if (entry.name === "node_modules" || entry.name === "dist") continue;
			yield* walk(full);
		} else if (/\.(ts|tsx)$/.test(entry.name)) {
			// Don't lint the test files for the helper itself — they
			// reference ApiError by construction.
			if (entry.name.endsWith(".test.ts") || entry.name.endsWith(".test.tsx")) {
				continue;
			}
			yield full;
		}
	}
}

const offenders = [];
for await (const file of walk(WEB_SRC)) {
	if (ALLOWLIST.has(file)) continue;
	const text = await readFile(file, "utf8");
	const lines = text.split("\n");
	for (let i = 0; i < lines.length; i++) {
		if (PATTERN.test(lines[i])) {
			offenders.push({
				file: relative(REPO_ROOT, file),
				line: i + 1,
				snippet: lines[i].trim(),
			});
		}
	}
}

if (offenders.length > 0) {
	console.error(
		"`instanceof ApiError` found outside the helper allowlist.\n" +
			"Use `formatApiError(err)` from `@/lib/api` instead. If you genuinely\n" +
			"need the typed check (like the `workspace_not_found` short-circuit\n" +
			"in WorkspaceDetailPage.tsx), add the file to ALLOWLIST in\n" +
			"scripts/check-api-error-helper.mjs.\n",
	);
	for (const o of offenders) {
		console.error(`  ${o.file}:${o.line}  ${o.snippet}`);
	}
	process.exit(1);
}
