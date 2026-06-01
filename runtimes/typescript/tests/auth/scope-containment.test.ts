import { describe, expect, it } from "vitest";
import { scopeGrants, subjectGrantsScope } from "../../src/auth/roles.js";
import {
	ALL_API_KEY_SCOPES,
	isApiKeyScope,
	normalizeApiKeyScopes,
} from "../../src/control-plane/types.js";

/**
 * 0.5.0 fine-grained scopes (auth P0). The whole feature pivots on
 * hierarchical containment replacing exact-string scope checks, so these
 * pin the primitive — especially that it stays additive (legacy coarse
 * keys keep working) and matches on the `:` boundary, not raw prefix.
 */
describe("scopeGrants (containment)", () => {
	it("matches exact scopes", () => {
		expect(scopeGrants("write", "write")).toBe(true);
		expect(scopeGrants("write:ingest", "write:ingest")).toBe(true);
	});

	it("a coarse tier grants its fine grants", () => {
		expect(scopeGrants("write", "write:ingest")).toBe(true);
		expect(scopeGrants("read", "read:content")).toBe(true);
		expect(scopeGrants("manage", "manage:keys")).toBe(true);
	});

	it("a fine grant does NOT grant its tier or a sibling facet", () => {
		expect(scopeGrants("write:ingest", "write")).toBe(false);
		expect(scopeGrants("write:ingest", "write:kb")).toBe(false);
	});

	it("matches on the ':' boundary, not a raw prefix (footgun guard)", () => {
		expect(scopeGrants("write", "writeX")).toBe(false);
		expect(scopeGrants("read", "readonly")).toBe(false);
	});
});

describe("subjectGrantsScope", () => {
	it("legacy coarse keys grant every fine scope beneath them", () => {
		const legacy = ["read", "write"];
		expect(subjectGrantsScope(legacy, "write:ingest")).toBe(true);
		expect(subjectGrantsScope(legacy, "read:content")).toBe(true);
		// ...but not a manage facet they never held.
		expect(subjectGrantsScope(legacy, "manage:keys")).toBe(false);
		expect(subjectGrantsScope(legacy, "manage")).toBe(false);
	});

	it("a narrowly-scoped key grants only its own facet", () => {
		expect(subjectGrantsScope(["write:ingest"], "write:ingest")).toBe(true);
		expect(subjectGrantsScope(["write:ingest"], "write:kb")).toBe(false);
		expect(subjectGrantsScope(["write:ingest"], "read:content")).toBe(false);
	});
});

describe("normalizeApiKeyScopes", () => {
	it("defaults to the two coarse tiers when empty / missing / all-unknown", () => {
		expect(normalizeApiKeyScopes(undefined)).toEqual(["read", "write"]);
		expect(normalizeApiKeyScopes([])).toEqual(["read", "write"]);
		expect(normalizeApiKeyScopes(["bogus"])).toEqual(["read", "write"]);
	});

	it("accepts fine scopes and returns them in canonical order", () => {
		expect(
			normalizeApiKeyScopes(["write:ingest", "read", "manage:keys"]),
		).toEqual(["read", "write:ingest", "manage:keys"]);
	});

	it("filters unknown values but keeps the known ones", () => {
		expect(normalizeApiKeyScopes(["read", "nope", "write"])).toEqual([
			"read",
			"write",
		]);
	});
});

describe("isApiKeyScope / ALL_API_KEY_SCOPES", () => {
	it("accepts coarse + fine, rejects anything else", () => {
		expect(isApiKeyScope("read")).toBe(true);
		expect(isApiKeyScope("write:ingest")).toBe(true);
		expect(isApiKeyScope("tools:invoke")).toBe(true);
		expect(isApiKeyScope("nope")).toBe(false);
		expect(isApiKeyScope(42)).toBe(false);
	});

	it("has no duplicates and retains the three coarse tiers", () => {
		expect(new Set(ALL_API_KEY_SCOPES).size).toBe(ALL_API_KEY_SCOPES.length);
		for (const tier of ["read", "write", "manage"]) {
			expect(ALL_API_KEY_SCOPES).toContain(tier);
		}
	});
});
