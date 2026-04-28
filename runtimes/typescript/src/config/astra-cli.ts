/**
 * Optional `astra` CLI integration.
 *
 * When the [DataStax astra CLI](https://github.com/datastax/astra-cli)
 * is installed and configured, the runtime can pick up the developer's
 * Astra credentials from a CLI profile instead of requiring the
 * `ASTRA_DB_APPLICATION_TOKEN` / `ASTRA_DB_API_ENDPOINT` env vars to
 * be set by hand. This is purely a developer convenience layered on
 * top of the existing env-var contract — the runtime keeps reading
 * the same two variables from `process.env`.
 *
 * Resolution order (highest precedence first):
 *   1. `process.env.ASTRA_DB_APPLICATION_TOKEN` and `ASTRA_DB_API_ENDPOINT`
 *      already set: nothing to do, the CLI is not consulted.
 *   2. `astra` binary not found on `PATH`: skip silently.
 *   3. Otherwise:
 *        a. Pick a profile.
 *           - `ASTRA_PROFILE` env var if set, otherwise
 *           - the only profile if there's just one, otherwise
 *           - the profile flagged `isUsedAsDefault: true` if running
 *             non-interactively, otherwise
 *           - prompt the user.
 *        b. Pick a database the profile's token can see.
 *           - `ASTRA_DB` env var (matches name or id) if set, otherwise
 *           - the only database if there's just one, otherwise
 *           - prompt the user (skip when non-interactive).
 *        c. Inject `ASTRA_DB_APPLICATION_TOKEN` and
 *           `ASTRA_DB_API_ENDPOINT` into `process.env`. Existing values
 *           always win — same precedence as `loadDotEnv()`.
 *
 * The token is never logged. We log profile name + database
 * name/id/region only.
 */

import {
	type SpawnSyncOptionsWithStringEncoding,
	type SpawnSyncReturns,
	spawnSync,
} from "node:child_process";
import { createInterface } from "node:readline/promises";

const ASTRA_BIN_DEFAULT = "astra";
const TOKEN_ENV = "ASTRA_DB_APPLICATION_TOKEN";
const ENDPOINT_ENV = "ASTRA_DB_API_ENDPOINT";
const PROFILE_ENV = "ASTRA_PROFILE";
const DB_ENV = "ASTRA_DB";
const DISABLE_ENV = "WORKBENCH_DISABLE_ASTRA_CLI";

export interface AstraCliProfile {
	readonly name: string;
	readonly env: string;
	readonly token: string;
	readonly isUsedAsDefault: boolean;
}

export interface AstraCliDatabase {
	readonly id: string;
	readonly name: string;
	readonly region: string;
	readonly endpoint: string;
	readonly keyspace: string | null;
}

export type AstraCliResult =
	| {
			readonly status: "loaded";
			readonly profile: string;
			readonly database: AstraCliDatabase;
	  }
	| { readonly status: "skipped"; readonly reason: AstraCliSkipReason };

export type AstraCliSkipReason =
	| "already-configured"
	| "disabled"
	| "binary-not-found"
	| "no-profiles"
	| "no-databases"
	| "ambiguous-profile-non-interactive"
	| "ambiguous-database-non-interactive"
	| "user-aborted"
	| "cli-error";

export interface AstraCliLoadOptions {
	readonly env?: NodeJS.ProcessEnv;
	readonly binary?: string;
	readonly runner?: AstraCliRunner;
	readonly prompt?: AstraCliPrompt;
	readonly interactive?: boolean;
	readonly logger?: AstraCliLogger;
}

export type AstraCliRunner = (
	args: readonly string[],
) => SpawnSyncReturns<string>;

export interface AstraCliPrompt {
	choose<T>(
		label: string,
		choices: readonly AstraCliChoice<T>[],
	): Promise<T | null>;
}

export interface AstraCliChoice<T> {
	readonly label: string;
	readonly value: T;
	readonly hint?: string;
}

export interface AstraCliLogger {
	info?: (msg: string, fields?: Record<string, unknown>) => void;
	warn?: (msg: string, fields?: Record<string, unknown>) => void;
	debug?: (msg: string, fields?: Record<string, unknown>) => void;
}

