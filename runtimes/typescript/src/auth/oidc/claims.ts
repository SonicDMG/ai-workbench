/**
 * Map validated JWT claims onto an `AuthSubject`.
 *
 * The claim names come from `auth.oidc.claims` in workbench.yaml, so
 * operators can point at whatever their IdP actually puts in tokens.
 * The `workspaceScopes` claim is expected to hold a JSON array of
 * workspace IDs; if it's missing, the subject authenticates but has
 * an empty scope list and will 403 on every workspace route (the
 * authz helpers treat `null` — not `[]` — as "unscoped / admin").
 */

import type { JWTPayload } from "jose";
import type { OidcConfig } from "../../config/schema.js";
import type { Role } from "../../control-plane/types.js";
import type { AuthSubject } from "../types.js";

export function subjectFromClaims(
	payload: JWTPayload,
	cfg: OidcConfig,
): AuthSubject {
	const idRaw = payload[cfg.claims.subject];
	const id = typeof idRaw === "string" && idRaw.length > 0 ? idRaw : null;
	if (id === null) {
		throw new Error(
			`OIDC token missing '${cfg.claims.subject}' claim (configured as the subject id)`,
		);
	}

	const labelRaw = payload[cfg.claims.label];
	const label =
		typeof labelRaw === "string" && labelRaw.length > 0 ? labelRaw : null;

	const scopesRaw = payload[cfg.claims.workspaceScopes];
	const workspaceScopes = normalizeScopes(scopesRaw);

	// RBAC role from the configured claim mapping, when set. Threaded
	// onto the subject; the principal-resolver turns it into effective
	// scopes (a per-workspace principal record still wins). Absent when
	// no mapping is configured → OIDC subjects keep all scopes.
	const role = cfg.roleMapping
		? roleFromClaim(payload, cfg.roleMapping)
		: undefined;

	return {
		type: "oidc",
		id,
		label,
		workspaceScopes,
		// OIDC subjects carry no privilege-scope list of their own — the
		// resolver derives one from `role` when a mapping is configured;
		// otherwise `null` means "no scope gate applies to this caller"
		// and downstream `requireScope()` short-circuits to allow.
		scopes: null,
		...(role !== undefined ? { role } : {}),
	};
}

const ROLE_RANK: Record<Role, number> = { viewer: 0, editor: 1, admin: 2 };

/**
 * Resolve a role from a token claim per `auth.oidc.roleMapping`. The
 * claim may hold a single value or an array (groups); the
 * highest-privileged matching role wins. Falls back to the mapping's
 * `default` (the viewer floor) when nothing matches.
 */
function roleFromClaim(
	payload: JWTPayload,
	mapping: NonNullable<OidcConfig["roleMapping"]>,
): Role {
	const raw = payload[mapping.claim];
	const values =
		typeof raw === "string"
			? [raw]
			: Array.isArray(raw)
				? raw.filter((x): x is string => typeof x === "string")
				: [];
	let best: Role | null = null;
	for (const v of values) {
		const mapped = mapping.values[v];
		if (mapped && (best === null || ROLE_RANK[mapped] > ROLE_RANK[best])) {
			best = mapped;
		}
	}
	return best ?? mapping.default;
}

/**
 * Normalize the raw claim value into `AuthSubject.workspaceScopes`.
 *
 *   - `null`                      → `null` (admin / unscoped)
 *   - missing / empty string      → `[]`   (scoped to nothing)
 *   - array of strings            → that array (filtered to strings)
 *   - space-separated string      → split on whitespace
 *   - anything else               → `[]`
 */
function normalizeScopes(raw: unknown): readonly string[] | null {
	if (raw === null) return null;
	if (raw === undefined) return [];
	if (Array.isArray(raw)) {
		return raw.filter(
			(x): x is string => typeof x === "string" && x.length > 0,
		);
	}
	if (typeof raw === "string") {
		const trimmed = raw.trim();
		if (trimmed.length === 0) return [];
		return trimmed.split(/\s+/).filter((s) => s.length > 0);
	}
	return [];
}
