/**
 * Pure-unit tests for `aiw key`: the `list` table renderer and the
 * `--role` / `--scope` resolution (including their mutual exclusion).
 * The citty wrapper is exercised by the smoke suite.
 */
import { describe, expect, it } from "vitest";
import { renderKeyList, resolveScopes } from "../src/commands/key.js";
import type { ApiKey } from "../src/types.js";

const activeKey: ApiKey = {
	workspaceId: "00000000-0000-4000-8000-000000000001",
	keyId: "00000000-0000-4000-8000-0000000000aa",
	prefix: "abcdefghijkl",
	label: "ci",
	scopes: ["read", "write:ingest"],
	createdAt: "2026-06-01T10:00:00.000Z",
	lastUsedAt: null,
	revokedAt: null,
	expiresAt: null,
};

const revokedKey: ApiKey = {
	...activeKey,
	keyId: "00000000-0000-4000-8000-0000000000bb",
	label: "old",
	scopes: ["read"],
	revokedAt: "2026-06-01T11:00:00.000Z",
};

describe("renderKeyList", () => {
	it("renders the columns + per-key scopes and status", () => {
		const out = renderKeyList([activeKey, revokedKey]);
		expect(out).toContain("KEY ID");
		expect(out).toContain("LABEL");
		expect(out).toContain("SCOPES");
		expect(out).toContain("STATUS");
		// Fine scopes render verbatim, space-joined.
		expect(out).toContain("read write:ingest");
		expect(out).toContain("active");
		expect(out).toContain("revoked");
		expect(out).toContain("wb_live_abcdefghijkl_…");
	});

	it("handles an empty list", () => {
		expect(renderKeyList([])).toMatch(/No API keys/);
	});
});

describe("resolveScopes (--role / --scope)", () => {
	it("expands a role preset to its scope set", () => {
		expect(resolveScopes({ role: "viewer" })).toEqual(["read"]);
		expect(resolveScopes({ role: "editor" })).toEqual(["read", "write"]);
		expect(resolveScopes({ role: "admin" })).toEqual([
			"read",
			"write",
			"manage",
		]);
	});

	it("passes repeatable fine scopes through unchanged", () => {
		expect(resolveScopes({ scope: ["read:content", "write:ingest"] })).toEqual([
			"read:content",
			"write:ingest",
		]);
		// A single --scope arrives from citty as a bare string.
		expect(resolveScopes({ scope: "tools:invoke" })).toEqual(["tools:invoke"]);
	});

	it("returns undefined when neither is given (server applies its default)", () => {
		expect(resolveScopes({})).toBeUndefined();
	});

	it("rejects --role and --scope together", () => {
		expect(() =>
			resolveScopes({ role: "editor", scope: "read:content" }),
		).toThrow(/mutually exclusive/);
	});

	it("rejects an unknown role", () => {
		expect(() => resolveScopes({ role: "superuser" })).toThrow(
			/Unknown --role/,
		);
	});
});