export async function loadAstraFromCli(
	options: AstraCliLoadOptions = {},
): Promise<AstraCliResult> {
	const env = options.env ?? process.env;
	const log = options.logger ?? {};

	if (env[DISABLE_ENV] === "1" || env[DISABLE_ENV] === "true") {
		return { status: "skipped", reason: "disabled" };
	}

	if (env[TOKEN_ENV] && env[ENDPOINT_ENV]) {
		return { status: "skipped", reason: "already-configured" };
	}

	const binary = options.binary ?? ASTRA_BIN_DEFAULT;
	const runner = options.runner ?? defaultRunner(binary);

	if (!binaryAvailable(runner)) {
		log.debug?.("astra cli not found on PATH; skipping auto-config");
		return { status: "skipped", reason: "binary-not-found" };
	}

	const profilesResult = listProfiles(runner);
	if (profilesResult.status === "error") {
		log.warn?.("astra config list failed; skipping auto-config", {
			stderr: profilesResult.stderr,
		});
		return { status: "skipped", reason: "cli-error" };
	}

	const profiles = profilesResult.data;
	if (profiles.length === 0) {
		log.debug?.("no astra-cli profiles configured; skipping auto-config");
		return { status: "skipped", reason: "no-profiles" };
	}

	const interactive = options.interactive ?? Boolean(process.stdin.isTTY);
	const prompt = options.prompt ?? defaultPrompt();

	const profile = await pickProfile(profiles, env, interactive, prompt);
	if (profile === null) {
		log.warn?.(
			"could not determine which astra-cli profile to use (multiple profiles, non-interactive shell). Set ASTRA_PROFILE or run interactively.",
		);
		return { status: "skipped", reason: "ambiguous-profile-non-interactive" };
	}
	if (profile === "aborted") {
		return { status: "skipped", reason: "user-aborted" };
	}

	const databasesResult = listDatabases(runner, profile.name);
	if (databasesResult.status === "error") {
		log.warn?.("astra db list failed; skipping auto-config", {
			profile: profile.name,
			stderr: databasesResult.stderr,
		});
		return { status: "skipped", reason: "cli-error" };
	}

	const databases = databasesResult.data;
	if (databases.length === 0) {
		log.warn?.(
			"astra-cli profile has no accessible databases; skipping auto-config",
			{ profile: profile.name },
		);
		return { status: "skipped", reason: "no-databases" };
	}

	const database = await pickDatabase(databases, env, interactive, prompt);
	if (database === null) {
		log.warn?.(
			"could not determine which astra database to use (multiple available, non-interactive shell). Set ASTRA_DB or run interactively.",
			{ profile: profile.name, count: databases.length },
		);
		return { status: "skipped", reason: "ambiguous-database-non-interactive" };
	}
	if (database === "aborted") {
		return { status: "skipped", reason: "user-aborted" };
	}

	if (!env[TOKEN_ENV]) {
		env[TOKEN_ENV] = profile.token;
	}
	if (!env[ENDPOINT_ENV]) {
		env[ENDPOINT_ENV] = database.endpoint;
	}

	log.info?.("astra-cli profile applied", {
		profile: profile.name,
		database: database.name,
		databaseId: database.id,
		region: database.region,
		endpoint: database.endpoint,
	});

	return { status: "loaded", profile: profile.name, database };
}

async function pickProfile(
	profiles: readonly AstraCliProfile[],
	env: NodeJS.ProcessEnv,
	interactive: boolean,
	prompt: AstraCliPrompt,
): Promise<AstraCliProfile | null | "aborted"> {
	const wanted = env[PROFILE_ENV]?.trim();
	if (wanted && wanted.length > 0) {
		const match = profiles.find((p) => p.name === wanted);
		if (match) return match;
		// Fall through if the named profile doesn't exist; treat as ambiguous.
	}

	if (profiles.length === 1) {
		return profiles[0] ?? null;
	}

	if (!interactive) {
		const fallback = profiles.find((p) => p.isUsedAsDefault);
		return fallback ?? null;
	}

	const chosen = await prompt.choose<AstraCliProfile>(
		"Select an Astra CLI profile:",
		profiles.map((p) => ({
			label: p.name,
			value: p,
			hint: p.isUsedAsDefault ? `default · ${p.env}` : p.env,
		})),
	);
	if (chosen === null) return "aborted";
	return chosen;
}

async function pickDatabase(
	databases: readonly AstraCliDatabase[],
	env: NodeJS.ProcessEnv,
	interactive: boolean,
	prompt: AstraCliPrompt,
): Promise<AstraCliDatabase | null | "aborted"> {
	const wanted = env[DB_ENV]?.trim();
	if (wanted && wanted.length > 0) {
		const match = databases.find((d) => d.name === wanted || d.id === wanted);
		if (match) return match;
	}

	if (databases.length === 1) {
		return databases[0] ?? null;
	}

	if (!interactive) {
		return null;
	}

	const chosen = await prompt.choose<AstraCliDatabase>(
		"Select an Astra database:",
		databases.map((d) => ({
			label: d.name,
			value: d,
			hint: `${d.region} · ${d.id}`,
		})),
	);
	if (chosen === null) return "aborted";
	return chosen;
}

type CliResult<T> =
	| { readonly status: "ok"; readonly data: T }
	| { readonly status: "error"; readonly stderr: string };

export function listProfiles(
	runner: AstraCliRunner,
): CliResult<AstraCliProfile[]> {
	const result = runner(["config", "list", "-o", "json", "--no-input"]);
	if (result.status !== 0) {
		return { status: "error", stderr: result.stderr ?? "" };
	}
	try {
		const profiles = parseProfilesPayload(result.stdout);
		return { status: "ok", data: profiles };
	} catch (err) {
		return {
			status: "error",
			stderr: err instanceof Error ? err.message : "parse error",
		};
	}
}

