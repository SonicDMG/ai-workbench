/**
 * RBAC role → privilege-scope mapping (0.4.0).
 *
 * The `Role` vocabulary itself (`viewer` / `editor` / `admin`) lives in
 * `control-plane/types.ts` next to {@link ApiKeyScope} — a persisted
 * principal record carries a role, so the type belongs with the other
 * control-plane shapes and the data layer can read it without importing
 * from `auth/`. This module owns the *policy*: which scopes each role
 * grants, plus the inverse lookup. It re-exports the vocabulary so
 * `auth/roles.ts` stays the single import surface for role + scope
 * helpers.
 *
 *   viewer → [read]                 read-only.
 *   editor → [read, write]          mutate workspace content.
 *   admin  → [read, write, manage]  + admin ops (API keys, RLAC,
 *                                   workspace destroy).
 */

import {
	ALL_ROLES,
	DEFAULT_ROLE,
	isRole,
	parseRole,
	type Role,
} from "../control-plane/types.js";

export { ALL_ROLES, DEFAULT_ROLE, isRole, parseRole, type Role };

/** Privilege scope identifiers enforced by {@link ./authz.ts:assertScope}. */
export const SCOPE_READ = "read";
export const SCOPE_WRITE = "write";
export const SCOPE_MANAGE = "manage";

/** Every scope the runtime understands, least-privileged first. */
export const ALL_SCOPES: readonly string[] = Object.freeze([
	SCOPE_READ,
	SCOPE_WRITE,
	SCOPE_MANAGE,
]);

const ROLE_SCOPES: Readonly<Record<Role, readonly string[]>> = Object.freeze({
	viewer: Object.freeze([SCOPE_READ]),
	editor: Object.freeze([SCOPE_READ, SCOPE_WRITE]),
	admin: Object.freeze([SCOPE_READ, SCOPE_WRITE, SCOPE_MANAGE]),
});

/** Expand a role into the privilege scopes it grants. */
export function scopesForRole(role: Role): readonly string[] {
	return ROLE_SCOPES[role];
}

/**
 * The role whose scope set is exactly `scopes` (order-independent), or
 * `null` when the set doesn't correspond to a whole role. Used when an
 * API key is issued from an explicit scope list to label it with a role.
 */
export function roleForScopes(scopes: readonly string[]): Role | null {
	const set = new Set(scopes);
	for (const role of ALL_ROLES) {
		const rs = scopesForRole(role);
		if (rs.length === set.size && rs.every((s) => set.has(s))) {
			return role;
		}
	}
	return null;
}
