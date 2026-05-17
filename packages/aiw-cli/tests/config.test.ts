import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	type Config,
	ConfigError,
	type ConfigLocation,
	deleteProfile,
	readConfig,
	resolveProfile,
	setProfile,
	writeConfig,
} from "../src/config.js";

let loc: ConfigLocation;

beforeEach(async () => {
	const dir = await mkdtemp(join(tmpdir(), "aiw-cli-config-"));
	loc = { dir, file: join(dir, "config.json") };
});

afterEach(async () => {
	await rm(loc.dir, { recursive: true, force: true });
});

describe("config file", () => {
	it("returns an empty config when the file does not exist", async () => {
		const cfg = await readConfig(loc);
		expect(cfg.profiles).toEqual({});
		expect(cfg.active).toBeUndefined();
	});

	it("writes the file with mode 0600", async () => {
		const cfg: Config = {
			active: "dev",
			profiles: { dev: { url: "http://localhost:8080", apiKey: "k" } },
		};
		await writeConfig(cfg, loc);
		const s = await stat(loc.file);
		// On macOS / Linux the mode bits map cleanly; ignore the file-type bits.
		expect(s.mode & 0o777).toBe(0o600);
		const raw = await readFile(loc.file, "utf8");
		expect(JSON.parse(raw)).toEqual(cfg);
	});

	it("round-trips through read/write", async () => {
		const cfg: Config = {
			active: "prod",
			profiles: {
				prod: { url: "https://api", apiKey: "ka" },
				dev: { url: "http://localhost:8080", apiKey: "kb" },
			},
		};
		await writeConfig(cfg, loc);
		const read = await readConfig(loc);
		expect(read).toEqual(cfg);
	});
});

describe("setProfile / deleteProfile", () => {
	const base: Config = {
		active: "dev",
		profiles: { dev: { url: "http://a", apiKey: "k1" } },
	};

	it("setProfile preserves other profiles and keeps active", () => {
		const next = setProfile(base, "prod", { url: "http://b", apiKey: "k2" });
		expect(next.profiles.dev).toEqual(base.profiles.dev);
		expect(next.profiles.prod).toEqual({ url: "http://b", apiKey: "k2" });
		expect(next.active).toBe("dev");
	});

	it("setProfile becomes the active profile when no active exists", () => {
		const empty: Config = { active: undefined, profiles: {} };
		const next = setProfile(empty, "first", { url: "http://a", apiKey: "k" });
		expect(next.active).toBe("first");
	});

	it("deleteProfile removes the profile and clears active when it matched", () => {
		const next = deleteProfile(base, "dev");
		expect(next.profiles.dev).toBeUndefined();
		expect(next.active).toBeUndefined();
	});

	it("deleteProfile leaves active alone when it didn't match", () => {
		const next = deleteProfile(
			{ ...base, profiles: { ...base.profiles, prod: { url: "x" } } },
			"prod",
		);
		expect(next.profiles.prod).toBeUndefined();
		expect(next.active).toBe("dev");
	});
});

describe("resolveProfile precedence", () => {
	const cfg: Config = {
		active: "dev",
		profiles: {
			dev: { url: "http://dev", apiKey: "k-dev" },
			prod: { url: "http://prod", apiKey: "k-prod" },
		},
	};

	it("uses --profile flag first", () => {
		const r = resolveProfile(cfg, {
			profileName: "prod",
			env: {} as NodeJS.ProcessEnv,
		});
		expect(r.name).toBe("prod");
		expect(r.source).toBe("flag");
		expect(r.profile.url).toBe("http://prod");
	});

	it("falls back to AIW_PROFILE env", () => {
		const r = resolveProfile(cfg, {
			env: { AIW_PROFILE: "prod" } as NodeJS.ProcessEnv,
		});
		expect(r.name).toBe("prod");
		expect(r.source).toBe("env");
	});

	it("falls back to config.active", () => {
		const r = resolveProfile(cfg, { env: {} as NodeJS.ProcessEnv });
		expect(r.name).toBe("dev");
		expect(r.source).toBe("config");
	});

	it("--url overrides the profile's url but keeps the api key", () => {
		const r = resolveProfile(cfg, {
			url: "http://override",
			env: {} as NodeJS.ProcessEnv,
		});
		expect(r.profile.url).toBe("http://override");
		expect(r.profile.apiKey).toBe("k-dev");
	});

	it("carries through stored OIDC credentials so the HTTP client can use them", () => {
		const oidcCfg: Config = {
			active: "oidc-profile",
			profiles: {
				"oidc-profile": {
					url: "http://api",
					oidc: {
						accessToken: "oidc.jwt.token",
						refreshToken: "rt-1",
						expiresAt: "2027-01-01T00:00:00.000Z",
						tokenType: "Bearer",
					},
				},
			},
		};
		const r = resolveProfile(oidcCfg, { env: {} as NodeJS.ProcessEnv });
		expect(r.profile.oidc?.accessToken).toBe("oidc.jwt.token");
		expect(r.profile.oidc?.refreshToken).toBe("rt-1");
		expect(r.profile.oidc?.tokenType).toBe("Bearer");
		expect(r.profile.apiKey).toBeUndefined();
	});

	it("AIW_API_URL works like --url", () => {
		const r = resolveProfile(cfg, {
			env: { AIW_API_URL: "http://env-url" } as NodeJS.ProcessEnv,
		});
		expect(r.profile.url).toBe("http://env-url");
	});

	it("throws when no profile is available anywhere", () => {
		expect(() =>
			resolveProfile(
				{ active: undefined, profiles: {} },
				{ env: {} as NodeJS.ProcessEnv },
			),
		).toThrow(ConfigError);
	});

	it("throws when the resolved profile has no URL anywhere", () => {
		expect(() =>
			resolveProfile(
				{
					active: "dev",
					profiles: { dev: { url: "" as unknown as string, apiKey: "k" } },
				},
				{ env: {} as NodeJS.ProcessEnv },
			),
		).toThrow(ConfigError);
	});
});
