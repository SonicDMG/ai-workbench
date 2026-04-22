import { describe, expect, test } from "vitest";
import { ConfigSchema } from "../src/config/schema.js";

describe("ConfigSchema", () => {
	test("accepts a minimal config (memory default)", () => {
		const cfg = ConfigSchema.parse({ version: 1 });
		expect(cfg.runtime.port).toBe(8080);
		expect(cfg.runtime.logLevel).toBe("info");
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
