import type { SpawnSyncReturns } from "node:child_process";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import {
	type AstraCliPrompt,
	type AstraCliRunner,
	buildDataApiEndpoint,
	discoverAstraCliInventory,
	listDatabases,
	listProfiles,
	loadAstraFromCli,
	parseDatabasesPayload,
	parseProfilesPayload,
} from "../src/config/astra-cli.js";

// Fixture tokens — explicitly opaque, not real credentials. secret-scan: allow
const FAKE_TOKEN = "AstraCS:fake:0000000000000000000000000000000000000000"; // secret-scan: allow
// secret-scan: allow
const FAKE_TOKEN_2 = "AstraCS:fake:1111111111111111111111111111111111111111"; // secret-scan: allow

interface ScriptedCall {
	readonly args: readonly string[];
	readonly result: SpawnSyncReturns<string>;
}

function ok(stdout: string): SpawnSyncReturns<string> {
	return {
		pid: 0,
		output: ["", stdout, ""],
		stdout,
		stderr: "",
		status: 0,
		signal: null,
	};
}

function fail(stderr: string, code = 1): SpawnSyncReturns<string> {
	return {
		pid: 0,
		output: ["", "", stderr],
		stdout: "",
		stderr,
		status: code,
		signal: null,
	};
}

function scriptedRunner(...calls: ScriptedCall[]): AstraCliRunner {
	let i = 0;
	return (args) => {
		const next = calls[i++];
		if (!next)
			throw new Error(`unexpected runner invocation ${i}: ${args.join(" ")}`);
		// Loose assertion: every expected arg must appear in the actual call.
		for (const a of next.args) {
			if (!args.includes(a)) {
				throw new Error(
					`runner call ${i} missing arg "${a}"; got: ${args.join(" ")}`,
				);
			}
		}
		return next.result;
	};
}

const profilesJson = JSON.stringify({
	code: "OK",
	data: [
		{
			isUsedAsDefault: true,
			name: "primary",
			env: "PROD",
			token: FAKE_TOKEN,
		},
		{
			isUsedAsDefault: false,
			name: "secondary",
			env: "DEV",
			token: FAKE_TOKEN_2,
		},
		{
			isUsedAsDefault: true,
			name: "default",
			env: "PROD",
			token: FAKE_TOKEN,
		},
	],
});

const singleProfileJson = JSON.stringify({
	code: "OK",
	data: [
		{
			isUsedAsDefault: true,
			name: "only",
			env: "PROD",
			token: FAKE_TOKEN,
		},
		{
			isUsedAsDefault: true,
			name: "default",
			env: "PROD",
			token: FAKE_TOKEN,
		},
	],
});

const databasesJson = JSON.stringify({
	code: "OK",
	data: [
		{
			id: "db-uuid-1",
			info: {
				name: "alpha",
				region: "us-east-2",
				keyspace: "default_keyspace",
			},
			status: "ACTIVE",
		},
		{
			id: "db-uuid-2",
			info: { name: "beta", region: "us-west-2", keyspace: "default_keyspace" },
			status: "ACTIVE",
		},
		{
			id: "db-uuid-terminated",
			info: { name: "gone", region: "us-east-2" },
			status: "TERMINATED",
		},
	],
});

const singleDbJson = JSON.stringify({
	code: "OK",
	data: [
		{
			id: "db-uuid-only",
			info: {
				name: "only-db",
				region: "eu-west-1",
				keyspace: "default_keyspace",
			},
			status: "ACTIVE",
		},
	],
});

const versionCall: ScriptedCall = { args: ["--version"], result: ok("v1.0.4") };

function rejectingPrompt(): AstraCliPrompt {
	return {
		choose: () => {
			throw new Error("prompt should not be invoked in this test");
		},
	};
}

function fixedPrompt(value: unknown): AstraCliPrompt {
	return {
		choose: async () => value as never,
	};
}

