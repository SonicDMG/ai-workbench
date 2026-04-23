/**
 * UI asset serving.
 *
 * The default ship path is **UI + TypeScript runtime in one image**,
 * so the runtime serves the compiled UI as static files and falls
 * back to `index.html` for client-side routes. When the UI dist
 * isn't present (e.g. during runtime-only development), this module
 * reports `null` and `app.ts` simply doesn't mount it — the API
 * surface keeps working, and `/` reverts to the JSON banner.
 *
 * Resolution precedence:
 *   1. Explicit absolute path from `runtime.uiDir` in workbench.yaml
 *   2. `UI_DIR` env var
 *   3. `/app/public`                        (Docker image layout)
 *   4. `${cwd}/public`                      (production-style layout)
 *   5. `${cwd}/apps/web/dist`               (monorepo root dev)
 *   6. `${cwd}/../../apps/web/dist`         (running from runtimes/typescript/)
 *
 * A candidate must contain `index.html` to count.
 */

import { existsSync, readFileSync, statSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { serveStatic } from "@hono/node-server/serve-static";
import type { Context, MiddlewareHandler } from "hono";
import type { AppEnv } from "../lib/types.js";

export interface UiAssets {
	readonly dir: string;
	readonly staticMiddleware: MiddlewareHandler<AppEnv>;
	readonly spaFallback: (c: Context<AppEnv>) => Response;
}

// Paths that must *never* be rewritten to index.html, even under the
// SPA catch-all. Everything else matching a non-file-extension GET
// falls back to the SPA shell so React Router can handle it.
const NON_SPA_PATH_RE =
	/^\/(api(?:\/|$)|docs(?:\/|$)|auth(?:\/|$)|healthz$|readyz$|version$)/;

export function isSpaPath(path: string): boolean {
	if (NON_SPA_PATH_RE.test(path)) return false;
	// If the final segment contains a dot it looks like an asset
	// request — return 404 rather than misleading HTML.
	const last = path.split("/").pop() ?? "";
	if (last.includes(".")) return false;
	return true;
}

function hasIndex(dir: string): boolean {
	try {
		return statSync(dir).isDirectory() && existsSync(join(dir, "index.html"));
	} catch {
		return false;
	}
}

export function resolveUiDir(configured?: string | null): string | null {
	const envOverride = process.env.UI_DIR;
	const explicit = configured ?? (envOverride ? envOverride : null);
	if (explicit) {
		const abs = isAbsolute(explicit) ? explicit : resolve(explicit);
		return hasIndex(abs) ? abs : null;
	}
	const cwd = process.cwd();
	const candidates = [
		"/app/public",
		resolve(cwd, "public"),
		resolve(cwd, "apps/web/dist"),
		resolve(cwd, "../../apps/web/dist"),
	];
	for (const c of candidates) {
		if (hasIndex(c)) return c;
	}
	return null;
}

export function buildUiAssets(dir: string): UiAssets {
	const indexHtml = readFileSync(join(dir, "index.html"), "utf8");
	// serveStatic is happy with absolute paths — it does `path.join(root, req.path)`
	// and statSync handles the result. The "Absolute paths are not supported"
	// note in its types refers to older behavior; we verify with a test.
	const staticMiddleware = serveStatic<AppEnv>({ root: dir });
	const spaFallback = (c: Context<AppEnv>): Response => c.html(indexHtml);
	return { dir, staticMiddleware, spaFallback };
}
