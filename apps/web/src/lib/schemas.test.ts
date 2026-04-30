import { describe, expect, test } from "vitest";
import type { components } from "./api-types.generated";
import {
	WorkspaceKindSchema,
	WorkspacePageSchema,
	WorkspaceRecordSchema,
} from "./schemas";

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

describe("schema/openapi drift detection", () => {
	test("WorkspaceKindSchema enum matches the generated OpenAPI type", () => {
		// `WorkspaceKind` (the type alias) is derived from
		// `components["schemas"]["Workspace"]["kind"]`, so a backend
		// change that adds a new kind makes the generated types include
		// the new value automatically. The hand-written Zod enum below
		// is what the UI uses for runtime parsing — verify it's a
		// superset of the type-level union by attempting to satisfy
		// each branch.
		type RuntimeKind = components["schemas"]["Workspace"]["kind"];
		const exhaust: Record<RuntimeKind, true> = {
			astra: true,
			hcd: true,
			openrag: true,
			mock: true,
		};
		// If the contract grows a new kind, this object literal no
		// longer satisfies `Record<RuntimeKind, true>` and the build
		// breaks — forcing the developer to update the Zod enum below.
		void exhaust;

		const enumValues = WorkspaceKindSchema.options;
		expect([...enumValues].sort()).toEqual(
			["astra", "hcd", "mock", "openrag"].sort(),
		);
	});
});
