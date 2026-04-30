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

	return {
		type: "oidc",
		id,
		label,
		workspaceScopes,
	};
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
