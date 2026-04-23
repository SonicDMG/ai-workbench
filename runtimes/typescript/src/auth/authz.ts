/**
 * Per-request authorization helpers that sit on top of the auth
 * middleware's {@link AuthContext}.
 *
 * Phase 2 model — intentionally minimal:
 *
 *   anonymous  → pass through. `anonymousPolicy` has already vetted
 *                whether anonymous is allowed to reach the route at
 *                all; anything that gets here is intentional.
 *   unscoped   → pass through. A subject with `workspaceScopes: null`
 *                is a platform-level identity (reserved for operator
 *                keys; no runtime path issues these yet).
 *   scoped     → must list the target `workspaceId` in its scopes, or
 *                the request is refused with 403 `forbidden`.
 *
 * That's authz, not authn — the middleware already produced the
 * {@link AuthContext}. Route handlers should call
 * {@link assertWorkspaceAccess} at the top of every
 * `/api/v1/workspaces/{workspaceId}/...` route.
 *
 * {@link filterToAccessibleWorkspaces} is the corresponding "list"
 * helper: returns the subset of workspaces the subject can see.
 * Anonymous / unscoped callers see everything.
 */

import type { Context } from "hono";
import type { AppEnv } from "../lib/types.js";
import { ForbiddenError } from "./errors.js";

export function assertWorkspaceAccess(
	c: Context<AppEnv>,
	workspaceId: string,
): void {
	const auth = c.get("auth");
	// Missing context means the middleware didn't run for this route —
	// treat as anonymous to match the policy the middleware would have
	// enforced. Defensive rather than authoritative: the middleware's
	// own mount is what actually gatekeeps.
	if (!auth || auth.anonymous) return;
	const scopes = auth.subject?.workspaceScopes;
	if (scopes === null || scopes === undefined) return;
	if (scopes.includes(workspaceId)) return;
	throw new ForbiddenError(
		`authenticated subject is not authorized for workspace '${workspaceId}'`,
	);
}

export function filterToAccessibleWorkspaces<
	T extends { readonly uid: string },
>(c: Context<AppEnv>, rows: readonly T[]): readonly T[] {
	const auth = c.get("auth");
	if (!auth || auth.anonymous) return rows;
	const scopes = auth.subject?.workspaceScopes;
	if (scopes === null || scopes === undefined) return rows;
	const allowed = new Set(scopes);
	return rows.filter((w) => allowed.has(w.uid));
}

/**
 * Guard for operations that aren't tied to any specific workspace —
 * right now only `POST /api/v1/workspaces` (create). These are
 * "platform-level" actions: acceptable for anonymous (already vetted
 * by `anonymousPolicy`) and for unscoped subjects (operator tokens
 * with `workspaceScopes: null`), but NOT for a scoped subject, whose
 * scope list is by definition an exhaustive enumeration of what they
 * may reach. Letting a scoped key create a brand-new workspace would
 * be a silent privilege escalation.
 *
 * Split from `assertWorkspaceAccess` because the failure message
 * ("cannot create a workspace") is more useful to the caller than
 * the per-workspace variant, and because the two helpers should
 * read differently at the call site so a reviewer can tell which
 * invariant a route is enforcing.
 */
export function assertPlatformAccess(c: Context<AppEnv>): void {
	const auth = c.get("auth");
	if (!auth || auth.anonymous) return;
	const scopes = auth.subject?.workspaceScopes;
	if (scopes === null || scopes === undefined) return;
	throw new ForbiddenError(
		"scoped subjects cannot perform platform-level operations (create workspace)",
	);
}
