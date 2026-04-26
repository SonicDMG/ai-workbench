import { describe, expect, test } from "vitest";
import { ConfigSchema } from "../src/config/schema.js";

describe("ConfigSchema", () => {
	test("accepts a minimal config (memory default)", () => {
		const cfg = ConfigSchema.parse({ version: 1 });
		expect(cfg.runtime.environment).toBe("development");
		expect(cfg.runtime.port).toBe(8080);
		expect(cfg.runtime.logLevel).toBe("info");
		expect(cfg.runtime.uiDir).toBe(null);
		expect(cfg.runtime.publicOrigin).toBe(null);
		expect(cfg.runtime.trustProxyHeaders).toBe(false);
		expect(cfg.controlPlane.driver).toBe("memory");
		expect(cfg.seedWorkspaces).toEqual([]);
	});

	test("accepts explicit memory driver with seeds", () => {
		const cfg = ConfigSchema.parse({
			version: 1,
			controlPlane: { driver: "memory" },
			seedWorkspaces: [{ name: "demo", kind: "mock" }],
		});
		expect(cfg.seedWorkspaces).toHaveLength(1);
		expect(cfg.seedWorkspaces[0]?.kind).toBe("mock");
	});

	test("accepts a file driver with a root", () => {
		const cfg = ConfigSchema.parse({
			version: 1,
			controlPlane: { driver: "file", root: "/var/lib/workbench" },
		});
		expect(cfg.controlPlane.driver).toBe("file");
	});

	test("accepts an astra driver with endpoint + tokenRef", () => {
		const cfg = ConfigSchema.parse({
			version: 1,
			controlPlane: {
				driver: "astra",
				endpoint: "https://x.apps.astra.datastax.com",
				tokenRef: "env:ASTRA_TOKEN",
			},
		});
		expect(cfg.controlPlane.driver).toBe("astra");
		if (cfg.controlPlane.driver === "astra") {
			expect(cfg.controlPlane.keyspace).toBe("workbench");
		}
	});

	test("accepts a bootstrap token ref for strict auth modes", () => {
		const cfg = ConfigSchema.parse({
			version: 1,
			auth: {
				mode: "apiKey",
				anonymousPolicy: "reject",
				bootstrapTokenRef: "env:WB_BOOTSTRAP_TOKEN",
			},
		});
		expect(cfg.auth.bootstrapTokenRef).toBe("env:WB_BOOTSTRAP_TOKEN");
	});

	test("accepts a hardened production config", () => {
		const cfg = ConfigSchema.parse({
			version: 1,
			runtime: {
				environment: "production",
				publicOrigin: "https://workbench.example.com",
			},
			controlPlane: { driver: "file", root: "/var/lib/workbench" },
			auth: {
				mode: "apiKey",
				anonymousPolicy: "reject",
				bootstrapTokenRef: "env:WB_BOOTSTRAP_TOKEN",
			},
		});
		expect(cfg.runtime.environment).toBe("production");
		expect(cfg.runtime.publicOrigin).toBe("https://workbench.example.com");
	});

	test("rejects production config with memory, disabled auth, or anonymous access", () => {
		expect(() =>
			ConfigSchema.parse({
				version: 1,
				runtime: { environment: "production" },
				controlPlane: { driver: "memory" },
				auth: { mode: "disabled", anonymousPolicy: "allow" },
			}),
		).toThrow(/durable control plane/);
	});

	test("rejects production OIDC browser login without persistent session key and public origin", () => {
		expect(() =>
			ConfigSchema.parse({
				version: 1,
				runtime: { environment: "production" },
				controlPlane: { driver: "file", root: "/var/lib/workbench" },
				auth: {
					mode: "oidc",
					anonymousPolicy: "reject",
					oidc: {
						issuer: "https://idp.example.com",
						audience: "ai-workbench",
						client: {
							clientId: "client",
						},
					},
				},
			}),
		).toThrow(/sessionSecretRef/);
	});

	test("rejects non-https public origins in production", () => {
		expect(() =>
			ConfigSchema.parse({
				version: 1,
				runtime: {
					environment: "production",
					publicOrigin: "http://workbench.example.com",
				},
				controlPlane: { driver: "file", root: "/var/lib/workbench" },
				auth: {
					mode: "apiKey",
					anonymousPolicy: "reject",
					bootstrapTokenRef: "env:WB_BOOTSTRAP_TOKEN",
				},
			}),
		).toThrow(/publicOrigin to use https/);
	});

	test("rejects unknown schema version", () => {
		expect(() => ConfigSchema.parse({ version: 2 })).toThrow();
	});

	test("rejects unknown control-plane driver", () => {
		expect(() =>
			ConfigSchema.parse({ version: 1, controlPlane: { driver: "oracle" } }),
		).toThrow();
	});

	test("rejects file driver without root", () => {
		expect(() =>
			ConfigSchema.parse({
				version: 1,
				controlPlane: { driver: "file" },
			}),
		).toThrow();
	});

	test("rejects astra driver with malformed tokenRef", () => {
		expect(() =>
			ConfigSchema.parse({
				version: 1,
				controlPlane: {
					driver: "astra",
					endpoint: "https://x.apps.astra.datastax.com",
					tokenRef: "plain-string-no-prefix",
				},
			}),
		).toThrow();
	});

	test("rejects bootstrap token refs when auth is disabled", () => {
		expect(() =>
			ConfigSchema.parse({
				version: 1,
				auth: {
					mode: "disabled",
					anonymousPolicy: "allow",
					bootstrapTokenRef: "env:WB_BOOTSTRAP_TOKEN",
				},
			}),
		).toThrow(/only valid when auth.mode/);
	});

	test("rejects seedWorkspaces when driver is not memory", () => {
		expect(() =>
			ConfigSchema.parse({
				version: 1,
				controlPlane: { driver: "file", root: "/tmp/x" },
				seedWorkspaces: [{ name: "demo", kind: "mock" }],
			}),
		).toThrow(/only meaningful with controlPlane.driver='memory'/);
	});

	test("rejects duplicate seed workspace names", () => {
		expect(() =>
			ConfigSchema.parse({
				version: 1,
				seedWorkspaces: [
					{ name: "a", kind: "mock" },
					{ name: "a", kind: "astra" },
				],
			}),
		).toThrow(/duplicate seed workspace name/);
	});
});