describe("parseProfilesPayload", () => {
	test("deduplicates the synthetic 'default' row", () => {
		const profiles = parseProfilesPayload(profilesJson);
		expect(profiles.map((p) => p.name)).toEqual(["primary", "secondary"]);
	});

	test("keeps the only profile when it's named default", () => {
		const profiles = parseProfilesPayload(singleProfileJson);
		expect(profiles.map((p) => p.name)).toEqual(["only"]);
	});

	test("rejects entries missing required fields", () => {
		const json = JSON.stringify({
			data: [{ name: "broken" }, { token: "no-name" }],
		});
		expect(parseProfilesPayload(json)).toEqual([]);
	});
});

describe("parseDatabasesPayload", () => {
	test("filters terminated databases and builds the data api endpoint", () => {
		const dbs = parseDatabasesPayload(databasesJson);
		expect(dbs.map((d) => d.name)).toEqual(["alpha", "beta"]);
		expect(dbs[0]?.endpoint).toBe(
			"https://db-uuid-1-us-east-2.apps.astra.datastax.com",
		);
	});
});

describe("buildDataApiEndpoint", () => {
	test("formats id and region into the standard data api host", () => {
		expect(buildDataApiEndpoint("abc", "us-east-2")).toBe(
			"https://abc-us-east-2.apps.astra.datastax.com",
		);
	});
});

describe("listProfiles / listDatabases", () => {
	test("listProfiles surfaces parse errors as cli-error", () => {
		const runner = scriptedRunner({
			args: ["config", "list"],
			result: ok("not-json"),
		});
		const result = listProfiles(runner);
		expect(result.status).toBe("error");
	});

	test("listDatabases passes the profile flag", () => {
		const runner: AstraCliRunner = (args) => {
			expect(args).toContain("-p");
			expect(args).toContain("primary");
			return ok(databasesJson);
		};
		const result = listDatabases(runner, "primary");
		expect(result.status).toBe("ok");
	});
});

