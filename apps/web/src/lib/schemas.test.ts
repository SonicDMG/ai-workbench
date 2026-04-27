import { describe, expect, test } from "vitest";
import { WorkspacePageSchema, WorkspaceRecordSchema } from "./schemas";

const FULL = {
	workspaceId: "11111111-2222-4333-8444-555555555555",
	name: "prod",
	url: "https://prod.example",
	kind: "astra" as const,
	credentials: { token: "env:ASTRA_TOKEN" },
	keyspace: "workbench",
	createdAt: "2026-04-22T00:00:00.000Z",
	updatedAt: "2026-04-22T00:00:01.000Z",
};

describe("WorkspaceRecordSchema", () => {
	test("parses a fully populated record", () => {
		const parsed = WorkspaceRecordSchema.parse(FULL);
		expect(parsed.url).toBe("https://prod.example");
		expect(parsed.keyspace).toBe("workbench");
		expect(parsed.credentials).toEqual({ token: "env:ASTRA_TOKEN" });
	});

	test("treats missing url/keyspace as null (defensive against runtime variance)", () => {
		// Astra rows written before url/keyspace existed serialize
		// these fields as undefined. JSON drops them, the UI receives
		// `{}` for those keys. Schema should accept that and normalize
		// to null so downstream UI can treat null/missing the same.
		const { url: _u, keyspace: _n, ...minimal } = FULL;
		const parsed = WorkspaceRecordSchema.parse(minimal);
		expect(parsed.url).toBeNull();
		expect(parsed.keyspace).toBeNull();
	});

	test("treats missing credentials as empty record", () => {
		const { credentials: _c, ...withoutCreds } = FULL;
		const parsed = WorkspaceRecordSchema.parse(withoutCreds);
		expect(parsed.credentials).toEqual({});
	});

	test("still rejects invalid types — non-string url", () => {
		expect(() => WorkspaceRecordSchema.parse({ ...FULL, url: 42 })).toThrow();
	});

	test("page schema parses an items array of mixed-shape rows", () => {
		// One legacy row (missing optional fields), one fully populated.
		const { url: _u, keyspace: _n, credentials: _c, ...legacy } = FULL;
		const page = {
			items: [legacy, FULL],
			nextCursor: null,
		};
		const parsed = WorkspacePageSchema.parse(page);
		expect(parsed.items).toHaveLength(2);
		expect(parsed.items[0]?.url).toBeNull();
		expect(parsed.items[0]?.credentials).toEqual({});
		expect(parsed.items[1]?.url).toBe("https://prod.example");
	});
});
