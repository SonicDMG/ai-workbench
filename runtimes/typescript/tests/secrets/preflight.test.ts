import { describe, expect, it } from "vitest";
import type { Config } from "../../src/config/schema.js";
import {
	assertConfigSecretsResolvable,
	probeConfigSecrets,
} from "../../src/secrets/preflight.js";
import {
	type SecretProvider,
	SecretResolver,
} from "../../src/secrets/provider.js";

class StubProvider implements SecretProvider {
	constructor(
		private readonly values: Readonly<Record<string, string>>,
		private readonly throwsFor: ReadonlySet<string> = new Set(),
	) {}
	async resolve(path: string): Promise<string> {
		if (this.throwsFor.has(path)) {
			throw new Error(`provider says no for '${path}'`);
		}
		return this.values[path] ?? "";
	}
}

function memoryConfig(overrides: Partial<Config> = {}): Config {
	return {
		version: 1,
		runtime: {
			environment: "development",
			port: 8080,
			logLevel: "warn",
			requestIdHeader: "X-Request-Id",
			uiDir: null,
			replicaId: null,
			publicOrigin: null,
			trustProxyHeaders: false,
			rateLimit: { enabled: false, capacity: 600, windowMs: 60_000 },
			blockPrivateNetworkEndpoints: false,
		},
		controlPlane: { driver: "memory" },
		auth: {
			mode: "disabled",
			anonymousPolicy: "allow",
			bootstrapTokenRef: null,
			acknowledgeOpenAccess: true,
		},
		seedWorkspaces: [],
		mcp: { enabled: false, exposeChat: false },
		...overrides,
	} as Config;
}

describe("preflight", () => {
	it("returns no misses when there are no secret refs to check", async () => {
		const resolver = new SecretResolver({ env: new StubProvider({}) });
		const misses = await probeConfigSecrets(memoryConfig(), resolver);
		expect(misses).toHaveLength(0);
	});

	it("reports a fatal miss for a required ref that fails to resolve", async () => {
		const resolver = new SecretResolver({
			env: new StubProvider({}, new Set(["MISSING_TOKEN"])),
		});
		const config = memoryConfig({
			controlPlane: {
				driver: "astra",
				endpoint: "https://example.com",
				tokenRef: "env:MISSING_TOKEN",
				keyspace: "workbench",
				jobPollIntervalMs: 500,
			},
		} as Partial<Config>);
		const misses = await probeConfigSecrets(config, resolver);
		expect(misses).toHaveLength(1);
		const [miss] = misses;
		expect(miss?.path).toBe("controlPlane.tokenRef");
		expect(miss?.reason.endsWith("(advisory)")).toBe(false);
	});

	it("reports advisory misses for seed-workspace credentials", async () => {
		const resolver = new SecretResolver({
			env: new StubProvider({}, new Set(["MISSING_TOKEN"])),
		});
		const config = memoryConfig({
			seedWorkspaces: [
				{
					uid: "11111111-1111-1111-1111-111111111111",
					name: "demo",
					kind: "astra",
					url: "https://example.com",
					keyspace: null,
					credentials: { token: "env:MISSING_TOKEN" },
				},
			],
		} as Partial<Config>);
		const misses = await probeConfigSecrets(config, resolver);
		expect(misses).toHaveLength(1);
		expect(misses[0]?.reason.endsWith("(advisory)")).toBe(true);
	});

	it("throws on fatal misses but tolerates advisory ones", async () => {
		const resolver = new SecretResolver({
			env: new StubProvider({}, new Set(["MISSING_TOKEN"])),
		});
		const config = memoryConfig({
			controlPlane: {
				driver: "astra",
				endpoint: "https://example.com",
				tokenRef: "env:MISSING_TOKEN",
				keyspace: "workbench",
				jobPollIntervalMs: 500,
			},
		} as Partial<Config>);
		await expect(
			assertConfigSecretsResolvable(config, resolver),
		).rejects.toThrow(/startup secret check failed/);
	});

	it("flags an empty resolved value as a miss", async () => {
		const resolver = new SecretResolver({
			env: new StubProvider({ HUGGING_FACE: "" }),
		});
		const config = memoryConfig({
			chat: {
				tokenRef: "env:HUGGING_FACE",
				model: "x",
				maxOutputTokens: 100,
				retrievalK: 4,
			} as Config["chat"],
		});
		const misses = await probeConfigSecrets(config, resolver);
		expect(misses).toHaveLength(1);
		expect(misses[0]?.reason).toMatch(/empty string/);
	});
});
