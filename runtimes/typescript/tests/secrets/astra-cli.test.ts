/**
 * Unit coverage for `AstraCliSecretProvider`. Validates the
 * `astra-cli:<profile>:<dbId>:<token|endpoint>` ref scheme:
 *
 *   - parses the path correctly (3 segments)
 *   - rejects malformed paths with actionable errors
 *   - resolves token from the profile, endpoint from the database
 *   - caches the CLI shellout so repeat resolves don't re-invoke
 *   - surfaces helpful "did you mean" lists when profile or db is wrong
 *   - degrades gracefully when the `astra` binary isn't on PATH
 */

import type { SpawnSyncReturns } from "node:child_process";
import { describe, expect, test, vi } from "vitest";
import {
	AstraCliSecretProvider,
	AstraCliSecretRefError,
} from "../../src/secrets/astra-cli.js";

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

function err(stderr: string): SpawnSyncReturns<string> {
	return {
		pid: 0,
		output: ["", "", stderr],
		stdout: "",
		stderr,
		status: 1,
		signal: null,
	};
}

const PROFILES_JSON = JSON.stringify({
	data: [
		{ name: "staging", env: "PROD", token: "AstraCS:STAGING_TOKEN" },
		{
			name: "prod",
			env: "PROD",
			token: "AstraCS:PROD_TOKEN",
			isUsedAsDefault: true,
		},
	],
});

const STAGING_DBS_JSON = JSON.stringify({
	data: [
		{
			id: "11111111-2222-3333-4444-555555555555",
			status: "ACTIVE",
			info: { name: "staging-db", region: "us-east-2" },
		},
	],
});

const PROD_DBS_JSON = JSON.stringify({
	data: [
		{
			id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
			status: "ACTIVE",
			info: { name: "prod-db-east", region: "us-east-2" },
		},
		{
			id: "ffffffff-0000-1111-2222-333333333333",
			status: "ACTIVE",
			info: { name: "prod-db-west", region: "us-west-2" },
		},
	],
});

function makeRunner() {
	return vi.fn((args: readonly string[]) => {
		if (args[0] === "--version") return ok("astra/1.0.0");
		if (args[0] === "config" && args[1] === "list") return ok(PROFILES_JSON);
		if (args[0] === "db" && args[1] === "list") {
			const profileFlag = args.indexOf("-p");
			const profile = profileFlag >= 0 ? args[profileFlag + 1] : "";
			if (profile === "staging") return ok(STAGING_DBS_JSON);
			if (profile === "prod") return ok(PROD_DBS_JSON);
			return ok(JSON.stringify({ data: [] }));
		}
		return err(`unexpected args: ${args.join(" ")}`);
	});
}

describe("AstraCliSecretProvider — ref parsing", () => {
	test("rejects an empty path", async () => {
		const provider = new AstraCliSecretProvider({ runner: makeRunner() });
		await expect(provider.resolve("")).rejects.toThrow(AstraCliSecretRefError);
	});

	test("rejects a path with too few segments", async () => {
		const provider = new AstraCliSecretProvider({ runner: makeRunner() });
		await expect(provider.resolve("staging:token")).rejects.toThrow(
			/expected.*profile.*dbId.*token.*endpoint/,
		);
	});

	test("rejects an unknown key (not token or endpoint)", async () => {
		const provider = new AstraCliSecretProvider({ runner: makeRunner() });
		await expect(
			provider.resolve("staging:11111111-2222-3333-4444-555555555555:keyspace"),
		).rejects.toThrow(/unsupported key 'keyspace'/);
	});
});

describe("AstraCliSecretProvider — happy path", () => {
	test("resolves :token from the profile", async () => {
		const provider = new AstraCliSecretProvider({ runner: makeRunner() });
		const value = await provider.resolve(
			"staging:11111111-2222-3333-4444-555555555555:token",
		);
		expect(value).toBe("AstraCS:STAGING_TOKEN");
	});

	test("resolves :endpoint from the matching database", async () => {
		const provider = new AstraCliSecretProvider({ runner: makeRunner() });
		const value = await provider.resolve(
			"prod:ffffffff-0000-1111-2222-333333333333:endpoint",
		);
		expect(value).toBe(
			"https://ffffffff-0000-1111-2222-333333333333-us-west-2.apps.astra.datastax.com",
		);
	});

	test("token never appears in error messages even when the path is malformed near it", async () => {
		const runner = makeRunner();
		const provider = new AstraCliSecretProvider({ runner });
		try {
			await provider.resolve("prod:wrong-db-id:endpoint");
			throw new Error("should have thrown");
		} catch (e) {
			const msg = e instanceof Error ? e.message : String(e);
			expect(msg).not.toContain("AstraCS:");
			expect(msg).not.toContain("PROD_TOKEN");
		}
	});
});

describe("AstraCliSecretProvider — unknown identifiers", () => {
	test("unknown profile lists the known profiles in the error", async () => {
		const provider = new AstraCliSecretProvider({ runner: makeRunner() });
		await expect(
			provider.resolve("nope:11111111-2222-3333-4444-555555555555:token"),
		).rejects.toThrow(/profile 'nope'.*staging.*prod/);
	});

	test("unknown database under a valid profile lists known dbs", async () => {
		const provider = new AstraCliSecretProvider({ runner: makeRunner() });
		await expect(
			provider.resolve("prod:00000000-0000-0000-0000-000000000000:endpoint"),
		).rejects.toThrow(/prod-db-east|prod-db-west/);
	});
});

describe("AstraCliSecretProvider — caching", () => {
	test("repeated resolves shell out only once for profiles + once per profile for databases", async () => {
		const runner = makeRunner();
		const provider = new AstraCliSecretProvider({ runner });

		await provider.resolve(
			"staging:11111111-2222-3333-4444-555555555555:token",
		);
		await provider.resolve(
			"staging:11111111-2222-3333-4444-555555555555:endpoint",
		);
		await provider.resolve(
			"prod:aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee:endpoint",
		);

		const calls = runner.mock.calls.map((args) =>
			args[0].slice(0, 2).join(" "),
		);
		// One --version probe, one `config list`, one `db list -p staging`,
		// one `db list -p prod`. Anything more means caching is broken.
		expect(calls.filter((c) => c === "config list")).toHaveLength(1);
		expect(calls.filter((c) => c === "db list")).toHaveLength(2);
	});
});

describe("AstraCliSecretProvider — degraded states", () => {
	test("missing astra binary surfaces an actionable error", async () => {
		const runner = vi.fn(() => err("astra: command not found"));
		const provider = new AstraCliSecretProvider({ runner });
		await expect(
			provider.resolve("staging:11111111-2222-3333-4444-555555555555:token"),
		).rejects.toThrow(/astra cli not available/);
	});

	test("CLI returning a non-zero status surfaces stderr context", async () => {
		const runner = vi.fn((args: readonly string[]) => {
			if (args[0] === "--version") return ok("astra/1.0.0");
			return err("token expired; run `astra setup`");
		});
		const provider = new AstraCliSecretProvider({ runner });
		await expect(
			provider.resolve("staging:11111111-2222-3333-4444-555555555555:token"),
		).rejects.toThrow(/astra config list failed.*token expired/);
	});
});
