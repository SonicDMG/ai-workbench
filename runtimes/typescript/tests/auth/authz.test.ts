import { describe, expect, test } from "vitest";
import {
	assertWorkspaceAccess,
	filterToAccessibleWorkspaces,
} from "../../src/auth/authz.js";
import { ForbiddenError } from "../../src/auth/errors.js";
import type { AuthContext, AuthSubject } from "../../src/auth/types.js";

// Minimal Hono-context shape that assertWorkspaceAccess / the list
// filter actually read. Avoids pulling in the full Hono test harness.
function ctx(auth: AuthContext | undefined) {
	return {
		get(key: string) {
			if (key === "auth") return auth;
			return undefined;
		},
		// biome-ignore lint/suspicious/noExplicitAny: minimal test shim
	} as any;
}

function anonymous(): AuthContext {
	return {
		mode: "apiKey",
		authenticated: false,
		anonymous: true,
		subject: null,
	};
}

function authed(workspaceScopes: AuthSubject["workspaceScopes"]): AuthContext {
	return {
		mode: "apiKey",
		authenticated: true,
		anonymous: false,
		subject: {
			type: "apiKey",
			id: "key-1",
			label: "ci",
			workspaceScopes,
		},
	};
}

const WID_A = "00000000-0000-0000-0000-000000000aaa";
const WID_B = "00000000-0000-0000-0000-000000000bbb";

describe("assertWorkspaceAccess", () => {
	test("missing auth context passes through (middleware didn't run)", () => {
		expect(() => assertWorkspaceAccess(ctx(undefined), WID_A)).not.toThrow();
	});

	test("anonymous passes through", () => {
		expect(() => assertWorkspaceAccess(ctx(anonymous()), WID_A)).not.toThrow();
	});

	test("unscoped subject (null) passes through", () => {
		expect(() => assertWorkspaceAccess(ctx(authed(null)), WID_A)).not.toThrow();
	});

	test("scoped subject with matching workspace passes through", () => {
		expect(() =>
			assertWorkspaceAccess(ctx(authed([WID_A])), WID_A),
		).not.toThrow();
	});

	test("scoped subject whose scopes don't include the target throws ForbiddenError", () => {
		expect(() => assertWorkspaceAccess(ctx(authed([WID_A])), WID_B)).toThrow(
			ForbiddenError,
		);
	});

	test("scoped subject with an empty scope list can't access anything", () => {
		expect(() => assertWorkspaceAccess(ctx(authed([])), WID_A)).toThrow(
			ForbiddenError,
		);
	});
});

describe("filterToAccessibleWorkspaces", () => {
	const rows = [{ uid: WID_A }, { uid: WID_B }];

	test("missing auth context returns all rows", () => {
		expect(filterToAccessibleWorkspaces(ctx(undefined), rows)).toEqual(rows);
	});

	test("anonymous returns all rows", () => {
		expect(filterToAccessibleWorkspaces(ctx(anonymous()), rows)).toEqual(rows);
	});

	test("unscoped subject returns all rows", () => {
		expect(filterToAccessibleWorkspaces(ctx(authed(null)), rows)).toEqual(rows);
	});

	test("scoped subject gets only matching rows", () => {
		const out = filterToAccessibleWorkspaces(ctx(authed([WID_B])), rows);
		expect(out.map((r) => r.uid)).toEqual([WID_B]);
	});

	test("scoped subject with empty scopes gets no rows", () => {
		expect(filterToAccessibleWorkspaces(ctx(authed([])), rows)).toEqual([]);
	});
});
