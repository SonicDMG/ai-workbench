import type { SpawnSyncReturns } from "node:child_process";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import {
	type AstraCliPrompt,
	type AstraCliRunner,
	buildDataApiEndpoint,
	listDatabases,
	listProfiles,
	loadAstraFromCli,
	parseDatabasesPayload,
	parseProfilesPayload,
} from "../src/config/astra-cli.js";

const FAKE_TOKEN = "AstraCS:fake:0000000000000000000000000000000000000000";
const FAKE_TOKEN_2 = "AstraCS:fake:1111111111111111111111111111111111111111";

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
