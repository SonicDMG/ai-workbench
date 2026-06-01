import { describe, expect, test } from "vitest";
import type { components } from "./api-types.generated";
import {
	ApiKeyScopeSchema,
	SecretRefSchema,
	ToolSourceSchema,
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

	test("ApiKeyScopeSchema enum matches the generated OpenAPI type", () => {
		// `ApiKeyScope` widened in 0.5.0 from the three coarse tiers to the
		// full fine-grained taxonomy (coarse + per-facet + `tools:invoke`).
		// Same guard as the workspace-kind drift check: the exhaustiveness
		// record below stops compiling if the backend adds/removes a scope,
		// forcing the hand-written Zod enum to be updated in lockstep with a
		// `gen:types` refresh.
		type RuntimeScope = components["schemas"]["ApiKeyScope"];
		const exhaust: Record<RuntimeScope, true> = {
			read: true,
			"read:content": true,
			"read:chat": true,
			"read:audit": true,
			write: true,
			"write:ingest": true,
			"write:kb": true,
			"write:services": true,
			"write:agents": true,
			manage: true,
			"manage:keys": true,
			"manage:access": true,
			"manage:workspace": true,
			"tools:invoke": true,
		};
		void exhaust;

		const enumValues = ApiKeyScopeSchema.options;
		expect([...enumValues].sort()).toEqual(
			[
				"read",
				"read:content",
				"read:chat",
				"read:audit",
				"write",
				"write:ingest",
				"write:kb",
				"write:services",
				"write:agents",
				"manage",
				"manage:keys",
				"manage:access",
				"manage:workspace",
				"tools:invoke",
			].sort(),
		);
	});

	test("ToolSourceSchema enum matches the generated OpenAPI type", () => {
		// `AvailableTool.source` (0.4.0 A6) drives the agent-form tool
		// catalog grouping. Same exhaustiveness guard as above: adding/
		// removing a tool source in the backend breaks this until the Zod
		// enum is updated alongside a `gen:types` refresh.
		type RuntimeSource = components["schemas"]["AvailableTool"]["source"];
		const exhaust: Record<RuntimeSource, true> = {
			builtin: true,
			native: true,
			astra: true,
			mcp: true,
		};
		void exhaust;

		const enumValues = ToolSourceSchema.options;
		expect([...enumValues].sort()).toEqual(
			["astra", "builtin", "mcp", "native"].sort(),
		);
	});
});

describe("SecretRefSchema", () => {
	test.each([
		["env:ASTRA_TOKEN", "env"],
		["file:/etc/secrets/token", "file"],
		// astra-cli refs from the workspace picker have hyphens in the
		// provider portion AND colons inside the path (profile names
		// can include spaces, db ids contain hyphens). The schema must
		// only split on the first colon.
		[
			"astra-cli:Eric Hare:c933e7fc-4996-4dcd-bb87-4f282fe1e7ef:token",
			"astra-cli",
		],
		[
			"astra-cli:default:c933e7fc-4996-4dcd-bb87-4f282fe1e7ef:endpoint",
			"astra-cli",
		],
		// RFC 3986 scheme syntax — scheme can include digits, +, -, .
		["aws.secrets+v1:my/secret", "aws.secrets+v1"],
	])("accepts %s (provider %s)", (ref) => {
		const parsed = SecretRefSchema.safeParse(ref);
		expect(parsed.success).toBe(true);
	});

	test.each([
		// no provider
		["plain-token"],
		[":missing-provider"],
		// provider must start with a lowercase letter
		["1env:foo"],
		["-env:foo"],
		// provider must be lowercase
		["Env:foo"],
		// missing path
		["env:"],
		[""],
	])("rejects %s", (ref) => {
		const parsed = SecretRefSchema.safeParse(ref);
		expect(parsed.success).toBe(false);
		if (!parsed.success) {
			expect(parsed.error.issues[0]?.message).toBe(
				"Expected '<provider>:<path>', e.g. 'env:FOO'",
			);
		}
	});
});
