/**
 * Managed `.env` file written by the first-run setup wizard.
 *
 * The wizard collects a small, fixed allow-list of credentials
 * (Astra endpoint/token, HuggingFace key) and persists them to a
 * file inside the runtime's data directory so they survive
 * `docker compose down/up` in the same named volume that already
 * holds control-plane state.
 *
 * Resolution:
 *   1. `WORKBENCH_MANAGED_ENV_FILE` — explicit override (tests).
 *   2. `WORKBENCH_DATA_DIR/.env` — the production path (compose
 *      mounts `/var/lib/workbench` as a named volume).
 *   3. `./.workbench-data/.env` — repo-relative fallback for `npm
 *      run dev` outside the container.
 *
 * `WORKBENCH_ENV_FILE` (set in compose) points at the resolved
 * location so {@link ../config/env-file.loadDotEnv} picks it up on
 * the *next* boot — the wizard does NOT mutate `process.env` for
 * the current process, since the runtime hands secret resolution
 * to long-lived clients (Astra `DataAPIClient`, JWKS cache) at
 * boot. The wizard signals the user to restart after a successful
 * write.
 */
import { constants } from "node:fs";
import { access, mkdir, rename, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

/** Keys the wizard is allowed to persist into the managed file. */
export const MANAGED_ENV_KEYS = [
	"ASTRA_DB_API_ENDPOINT",
	"ASTRA_DB_APPLICATION_TOKEN",
	"HUGGINGFACE_API_KEY",
] as const;

export type ManagedEnvKey = (typeof MANAGED_ENV_KEYS)[number];

export interface ManagedEnvLocation {
	readonly path: string;
	readonly source: "explicit" | "data-dir" | "fallback";
}

export function managedEnvLocation(
	env: NodeJS.ProcessEnv = process.env,
): ManagedEnvLocation {
	const explicit = env.WORKBENCH_MANAGED_ENV_FILE?.trim();
	if (explicit) {
		return { path: resolve(explicit), source: "explicit" };
	}
	const dataDir = env.WORKBENCH_DATA_DIR?.trim();
	if (dataDir) {
		return { path: join(resolve(dataDir), ".env"), source: "data-dir" };
	}
	return {
		path: resolve("./.workbench-data/.env"),
		source: "fallback",
	};
}

export interface ManagedEnvStatus {
	readonly path: string;
	readonly present: boolean;
	readonly writable: boolean;
}

/** Probe the resolved file location without ever reading the values. */
export async function describeManagedEnv(
	env: NodeJS.ProcessEnv = process.env,
): Promise<ManagedEnvStatus> {
	const loc = managedEnvLocation(env);
	const dir = dirname(loc.path);
	const present = await access(loc.path, constants.F_OK)
		.then(() => true)
		.catch(() => false);
	const writable = await access(dir, constants.W_OK)
		.then(() => true)
		.catch(async () => {
			// Directory doesn't exist yet — check the parent.
			const parent = dirname(dir);
			return access(parent, constants.W_OK)
				.then(() => true)
				.catch(() => false);
		});
	return { path: loc.path, present, writable };
}

/**
 * Serialize a record of key=value pairs as a dotenv file. Always
 * quotes the value so embedded spaces / quotes / newlines round-trip
 * safely through `process.loadEnvFile`.
 */
export function renderEnvFile(
	values: Partial<Record<ManagedEnvKey, string>>,
): string {
	const lines: string[] = [];
	lines.push("# Managed by AI Workbench setup wizard.");
	lines.push("# Do not edit by hand — `POST /setup/env` rewrites this file.");
	for (const key of MANAGED_ENV_KEYS) {
		const value = values[key];
		if (value === undefined) continue;
		const escaped = value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
		lines.push(`${key}="${escaped}"`);
	}
	return `${lines.join("\n")}\n`;
}

/**
 * Atomically rewrite the managed env file with the supplied values.
 * Writes to `<path>.tmp` first, sets mode `0o600`, then renames into
 * place. Creates the parent directory with mode `0o700` if missing.
 */
export async function writeManagedEnv(
	values: Partial<Record<ManagedEnvKey, string>>,
	env: NodeJS.ProcessEnv = process.env,
): Promise<ManagedEnvStatus> {
	const loc = managedEnvLocation(env);
	const dir = dirname(loc.path);
	await mkdir(dir, { recursive: true, mode: 0o700 });
	const body = renderEnvFile(values);
	const tmp = `${loc.path}.tmp`;
	await writeFile(tmp, body, { encoding: "utf8", mode: 0o600 });
	await rename(tmp, loc.path);
	return { path: loc.path, present: true, writable: true };
}
