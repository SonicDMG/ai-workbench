/**
 * Resolves `astra-cli:<profile>:<dbId>:<token|endpoint>` →
 * the matching value sourced from the developer's
 * [DataStax astra CLI](https://github.com/datastax/astra-cli)
 * configuration.
 *
 * Why this exists: the boot-time astra-cli integration in
 * {@link ../config/astra-cli.ts} picks ONE profile + database for the
 * whole runtime by injecting `ASTRA_DB_APPLICATION_TOKEN` and
 * `ASTRA_DB_API_ENDPOINT` into `process.env`. That works for the
 * control plane (which is per-runtime), but a workspace's vector data
 * lives in its own database — and different workspaces can legitimately
 * point at different Astra databases. Hard-coding the boot-time choice
 * into every workspace's `credentialsRef` would force a runtime restart
 * every time someone wanted to onboard a workspace against a different
 * profile.
 *
 * With this provider, a workspace's `credentialsRef` can carry e.g.
 * `astra-cli:staging:11111111-…:token` and the resolver shells out to
 * the CLI on demand — no env-var contamination, no restart.
 *
 * Path format (`<provider>:<path>` strips `astra-cli:` first):
 *
 *   <profile>:<dbId>:<key>
 *
 *   - `profile` — name of an `astra config list` entry
 *   - `dbId`    — UUID-shaped database id from `astra db list`. Names
 *                 are mutable; ids aren't, so workspace records bind to
 *                 the immutable identifier.
 *   - `key`     — `token` or `endpoint`
 *
 * Caching: profiles and per-profile database lists are cached for the
 * process lifetime. The CLI is shelled out at most once per profile
 * for databases and exactly once for the profile list. Errors are NOT
 * cached so a transient CLI failure doesn't poison subsequent resolves.
 *
 * Tokens never appear in error messages — only profile names and
 * database identifiers.
 */

import {
	type SpawnSyncOptionsWithStringEncoding,
	type SpawnSyncReturns,
	spawnSync,
} from "node:child_process";
import {
	type AstraCliDatabase,
	type AstraCliProfile,
	type AstraCliRunner,
	buildDataApiEndpoint,
	listDatabases,
	listProfiles,
} from "../config/astra-cli.js";
import type { SecretProvider } from "./provider.js";

const DEFAULT_BIN = "astra";

export class AstraCliSecretRefError extends Error {
	constructor(reason: string) {
		super(`astra-cli secret ref rejected: ${reason}`);
		this.name = "AstraCliSecretRefError";
	}
}

export interface AstraCliSecretProviderOptions {
	readonly binary?: string;
	readonly runner?: AstraCliRunner;
}

interface ParsedPath {
	readonly profile: string;
	readonly dbId: string;
	readonly key: "token" | "endpoint";
}

export class AstraCliSecretProvider implements SecretProvider {
	private readonly runner: AstraCliRunner;
	private profilesPromise: Promise<readonly AstraCliProfile[]> | null = null;
	private readonly databasePromises = new Map<
		string,
		Promise<readonly AstraCliDatabase[]>
	>();
	private binaryProbed = false;
	private binaryAvailable = false;

	constructor(options: AstraCliSecretProviderOptions = {}) {
		const binary = options.binary ?? DEFAULT_BIN;
		this.runner = options.runner ?? defaultRunner(binary);
	}

	async resolve(path: string): Promise<string> {
		const parsed = parsePath(path);
		this.assertBinaryAvailable();
		const profile = await this.getProfile(parsed.profile);
		if (parsed.key === "token") {
			return profile.token;
		}
		const database = await this.getDatabase(parsed.profile, parsed.dbId);
		return buildDataApiEndpoint(database.id, database.region);
	}

	private assertBinaryAvailable(): void {
		if (!this.binaryProbed) {
			this.binaryProbed = true;
			try {
				const result = this.runner(["--version"]);
				this.binaryAvailable = result.status === 0;
			} catch {
				this.binaryAvailable = false;
			}
		}
		if (!this.binaryAvailable) {
			throw new AstraCliSecretRefError(
				"astra cli not available on PATH; install it from https://github.com/datastax/astra-cli or replace this credentialsRef with a literal env: token",
			);
		}
	}

	private async getProfile(name: string): Promise<AstraCliProfile> {
		const profiles = await this.loadProfiles();
		const match = profiles.find((p) => p.name === name);
		if (!match) {
			const known = profiles.map((p) => p.name).join(", ") || "<none>";
			throw new AstraCliSecretRefError(
				`profile '${name}' not found in astra-cli (known: ${known})`,
			);
		}
		return match;
	}

	private async getDatabase(
		profileName: string,
		dbId: string,
	): Promise<AstraCliDatabase> {
		const databases = await this.loadDatabases(profileName);
		const match = databases.find((d) => d.id === dbId);
		if (!match) {
			const known =
				databases.map((d) => `${d.name} (${d.id})`).join(", ") || "<none>";
			throw new AstraCliSecretRefError(
				`database '${dbId}' not found under profile '${profileName}' (known: ${known})`,
			);
		}
		return match;
	}

	private loadProfiles(): Promise<readonly AstraCliProfile[]> {
		if (!this.profilesPromise) {
			this.profilesPromise = (async () => {
				const result = listProfiles(this.runner);
				if (result.status !== "ok") {
					this.profilesPromise = null;
					throw new AstraCliSecretRefError(
						`astra config list failed: ${result.stderr || "<no stderr>"}`,
					);
				}
				return result.data;
			})();
		}
		return this.profilesPromise;
	}

	private loadDatabases(
		profileName: string,
	): Promise<readonly AstraCliDatabase[]> {
		const cached = this.databasePromises.get(profileName);
		if (cached) return cached;
		const promise = (async () => {
			const result = listDatabases(this.runner, profileName);
			if (result.status !== "ok") {
				this.databasePromises.delete(profileName);
				throw new AstraCliSecretRefError(
					`astra db list -p ${profileName} failed: ${result.stderr || "<no stderr>"}`,
				);
			}
			return result.data;
		})();
		this.databasePromises.set(profileName, promise);
		return promise;
	}
}

function parsePath(path: string): ParsedPath {
	if (path.length === 0) {
		throw new AstraCliSecretRefError(
			"empty path — expected '<profile>:<dbId>:<token|endpoint>'",
		);
	}
	const parts = path.split(":");
	if (parts.length !== 3) {
		throw new AstraCliSecretRefError(
			`expected '<profile>:<dbId>:<token|endpoint>' (3 colon-separated segments), got '${path}'`,
		);
	}
	const [profile, dbId, key] = parts as [string, string, string];
	if (profile.length === 0) {
		throw new AstraCliSecretRefError("profile segment is empty");
	}
	if (dbId.length === 0) {
		throw new AstraCliSecretRefError("dbId segment is empty");
	}
	if (key !== "token" && key !== "endpoint") {
		throw new AstraCliSecretRefError(
			`unsupported key '${key}'; expected 'token' or 'endpoint'`,
		);
	}
	return { profile, dbId, key };
}

function defaultRunner(binary: string): AstraCliRunner {
	const opts: SpawnSyncOptionsWithStringEncoding = {
		encoding: "utf8",
		env: { ...process.env, NO_COLOR: "1" },
	};
	return (args: readonly string[]): SpawnSyncReturns<string> =>
		spawnSync(binary, [...args, "--no-spinner"], opts);
}
