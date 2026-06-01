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
/** Scope to drive an agent to invoke EXTERNAL (remote-MCP) tools (0.5.0). */
export const SCOPE_TOOLS_INVOKE = "tools:invoke";

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

/**
 * Hierarchical scope containment (0.5.0 fine-grained scopes).
 *
 * A held scope grants a required scope when they're equal, or when the
 * held scope is a coarse *tier* of the required fine grant — matched on
 * the `:` boundary so `write` grants `write:ingest` but NOT a sibling
 * like `writeX`. This is what lets the coarse tiers stay first-class
 * supersets and keeps legacy `["read","write"]` keys working unchanged:
 * a route can require a fine scope and the held coarse scope contains it.
 */
export function scopeGrants(held: string, required: string): boolean {
	return held === required || required.startsWith(`${held}:`);
}

/** True when any scope in `held` grants `required`. The per-request check
 * behind {@link ./authz.ts:assertScope}. */
export function subjectGrantsScope(
	held: readonly string[],
	required: string,
): boolean {
	return held.some((h) => scopeGrants(h, required));
}

/**
 * Whether a subject may drive an agent to invoke EXTERNAL (remote-MCP)
 * tools. True when the key explicitly holds `tools:invoke`, OR holds the
 * coarse `write` tier — in 0.4.x any write-capable key (incl. the default
 * `["read","write"]`) could already drive MCP tool calls, so coarse
 * `write` stays a superset of this new capability and existing keys keep
 * working. A *fine* `write:*` scope (`write:ingest`, …) or a read-only key
 * does NOT grant it — that's the new granularity (a narrow key can be
 * denied external tools). Anonymous / unscoped (`scopes: null`) callers
 * are handled upstream; this operates on an explicit scope list.
 */
export function subjectGrantsToolInvoke(held: readonly string[]): boolean {
	return (
		subjectGrantsScope(held, SCOPE_TOOLS_INVOKE) ||
		subjectGrantsScope(held, SCOPE_WRITE)
	);
}
