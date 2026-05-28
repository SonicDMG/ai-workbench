/**
 * Unit coverage for the RBAC half of the principal-resolver (0.4.0, B2b):
 *
 *   - An OIDC subject resolving to an explicitly-provisioned principal
 *     has its effective scopes constrained to the principal's role.
 *   - An `admin`-role principal gets `attributes.admin = "true"` injected
 *     so the canonical RLAC policy DSL bypasses row filters for it.
 *   - An OIDC subject with NO principal record keeps `scopes: null`
 *     (all) — unknown subjects are not silently downgraded (that's B3).
 *   - An API-key subject keeps its own concrete scopes; role does not
 *     override an explicit key scope set.
 */

import { describe, expect, test } from "vitest";
import { principalResolverMiddleware } from "../../src/auth/principal-resolver.js";
import type { AuthContext, AuthSubject } from "../../src/auth/types.js";
import { MemoryControlPlaneStore } from "../../src/control-plane/memory/store.js";
import type { Role } from "../../src/control-plane/types.js";

function makeCtx(auth: AuthContext, path: string) {
	let stored: AuthContext = auth;
	return {
		get(key: string) {
			return key === "auth" ? stored : undefined;
		},
		set(key: string, val: unknown) {
			if (key === "auth") stored = val as AuthContext;
		},
		req: {
			path,
			header(_name: string): string | undefined {
				return undefined;
			},
		},
		// biome-ignore lint/suspicious/noExplicitAny: minimal middleware test shim
	} as any;
}

function oidcAuth(workspaceId: string, id: string): AuthContext {
	return {
		mode: "oidc",
		authenticated: true,
		anonymous: false,
		subject: {
			type: "oidc",
			id,
			label: id,
			workspaceScopes: [workspaceId],
			scopes: null,
		},
	};
}

async function resolve(
	store: MemoryControlPlaneStore,
	auth: AuthContext,
	workspaceId: string,
): Promise<AuthSubject> {
	const mw = principalResolverMiddleware({ store });
	const ctx = makeCtx(
		auth,
		`/api/v1/workspaces/${workspaceId}/knowledge-bases`,
	);
	await mw(ctx, async () => {});
	const subject = ctx.get("auth").subject;
	if (!subject) throw new Error("resolver dropped the subject");
	return subject;
}

async function seed(role?: Role): Promise<{
	store: MemoryControlPlaneStore;
	workspaceId: string;
}> {
	const store = new MemoryControlPlaneStore();
	const ws = await store.createWorkspace({ name: "ws", kind: "mock" });
	await store.createPrincipal(ws.uid, {
		principalId: "alice",
		...(role !== undefined ? { role } : {}),
	});
	return { store, workspaceId: ws.uid };
}

describe("principal-resolver — RBAC scope derivation", () => {
	test("OIDC subject inherits the editor role's scopes", async () => {
		const { store, workspaceId } = await seed("editor");
		const subject = await resolve(
			store,
			oidcAuth(workspaceId, "alice"),
			workspaceId,
		);
		expect(subject.scopes).toEqual(["read", "write"]);
		expect(subject.principal?.role).toBe("editor");
	});

	test("admin-role principal gets attributes.admin injected + manage scope", async () => {
		const { store, workspaceId } = await seed("admin");
		const subject = await resolve(
			store,
			oidcAuth(workspaceId, "alice"),
			workspaceId,
		);
		expect(subject.scopes).toEqual(["read", "write", "manage"]);
		expect(subject.principal?.attributes.admin).toBe("true");
	});

	test("OIDC subject with no principal record keeps null (all) scopes", async () => {
		const store = new MemoryControlPlaneStore();
		const ws = await store.createWorkspace({ name: "ws", kind: "mock" });
		const subject = await resolve(store, oidcAuth(ws.uid, "stranger"), ws.uid);
		expect(subject.scopes).toBeNull();
		expect(subject.principal?.role).toBe("viewer");
	});

	test("API-key subject keeps its own concrete scopes (role does not override)", async () => {
		const { store, workspaceId } = await seed("admin");
		const apiKeyAuth: AuthContext = {
			mode: "apiKey",
			authenticated: true,
			anonymous: false,
			subject: {
				type: "apiKey",
				id: "key-1",
				label: "alice",
				workspaceScopes: [workspaceId],
				scopes: ["read"],
			},
		};
		const subject = await resolve(store, apiKeyAuth, workspaceId);
		expect(subject.scopes).toEqual(["read"]);
	});

	test("OIDC claim role derives scopes when no principal record exists", async () => {
		const store = new MemoryControlPlaneStore();
		const ws = await store.createWorkspace({ name: "ws", kind: "mock" });
		const base = oidcAuth(ws.uid, "stranger");
		// Simulate the verifier having mapped a group claim → admin.
		const authWithClaimRole: AuthContext = {
			...base,
			subject: base.subject ? { ...base.subject, role: "admin" } : null,
		};
		const subject = await resolve(store, authWithClaimRole, ws.uid);
		expect(subject.scopes).toEqual(["read", "write", "manage"]);
	});

	test("a per-workspace principal record overrides the OIDC claim role", async () => {
		const { store, workspaceId } = await seed("viewer");
		const base = oidcAuth(workspaceId, "alice");
		const authWithClaimRole: AuthContext = {
			...base,
			subject: base.subject ? { ...base.subject, role: "admin" } : null,
		};
		const subject = await resolve(store, authWithClaimRole, workspaceId);
		// The record's viewer role wins over the admin claim.
		expect(subject.scopes).toEqual(["read"]);
	});
});