describe("loadAstraFromCli", () => {
	const KEYS = [
		"ASTRA_DB_APPLICATION_TOKEN",
		"ASTRA_DB_API_ENDPOINT",
		"ASTRA_PROFILE",
		"ASTRA_DB",
		"WORKBENCH_DISABLE_ASTRA_CLI",
	] as const;
	const saved: Record<string, string | undefined> = {};

	beforeEach(() => {
		for (const k of KEYS) {
			saved[k] = process.env[k];
			delete process.env[k];
		}
	});

	afterEach(() => {
		for (const k of KEYS) {
			if (saved[k] === undefined) delete process.env[k];
			else process.env[k] = saved[k];
		}
	});

	test("skips when both env vars are already set", async () => {
		const env = {
			ASTRA_DB_APPLICATION_TOKEN: "preset",
			ASTRA_DB_API_ENDPOINT: "preset",
		};
		const runner: AstraCliRunner = () => {
			throw new Error("runner should not be invoked");
		};
		const result = await loadAstraFromCli({ env, runner });
		expect(result).toEqual({ status: "skipped", reason: "already-configured" });
	});

	test("respects WORKBENCH_DISABLE_ASTRA_CLI", async () => {
		const env: NodeJS.ProcessEnv = { WORKBENCH_DISABLE_ASTRA_CLI: "1" };
		const result = await loadAstraFromCli({ env, runner: () => ok("") });
		expect(result).toEqual({ status: "skipped", reason: "disabled" });
	});

	test("skips when astra binary is missing", async () => {
		const env: NodeJS.ProcessEnv = {};
		const runner: AstraCliRunner = () => {
			throw new Error("ENOENT");
		};
		const result = await loadAstraFromCli({ env, runner });
		expect(result).toEqual({ status: "skipped", reason: "binary-not-found" });
	});

	test("auto-selects single profile + single database without prompting", async () => {
		const env: NodeJS.ProcessEnv = {};
		const runner = scriptedRunner(
			versionCall,
			{ args: ["config", "list"], result: ok(singleProfileJson) },
			{ args: ["db", "list"], result: ok(singleDbJson) },
		);
		const writes: string[] = [];
		const result = await loadAstraFromCli({
			env,
			runner,
			prompt: rejectingPrompt(),
			interactive: true,
			write: (c) => writes.push(c),
		});
		expect(result.status).toBe("loaded");
		if (result.status !== "loaded") return;
		expect(result.profile).toBe("only");
		expect(result.database.name).toBe("only-db");
		expect(env.ASTRA_DB_APPLICATION_TOKEN).toBe(FAKE_TOKEN);
		expect(env.ASTRA_DB_API_ENDPOINT).toBe(
			"https://db-uuid-only-eu-west-1.apps.astra.datastax.com",
		);
		const banner = writes.join("");
		expect(banner).toContain('[astra-cli] using profile "only"');
		expect(banner).toContain("database: only-db");
		expect(banner).toContain("region:   eu-west-1");
		expect(banner).toContain(
			"endpoint: https://db-uuid-only-eu-west-1.apps.astra.datastax.com",
		);
		expect(banner).toContain("keyspace: default_keyspace");
		expect(banner).not.toContain(FAKE_TOKEN);
	});

	test("banner reports preset endpoint when env var was already set", async () => {
		const env: NodeJS.ProcessEnv = { ASTRA_DB_API_ENDPOINT: "preset-endpoint" };
		const runner = scriptedRunner(
			versionCall,
			{ args: ["config", "list"], result: ok(singleProfileJson) },
			{ args: ["db", "list"], result: ok(singleDbJson) },
		);
		const writes: string[] = [];
		const result = await loadAstraFromCli({
			env,
			runner,
			prompt: rejectingPrompt(),
			interactive: true,
			write: (c) => writes.push(c),
		});
		expect(result.status).toBe("loaded");
		const banner = writes.join("");
		expect(banner).toContain("(overridden by ASTRA_DB_API_ENDPOINT)");
	});

	test("uses ASTRA_PROFILE to skip the profile prompt", async () => {
		const env: NodeJS.ProcessEnv = { ASTRA_PROFILE: "secondary" };
		const runner = scriptedRunner(
			versionCall,
			{ args: ["config", "list"], result: ok(profilesJson) },
			{ args: ["db", "list", "secondary"], result: ok(singleDbJson) },
		);
		const result = await loadAstraFromCli({
			env,
			runner,
			prompt: rejectingPrompt(),
			interactive: true,
		});
		expect(result.status).toBe("loaded");
		if (result.status === "loaded") {
			expect(result.profile).toBe("secondary");
			expect(env.ASTRA_DB_APPLICATION_TOKEN).toBe(FAKE_TOKEN_2);
		}
	});

	test("uses ASTRA_DB to skip the database prompt", async () => {
		const env: NodeJS.ProcessEnv = {
			ASTRA_PROFILE: "primary",
			ASTRA_DB: "beta",
		};
		const runner = scriptedRunner(
			versionCall,
			{ args: ["config", "list"], result: ok(profilesJson) },
			{ args: ["db", "list"], result: ok(databasesJson) },
		);
		const result = await loadAstraFromCli({
			env,
			runner,
			prompt: rejectingPrompt(),
			interactive: true,
		});
		expect(result.status).toBe("loaded");
		if (result.status === "loaded") {
			expect(result.database.name).toBe("beta");
			expect(env.ASTRA_DB_API_ENDPOINT).toBe(
				"https://db-uuid-2-us-west-2.apps.astra.datastax.com",
			);
		}
	});

	test("non-interactive ambiguous database returns skip", async () => {
		const env: NodeJS.ProcessEnv = { ASTRA_PROFILE: "primary" };
		const runner = scriptedRunner(
			versionCall,
			{ args: ["config", "list"], result: ok(profilesJson) },
			{ args: ["db", "list"], result: ok(databasesJson) },
		);
		const result = await loadAstraFromCli({
			env,
			runner,
			prompt: rejectingPrompt(),
			interactive: false,
		});
		expect(result).toEqual({
			status: "skipped",
			reason: "ambiguous-database-non-interactive",
		});
		expect(env.ASTRA_DB_APPLICATION_TOKEN).toBeUndefined();
		expect(env.ASTRA_DB_API_ENDPOINT).toBeUndefined();
	});

	test("non-interactive ambiguous profile falls back to default", async () => {
		const env: NodeJS.ProcessEnv = {};
		const runner = scriptedRunner(
			versionCall,
			{ args: ["config", "list"], result: ok(profilesJson) },
			{ args: ["db", "list"], result: ok(singleDbJson) },
		);
		const result = await loadAstraFromCli({
			env,
			runner,
			prompt: rejectingPrompt(),
			interactive: false,
		});
		expect(result.status).toBe("loaded");
		if (result.status === "loaded") {
			expect(result.profile).toBe("primary");
		}
	});

	test("interactive prompt selects profile and database", async () => {
		const env: NodeJS.ProcessEnv = {};
		const runner = scriptedRunner(
			versionCall,
			{ args: ["config", "list"], result: ok(profilesJson) },
			{ args: ["db", "list"], result: ok(databasesJson) },
		);
		const calls: string[] = [];
		const prompt: AstraCliPrompt = {
			choose: async (label, choices) => {
				calls.push(label);
				// Always pick the second option to exercise non-default paths.
				return choices[1]?.value ?? null;
			},
		};
		const result = await loadAstraFromCli({
			env,
			runner,
			prompt,
			interactive: true,
		});
		expect(result.status).toBe("loaded");
		expect(calls).toHaveLength(2);
		if (result.status === "loaded") {
			expect(result.profile).toBe("secondary");
			expect(result.database.name).toBe("beta");
		}
	});

	test("user-aborted prompt yields user-aborted skip", async () => {
		const env: NodeJS.ProcessEnv = {};
		const runner = scriptedRunner(versionCall, {
			args: ["config", "list"],
			result: ok(profilesJson),
		});
		const result = await loadAstraFromCli({
			env,
			runner,
			prompt: fixedPrompt(null),
			interactive: true,
		});
		expect(result).toEqual({ status: "skipped", reason: "user-aborted" });
	});

	test("does not overwrite env vars that the user already set", async () => {
		const env: NodeJS.ProcessEnv = { ASTRA_DB_API_ENDPOINT: "preset-endpoint" };
		const runner = scriptedRunner(
			versionCall,
			{ args: ["config", "list"], result: ok(singleProfileJson) },
			{ args: ["db", "list"], result: ok(singleDbJson) },
		);
		const result = await loadAstraFromCli({
			env,
			runner,
			prompt: rejectingPrompt(),
			interactive: true,
		});
		expect(result.status).toBe("loaded");
		expect(env.ASTRA_DB_API_ENDPOINT).toBe("preset-endpoint");
		expect(env.ASTRA_DB_APPLICATION_TOKEN).toBe(FAKE_TOKEN);
	});

	test("cli error during profile list yields cli-error skip", async () => {
		const env: NodeJS.ProcessEnv = {};
		const runner = scriptedRunner(versionCall, {
			args: ["config", "list"],
			result: fail("auth required"),
		});
		const result = await loadAstraFromCli({
			env,
			runner,
			interactive: false,
		});
		expect(result).toEqual({ status: "skipped", reason: "cli-error" });
	});

	test("no databases returns no-databases skip", async () => {
		const env: NodeJS.ProcessEnv = {};
		const runner = scriptedRunner(
			versionCall,
			{ args: ["config", "list"], result: ok(singleProfileJson) },
			{ args: ["db", "list"], result: ok(JSON.stringify({ data: [] })) },
		);
		const result = await loadAstraFromCli({
			env,
			runner,
			interactive: false,
		});
		expect(result).toEqual({ status: "skipped", reason: "no-databases" });
	});
});

