import { describe, expect, test } from "vitest";
import { ConfigSchema } from "../src/config/schema.js";

const minimalMock = {
	version: 1,
	workspaces: [
		{
			id: "mock",
			driver: "mock",
			vectorStores: [{ id: "v1", collection: "c", dimensions: 128 }],
			catalogs: [{ id: "cat1", vectorStore: "v1" }],
		},
	],
};

describe("ConfigSchema", () => {
	test("accepts a minimal mock config", () => {
		const cfg = ConfigSchema.parse(minimalMock);
		expect(cfg.workspaces).toHaveLength(1);
		expect(cfg.runtime.port).toBe(8080);
		expect(cfg.runtime.logLevel).toBe("info");
		expect(cfg.runtime.requestIdHeader).toBe("X-Request-Id");
	});

	test("accepts a full astra config", () => {
		const cfg = ConfigSchema.parse({
			version: 1,
			runtime: { port: 9000, logLevel: "debug" },
			workspaces: [
				{
					id: "prod",
					driver: "astra",
					astra: {
						endpoint: "https://example.apps.astra.datastax.com",
						token: "tok",
						keyspace: "ks",
					},
					auth: { kind: "bearer", tokens: ["wb-tok"] },
					vectorStores: [{ id: "v1", collection: "c", dimensions: 1536 }],
					catalogs: [{ id: "cat1", vectorStore: "v1" }],
				},
			],
		});
		expect(cfg.runtime.port).toBe(9000);
	});

	test("rejects unknown schema version", () => {
		expect(() => ConfigSchema.parse({ ...minimalMock, version: 2 })).toThrow();
	});

	test("rejects invalid workspace id", () => {
		expect(() =>
			ConfigSchema.parse({
				...minimalMock,
				workspaces: [
					{
						...minimalMock.workspaces[0],
						id: "Invalid_ID",
					},
				],
			}),
		).toThrow();
	});

	test("rejects duplicate workspace ids", () => {
		expect(() =>
			ConfigSchema.parse({
				...minimalMock,
				workspaces: [minimalMock.workspaces[0], minimalMock.workspaces[0]],
			}),
		).toThrow(/duplicate workspace id/);
	});

	test("rejects catalog referencing unknown vectorStore", () => {
		expect(() =>
			ConfigSchema.parse({
				...minimalMock,
				workspaces: [
					{
						...minimalMock.workspaces[0],
						catalogs: [{ id: "cat1", vectorStore: "does-not-exist" }],
					},
				],
			}),
		).toThrow(/unknown vectorStore/);
	});

	test("rejects two catalogs binding same vectorStore", () => {
		expect(() =>
			ConfigSchema.parse({
				...minimalMock,
				workspaces: [
					{
						...minimalMock.workspaces[0],
						catalogs: [
							{ id: "cat1", vectorStore: "v1" },
							{ id: "cat2", vectorStore: "v1" },
						],
					},
				],
			}),
		).toThrow(/1:1 binding/);
	});

	test("rejects astra workspace missing astra block", () => {
		expect(() =>
			ConfigSchema.parse({
				version: 1,
				workspaces: [
					{
						id: "prod",
						driver: "astra",
						vectorStores: [],
						catalogs: [],
					},
				],
			}),
		).toThrow();
	});
});
