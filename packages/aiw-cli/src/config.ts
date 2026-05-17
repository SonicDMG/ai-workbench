/**
 * Profile-based CLI configuration.
 *
 * Mirrors how `gh`, `aws`, and `astra` handle multi-environment auth:
 * one config file at `~/.aiw/config.json` storing named profiles
 * (`{ url, apiKey }`), one active profile, and per-call overrides via
 * `--profile` / `--url` / `AIW_PROFILE`.
 *
 * The file is read and written with mode `0600` so API keys are not
 * world-readable on shared machines.
 */
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { z } from "zod";

/**
 * Persisted OIDC bearer credentials. Populated by `aiw login --oidc`
 * after the device-flow grant completes. `tokenType` defaults to
 * `"Bearer"`; `refreshToken` is optional (some IdPs issue them, some
 * don't); `expiresAt` is an ISO-8601 timestamp so the CLI can print a
 * "your token expired, re-run aiw login" hint without decoding the
 * JWT itself.
 */
const OidcCredentialsSchema = z.object({
	accessToken: z.string().min(1),
	refreshToken: z.string().min(1).optional(),
	expiresAt: z.string().min(1).optional(),
	tokenType: z.string().default("Bearer"),
});

const ProfileSchema = z.object({
	url: z.string().url(),
	apiKey: z.string().min(1).optional(),
	oidc: OidcCredentialsSchema.optional(),
	defaultWorkspace: z.string().optional(),
});

export type OidcCredentials = z.infer<typeof OidcCredentialsSchema>;

const ConfigSchema = z.object({
	active: z.string().optional(),
	profiles: z.record(z.string(), ProfileSchema).default({}),
});

export type Profile = z.infer<typeof ProfileSchema>;
export type Config = z.infer<typeof ConfigSchema>;

export interface ConfigLocation {
	readonly dir: string;
	readonly file: string;
}

export function defaultConfigLocation(): ConfigLocation {
	const dir = join(homedir(), ".aiw");
	return { dir, file: join(dir, "config.json") };
}

const EMPTY_CONFIG: Config = { active: undefined, profiles: {} };

export async function readConfig(
	loc: ConfigLocation = defaultConfigLocation(),
): Promise<Config> {
	try {
		const raw = await readFile(loc.file, "utf8");
		const parsed = JSON.parse(raw);
		return ConfigSchema.parse(parsed);
	} catch (err: unknown) {
		if (isNotFound(err)) return { ...EMPTY_CONFIG };
		throw err;
	}
}

export async function writeConfig(
	config: Config,
	loc: ConfigLocation = defaultConfigLocation(),
): Promise<void> {
	await mkdir(loc.dir, { recursive: true, mode: 0o700 });
	const serialized = `${JSON.stringify(config, null, 2)}\n`;
	await writeFile(loc.file, serialized, { encoding: "utf8", mode: 0o600 });
	// Re-apply mode in case the file already existed (writeFile mode is
	// only honored on creation on some platforms).
	await chmod(loc.file, 0o600);
}

export interface ResolveProfileOptions {
	readonly profileName?: string;
	readonly url?: string;
	readonly apiKey?: string;
	readonly env?: NodeJS.ProcessEnv;
}

export interface ResolvedProfile {
	readonly name: string;
	readonly profile: Profile;
	readonly source: "flag" | "env" | "config";
}

/**
 * Resolve which profile a command should use. Order of precedence:
 *   1. Explicit `--profile` flag.
 *   2. `AIW_PROFILE` env var.
 *   3. The config's `active` profile.
 *
 * `--url` and `AIW_API_URL` overrides are merged on top of the
 * resolved profile (the profile name is preserved so a later
 * `writeConfig` keeps the right slot).
 */
export function resolveProfile(
	config: Config,
	opts: ResolveProfileOptions = {},
): ResolvedProfile {
	const env = opts.env ?? process.env;

	const explicit = opts.profileName?.trim();
	const fromEnv = env.AIW_PROFILE?.trim();
	const fromConfig = config.active?.trim();

	const name = explicit || fromEnv || fromConfig;
	if (!name) {
		throw new ConfigError(
			"No active profile. Run `aiw login` first, or pass `--profile <name>`.",
		);
	}

	const source: ResolvedProfile["source"] = explicit
		? "flag"
		: fromEnv
			? "env"
			: "config";

	const stored = config.profiles[name];
	const url = opts.url || env.AIW_API_URL || stored?.url;
	const apiKey = opts.apiKey || env.AIW_API_KEY || stored?.apiKey;

	if (!url) {
		throw new ConfigError(
			`Profile "${name}" has no runtime URL. Set one with \`aiw login --profile ${name} --url <url>\`.`,
		);
	}

	const merged: Profile = {
		url,
		apiKey,
		oidc: stored?.oidc,
		defaultWorkspace: stored?.defaultWorkspace,
	};

	return { name, profile: merged, source };
}

export function setProfile(
	config: Config,
	name: string,
	profile: Profile,
): Config {
	const next: Config = {
		active: config.active ?? name,
		profiles: { ...config.profiles, [name]: profile },
	};
	return next;
}

export function deleteProfile(config: Config, name: string): Config {
	const rest: Record<string, Profile> = {};
	for (const [key, value] of Object.entries(config.profiles)) {
		if (key !== name) rest[key] = value;
	}
	return {
		active: config.active === name ? undefined : config.active,
		profiles: rest,
	};
}

export class ConfigError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "ConfigError";
	}
}

function isNotFound(err: unknown): boolean {
	return (
		typeof err === "object" &&
		err !== null &&
		"code" in err &&
		(err as { code: unknown }).code === "ENOENT"
	);
}