describe("discoverAstraCliInventory", () => {
	test("returns every profile + its databases, token-redacted", () => {
		const profilesJson = JSON.stringify({
			data: [
				{ name: "alpha", env: "PROD", token: FAKE_TOKEN },
				{
					name: "beta",
					env: "PROD",
					token: FAKE_TOKEN_2,
					isUsedAsDefault: true,
				},
			],
		});
		const alphaDbs = JSON.stringify({
			data: [
				{
					id: "11111111-1111-1111-1111-111111111111",
					status: "ACTIVE",
					info: { name: "alpha-db", region: "us-east-2" },
				},
			],
		});
		const betaDbs = JSON.stringify({
			data: [
				{
					id: "22222222-2222-2222-2222-222222222222",
					status: "ACTIVE",
					info: { name: "beta-db", region: "us-west-2" },
				},
			],
		});
		const runner: AstraCliRunner = (args) => {
			if (args[0] === "--version") return ok("astra/1.0.0");
			if (args[0] === "config" && args[1] === "list") return ok(profilesJson);
			if (args[0] === "db" && args[1] === "list") {
				const idx = args.indexOf("-p");
				const profile = idx >= 0 ? args[idx + 1] : "";
				if (profile === "alpha") return ok(alphaDbs);
				if (profile === "beta") return ok(betaDbs);
			}
			return fail("unexpected args");
		};
		const result = discoverAstraCliInventory({ env: {}, runner });
		expect(result.available).toBe(true);
		if (!result.available) throw new Error("unreachable");
		expect(result.profiles).toHaveLength(2);
		expect(result.profiles[0]).toMatchObject({
			name: "alpha",
			env: "PROD",
			isUsedAsDefault: false,
		});
		expect(result.profiles[1]).toMatchObject({
			name: "beta",
			isUsedAsDefault: true,
		});
		expect(result.profiles[0]?.databases?.[0]?.endpoint).toContain(
			"11111111-1111-1111-1111-111111111111-us-east-2",
		);
		// Tokens must never appear in the inventory payload.
		const serialized = JSON.stringify(result);
		expect(serialized).not.toContain(FAKE_TOKEN);
		expect(serialized).not.toContain(FAKE_TOKEN_2);
	});

	test("returns available:false reason:binary-not-found when astra is missing", () => {
		const runner: AstraCliRunner = () => fail("not found", 127);
		const result = discoverAstraCliInventory({ env: {}, runner });
		expect(result).toEqual({ available: false, reason: "binary-not-found" });
	});

	test("returns available:false reason:disabled when WORKBENCH_DISABLE_ASTRA_CLI=1", () => {
		const runner: AstraCliRunner = () => ok("");
		const result = discoverAstraCliInventory({
			env: { WORKBENCH_DISABLE_ASTRA_CLI: "1" },
			runner,
		});
		expect(result).toEqual({ available: false, reason: "disabled" });
	});

	test("returns available:false reason:no-profiles when CLI returns empty list", () => {
		const runner: AstraCliRunner = (args) => {
			if (args[0] === "--version") return ok("astra/1.0.0");
			return ok(JSON.stringify({ data: [] }));
		};
		const result = discoverAstraCliInventory({ env: {}, runner });
		expect(result).toEqual({ available: false, reason: "no-profiles" });
	});

	test("a per-profile listing failure does not poison the rest of the inventory", () => {
		const profilesJson = JSON.stringify({
			data: [
				{ name: "good", env: "PROD", token: FAKE_TOKEN },
				{ name: "broken", env: "PROD", token: FAKE_TOKEN_2 },
			],
		});
		const goodDbs = JSON.stringify({
			data: [
				{
					id: "11111111-1111-1111-1111-111111111111",
					status: "ACTIVE",
					info: { name: "good-db", region: "us-east-2" },
				},
			],
		});
		const runner: AstraCliRunner = (args) => {
			if (args[0] === "--version") return ok("astra/1.0.0");
			if (args[0] === "config" && args[1] === "list") return ok(profilesJson);
			const idx = args.indexOf("-p");
			const profile = idx >= 0 ? args[idx + 1] : "";
			if (profile === "good") return ok(goodDbs);
			return fail("token expired for broken profile");
		};
		const result = discoverAstraCliInventory({ env: {}, runner });
		expect(result.available).toBe(true);
		if (!result.available) throw new Error("unreachable");
		expect(result.profiles).toHaveLength(2);
		expect(result.profiles[0]?.databases).toHaveLength(1);
		// "broken" still appears in the listing — just with no databases.
		expect(result.profiles[1]?.name).toBe("broken");
		expect(result.profiles[1]?.databases).toEqual([]);
	});
});
