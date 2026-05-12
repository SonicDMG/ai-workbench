import { describe, expect, test } from "vitest";
import {
	assertPlatformAccess,
	assertScope,
	assertWorkspaceAccess,
	filterToAccessibleWorkspaces,
	workspaceRouteAuthz,
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

function routeCtx(auth: AuthContext | undefined, workspaceId: string) {
	return {
		...ctx(auth),
		req: {
			param(key: string) {
				return key === "workspaceId" ? workspaceId : "";
			},
		},
		// biome-ignore lint/suspicious/noExplicitAny: minimal middleware test shim
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

function authed(
	workspaceScopes: AuthSubject["workspaceScopes"],
	scopes: AuthSubject["scopes"] = ["read", "write"],
): AuthContext {
	return {
		mode: "apiKey",
		authenticated: true,
		anonymous: false,
		subject: {
			type: "apiKey",
			id: "key-1",
			label: "ci",
			workspaceScopes,
			scopes,
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

describe("workspaceRouteAuthz", () => {
	test("runs next when the subject can access the route workspace", async () => {
		const mw = workspaceRouteAuthz();
		let called = false;
		await mw(routeCtx(authed([WID_A]), WID_A), async () => {
			called = true;
		});
		expect(called).toBe(true);
	});

	test("blocks before next when the subject cannot access the route workspace", async () => {
		const mw = workspaceRouteAuthz();
		let called = false;
		await expect(
			mw(routeCtx(authed([WID_A]), WID_B), async () => {
				called = true;
			}),
		).rejects.toThrow(ForbiddenError);
		expect(called).toBe(false);
	});
});

describe("assertPlatformAccess", () => {
	test("missing auth context passes through (middleware didn't run)", () => {
		expect(() => assertPlatformAccess(ctx(undefined))).not.toThrow();
	});

	test("anonymous passes through — anonymousPolicy has already vetted", () => {
		expect(() => assertPlatformAccess(ctx(anonymous()))).not.toThrow();
	});

	test("unscoped subject (null) passes through — platform admin", () => {
		expect(() => assertPlatformAccess(ctx(authed(null)))).not.toThrow();
	});

	test("scoped subject with a populated scope list is forbidden", () => {
		expect(() => assertPlatformAccess(ctx(authed([WID_A])))).toThrow(
			ForbiddenError,
		);
	});

	test("scoped subject with an empty scope list is still forbidden", () => {
		expect(() => assertPlatformAccess(ctx(authed([])))).toThrow(ForbiddenError);
	});
});

describe("assertScope", () => {
	test("anonymous passes through — anonymousPolicy has already vetted", () => {
		expect(() => assertScope(ctx(anonymous()), "write")).not.toThrow();
	});

	test("subject with `scopes: null` (OIDC / bootstrap) implicitly carries every scope", () => {
		// `authed([])` gives scopes ["read","write"] by default; override
		// to null to model the OIDC case.
		const oidcLike = authed(null, null);
		expect(() => assertScope(ctx(oidcLike), "write")).not.toThrow();
		expect(() => assertScope(ctx(oidcLike), "read")).not.toThrow();
	});

	test("scoped subject with the required scope passes", () => {
		expect(() =>
			assertScope(ctx(authed(null, ["read", "write"])), "write"),
		).not.toThrow();
	});

	test("scoped subject missing the required scope is forbidden", () => {
		expect(() => assertScope(ctx(authed(null, ["read"])), "write")).toThrow(
			ForbiddenError,
		);
	});

	test("scoped subject with empty scopes is forbidden on any scope", () => {
		expect(() => assertScope(ctx(authed(null, [])), "read")).toThrow(
			ForbiddenError,
		);
	});
});
