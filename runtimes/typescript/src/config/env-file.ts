/**
 * Optional `.env` loader.
 *
 * Node 22 exposes `process.loadEnvFile()` (from Node 21.7+), which
 * parses a `dotenv`-style file and populates `process.env` *without*
 * overwriting values already set in the environment. We use it
 * instead of adding a dotenv dependency.
 *
 * Resolution:
 *   1. If `WORKBENCH_ENV_FILE` is set, load that exact path. Missing
 *      file is fatal — the user asked for it explicitly.
 *   2. Otherwise walk up from the process's working directory looking
 *      for `.env`. Stops at the first match, at a directory containing
 *      `.git/` (the repo root), or after 10 levels (safety net).
 *   3. If nothing is found, skip silently — the runtime works without
 *      a .env file (values can come from the shell, docker `-e`, K8s
 *      Secrets mounted as env vars, etc.).
 *
 * Values already in `process.env` take precedence over `.env` entries,
 * matching every other dotenv loader's default and making container
 * overrides straightforward.
 */

import { existsSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { loadEnvFile } from "node:process";

const MAX_WALK = 10;

export interface EnvFileResult {
	readonly path: string | null;
	readonly source: "explicit" | "walked" | "none";
}

export function loadDotEnv(): EnvFileResult {
	const explicit = process.env.WORKBENCH_ENV_FILE;
	if (explicit && explicit.length > 0) {
		loadEnvFile(explicit);
		return { path: resolve(explicit), source: "explicit" };
	}

	const found = walkForEnv(process.cwd());
	if (found) {
		loadEnvFile(found);
		return { path: found, source: "walked" };
	}

	return { path: null, source: "none" };
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
