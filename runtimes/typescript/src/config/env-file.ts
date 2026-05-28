/**
 * Optional `.env` loader.
 *
 * Node 22 exposes `process.loadEnvFile()` (from Node 21.7+), which
 * parses a `dotenv`-style file and populates `process.env` *without*
 * overwriting values already set in the environment. We use it
 * instead of adding a dotenv dependency.
 *
 * Resolution (each step is additive; lower-priority sources never
 * overwrite higher-priority ones thanks to `loadEnvFile`'s
 * no-overwrite semantics):
 *
 *   1. `process.env` (highest — docker `-e`, K8s Secrets, shell exports).
 *   2. `WORKBENCH_ENV_FILE` if set — operator-managed explicit path.
 *      A missing file is logged as "absent" (not fatal).
 *   3. **Managed env file** written by the setup wizard and the
 *      `/settings` page (`POST /setup/env`). Lives under
 *      `WORKBENCH_DATA_DIR/.env` (or `WORKBENCH_MANAGED_ENV_FILE`
 *      override). Without this loader hook, credentials pasted via
 *      `/settings` would land on disk but never reach the next
 *      respawn's `process.env`, and the chat factory would keep
 *      reporting `chat_disabled`.
 *   4. Walked `.env` (project root convention; convenience for
 *      developer machines).
 *
 * If nothing is found, skip silently — the runtime works without
 * any env file (values can come from the shell, docker `-e`, K8s
 * Secrets mounted as env vars, etc.).
 */

import { existsSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { loadEnvFile } from "node:process";
import { managedEnvLocation } from "../setup/managed-env.js";

const MAX_WALK = 10;

export interface EnvFileResult {
	readonly path: string | null;
	readonly source: "explicit" | "explicit-absent" | "walked" | "none";
	/**
	 * The managed-env file written by the setup wizard /
	 * `/settings` page. Loaded after the primary (explicit / walked)
	 * source so its values fill any gaps but never overwrite a value
	 * set higher up the precedence chain. Null when the file doesn't
	 * exist yet (fresh install before the wizard has run).
	 */
	readonly managedEnvPath: string | null;
}

export function loadDotEnv(): EnvFileResult {
	const primary = loadPrimary();
	const managedEnvPath = loadManagedEnv();
	return { ...primary, managedEnvPath };
}

function loadPrimary(): Omit<EnvFileResult, "managedEnvPath"> {
	const explicit = process.env.WORKBENCH_ENV_FILE;
	if (explicit && explicit.length > 0) {
		const abs = resolve(explicit);
		if (!existsSync(abs)) {
			return { path: abs, source: "explicit-absent" };
		}
		loadEnvFile(abs);
		return { path: abs, source: "explicit" };
	}

	const found = walkForEnv(process.cwd());
	if (found) {
		loadEnvFile(found);
		return { path: found, source: "walked" };
	}

	return { path: null, source: "none" };
}

function loadManagedEnv(): string | null {
	const { path } = managedEnvLocation();
	if (!existsSync(path)) return null;
	try {
		loadEnvFile(path);
	} catch {
		// Permissions or parse errors shouldn't take down boot — the
		// runtime can still serve everything that doesn't need the
		// managed values, and the missing-secret advisory in the
		// preflight will surface the gap.
		return null;
	}
	return path;
}

function walkForEnv(start: string): string | null {
	let dir = resolve(start);
	for (let i = 0; i < MAX_WALK; i++) {
		const candidate = resolve(dir, ".env");
		if (existsSync(candidate) && statSync(candidate).isFile()) {
			return candidate;
		}
		// Stop at the repo root if we pass through it.
		if (existsSync(resolve(dir, ".git"))) {
			return null;
		}
		const parent = dirname(dir);
		if (parent === dir) return null; // filesystem root
		dir = parent;
	}
	return null;
}