export function listDatabases(
	runner: AstraCliRunner,
	profile: string,
): CliResult<AstraCliDatabase[]> {
	const result = runner([
		"db",
		"list",
		"-p",
		profile,
		"-o",
		"json",
		"--no-input",
	]);
	if (result.status !== 0) {
		return { status: "error", stderr: result.stderr ?? "" };
	}
	try {
		const databases = parseDatabasesPayload(result.stdout);
		return { status: "ok", data: databases };
	} catch (err) {
		return {
			status: "error",
			stderr: err instanceof Error ? err.message : "parse error",
		};
	}
}

export function parseProfilesPayload(stdout: string): AstraCliProfile[] {
	const payload = JSON.parse(stdout) as unknown;
	const data = extractData(payload);
	if (!Array.isArray(data)) {
		throw new Error("astra config list: unexpected payload shape");
	}
	const seen = new Set<string>();
	const profiles: AstraCliProfile[] = [];
	for (const entry of data) {
		if (!isRecord(entry)) continue;
		const name = stringOrNull(entry.name);
		const token = stringOrNull(entry.token);
		if (name === null || token === null) continue;
		// `astra config list` returns a synthetic `default` row that
		// duplicates whichever profile is currently in use. Drop it so
		// the user only ever sees their real profiles.
		if (name === "default" && seen.has("default")) continue;
		if (seen.has(name)) continue;
		seen.add(name);
		profiles.push({
			name,
			env: stringOrNull(entry.env) ?? "PROD",
			token,
			isUsedAsDefault: entry.isUsedAsDefault === true,
		});
	}
	// Drop the synthetic `default` row when a real, in-use profile exists.
	const hasReal = profiles.some(
		(p) => p.name !== "default" && p.isUsedAsDefault,
	);
	return hasReal ? profiles.filter((p) => p.name !== "default") : profiles;
}

export function parseDatabasesPayload(stdout: string): AstraCliDatabase[] {
	const payload = JSON.parse(stdout) as unknown;
	const data = extractData(payload);
	if (!Array.isArray(data)) {
		throw new Error("astra db list: unexpected payload shape");
	}
	const databases: AstraCliDatabase[] = [];
	for (const entry of data) {
		if (!isRecord(entry)) continue;
		const id = stringOrNull(entry.id);
		const info = isRecord(entry.info) ? entry.info : null;
		if (id === null || info === null) continue;
		const name = stringOrNull(info.name);
		const region = stringOrNull(info.region);
		if (name === null || region === null) continue;
		const status = stringOrNull(entry.status);
		// Skip terminated / terminating databases — they can't accept
		// requests and would only confuse the picker.
		if (status === "TERMINATED" || status === "TERMINATING") continue;
		databases.push({
			id,
			name,
			region,
			endpoint: buildDataApiEndpoint(id, region),
			keyspace: stringOrNull(info.keyspace),
		});
	}
	return databases;
}

export function buildDataApiEndpoint(id: string, region: string): string {
	return `https://${id}-${region}.apps.astra.datastax.com`;
}

function extractData(payload: unknown): unknown {
	if (Array.isArray(payload)) return payload;
	if (isRecord(payload) && "data" in payload) return payload.data;
	return payload;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringOrNull(value: unknown): string | null {
	return typeof value === "string" && value.length > 0 ? value : null;
}

function binaryAvailable(runner: AstraCliRunner): boolean {
	try {
		const result = runner(["--version"]);
		return result.status === 0;
	} catch {
		return false;
	}
}

function defaultRunner(binary: string): AstraCliRunner {
	const opts: SpawnSyncOptionsWithStringEncoding = {
		encoding: "utf8",
		// astra-cli's spinner clutters stderr; shut it off explicitly so
		// stdout stays clean JSON.
		env: { ...process.env, NO_COLOR: "1" },
	};
	return (args) => spawnSync(binary, [...args, "--no-spinner"], opts);
}

function defaultPrompt(): AstraCliPrompt {
	return {
		async choose<T>(
			label: string,
			choices: readonly AstraCliChoice<T>[],
		): Promise<T | null> {
			if (choices.length === 0) return null;
			const rl = createInterface({
				input: process.stdin,
				output: process.stdout,
			});
			try {
				process.stdout.write(`\n${label}\n`);
				choices.forEach((c, i) => {
					const hint = c.hint ? ` (${c.hint})` : "";
					process.stdout.write(`  ${i + 1}) ${c.label}${hint}\n`);
				});
				while (true) {
					const answer = (
						await rl.question(`Choice [1-${choices.length}]: `)
					).trim();
					if (answer === "" || answer.toLowerCase() === "q") {
						return null;
					}
					const idx = Number.parseInt(answer, 10);
					if (
						Number.isInteger(idx) &&
						idx >= 1 &&
						idx <= choices.length &&
						choices[idx - 1] !== undefined
					) {
						return choices[idx - 1]?.value as T;
					}
					process.stdout.write(
						`Invalid choice. Enter 1-${choices.length} or 'q' to quit.\n`,
					);
				}
			} finally {
				rl.close();
			}
		},
	};
}
