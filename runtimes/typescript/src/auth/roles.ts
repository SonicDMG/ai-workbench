/**
 * RBAC roles (0.4.0).
 *
 * A coarse role set layered over the existing privilege scopes
 * (`read` / `write` / `manage`). A **role** is the user-facing concept;
 * the **scopes** it expands to are what `assertScope()` /
 * `requireScope()` in {@link ./authz.ts} actually enforce on each route
 * and MCP tool. Keeping roles as a thin projection over scopes means
 * the enforcement layer never has to learn about roles — it keeps
 * checking scopes exactly as it does today.
 *
 *   viewer → [read]                 read-only.
 *   editor → [read, write]          can mutate workspace content
 *                                   (KBs, documents, agents, services,
 *                                   ingest).
 *   admin  → [read, write, manage]  can additionally perform admin-only
 *                                   operations (API keys, principals,
 *                                   RLAC policy, workspace delete).
 *
 * `manage` is new in 0.4.0. Before it, every mutating route gated on
 * `write`, so a write-capable key could also perform admin actions;
 * splitting `manage` out is a deliberate behavior change — see
 * docs/auth.md (Migration).
 */

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

/** A coarse RBAC role. */
export type Role = "viewer" | "editor" | "admin";

/** Every role, least-privileged first. */
export const ALL_ROLES: readonly Role[] = Object.freeze([
	"viewer",
	"editor",
	"admin",
]);

/**
 * The role assumed when none is recorded for a principal or carried by
 * a token — the safe, least-privileged floor.
 */
export const DEFAULT_ROLE: Role = "viewer";

const ROLE_SCOPES: Readonly<Record<Role, readonly string[]>> = Object.freeze({
	viewer: Object.freeze([SCOPE_READ]),
	editor: Object.freeze([SCOPE_READ, SCOPE_WRITE]),
	admin: Object.freeze([SCOPE_READ, SCOPE_WRITE, SCOPE_MANAGE]),
});

/** Expand a role into the privilege scopes it grants. */
export function scopesForRole(role: Role): readonly string[] {
	return ROLE_SCOPES[role];
}

/** Type guard: is `value` one of the known roles? */
export function isRole(value: unknown): value is Role {
	return (
		typeof value === "string" &&
		(ALL_ROLES as readonly string[]).includes(value)
	);
}

/**
 * Coerce an arbitrary stored or claimed value into a role, falling back
 * to {@link DEFAULT_ROLE} when it's missing or unrecognized. Use this at
 * the boundary where a principal record's `role` field or an OIDC claim
 * value is read — never trust the raw value.
 */
export function parseRole(value: unknown): Role {
	return isRole(value) ? value : DEFAULT_ROLE;
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
