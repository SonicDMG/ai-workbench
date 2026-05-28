import { describe, expect, test } from "vitest";
import {
	ALL_ROLES,
	DEFAULT_ROLE,
	isRole,
	parseRole,
	roleForScopes,
	SCOPE_MANAGE,
	SCOPE_READ,
	SCOPE_WRITE,
	scopesForRole,
} from "../../src/auth/roles.js";

describe("roles → scopes", () => {
	test("viewer is read-only", () => {
		expect(scopesForRole("viewer")).toEqual([SCOPE_READ]);
	});
	test("editor adds write", () => {
		expect(scopesForRole("editor")).toEqual([SCOPE_READ, SCOPE_WRITE]);
	});
	test("admin adds manage", () => {
		expect(scopesForRole("admin")).toEqual([
			SCOPE_READ,
			SCOPE_WRITE,
			SCOPE_MANAGE,
		]);
	});
	test("roles are ordered least-privileged first", () => {
		expect(ALL_ROLES).toEqual(["viewer", "editor", "admin"]);
	});
	test("each role's scopes are a superset of the previous", () => {
		for (let i = 1; i < ALL_ROLES.length; i++) {
			const prev = scopesForRole(
				ALL_ROLES[i - 1] as (typeof ALL_ROLES)[number],
			);
			const cur = scopesForRole(ALL_ROLES[i] as (typeof ALL_ROLES)[number]);
			for (const s of prev) expect(cur).toContain(s);
		}
	});
});

describe("isRole / parseRole", () => {
	test("isRole accepts known roles", () => {
		expect(isRole("viewer")).toBe(true);
		expect(isRole("admin")).toBe(true);
	});
	test("isRole rejects unknown values and non-strings", () => {
		expect(isRole("superadmin")).toBe(false);
		expect(isRole(null)).toBe(false);
		expect(isRole(42)).toBe(false);
	});
	test("parseRole falls back to the viewer floor", () => {
		expect(parseRole(undefined)).toBe(DEFAULT_ROLE);
		expect(parseRole("nope")).toBe(DEFAULT_ROLE);
		expect(DEFAULT_ROLE).toBe("viewer");
	});
	test("parseRole passes a valid role through", () => {
		expect(parseRole("editor")).toBe("editor");
	});
});

describe("roleForScopes", () => {
	test("maps exact scope sets back to a role, order-independent", () => {
		expect(roleForScopes([SCOPE_READ])).toBe("viewer");
		expect(roleForScopes([SCOPE_WRITE, SCOPE_READ])).toBe("editor");
		expect(roleForScopes([SCOPE_MANAGE, SCOPE_READ, SCOPE_WRITE])).toBe(
			"admin",
		);
	});
	test("returns null for scope sets that aren't a whole role", () => {
		expect(roleForScopes([SCOPE_MANAGE])).toBeNull();
		expect(roleForScopes([SCOPE_READ, SCOPE_MANAGE])).toBeNull();
		expect(roleForScopes([])).toBeNull();
	});
});
