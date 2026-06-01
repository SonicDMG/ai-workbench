import { useSession } from "@/hooks/useSession";
import type { Role } from "@/lib/session";

/**
 * Effective-role view for UI gating (0.4.0 RBAC).
 *
 * Reads the caller's role + privilege scopes off `/auth/me` (via
 * {@link useSession}) and projects a small, intent-named surface the
 * action sites consume — chiefly `canManage`, which gates the admin-only
 * affordances (API-key management, RLAC controls, workspace delete).
 *
 * **Gating is cosmetic, not a security boundary.** The HTTP routes
 * (`manageRouteScope` / `requireScope` in the runtime) are the
 * authoritative gate; this hook only decides what the UI *offers* so a
 * non-admin isn't shown buttons that would 403. Because of that, the
 * default is deliberately **permissive**: when we have no role signal at
 * all, `canManage` is `true`. Two cases produce no signal:
 *
 *   - **Login isn't configured** (`auth.mode: disabled`, or an
 *     API-key-only deployment where the SPA holds no browser session) —
 *     `useSession` is disabled and returns `undefined`. Hiding admin
 *     entries here would lock the quickstart operator out of their own
 *     settings page, so we show them; the server enforces the real rule.
 *   - **OIDC without a role mapping** — the subject carries every scope
 *     and `/auth/me` reports `role: null, scopes: null`. That caller is
 *     unscoped (effectively admin) on the server, so we treat them as
 *     able to manage.
 *
 * `canManage` flips to `false` only when we positively know the caller
 * is a non-admin: a concrete `role` of `viewer`/`editor`, or a concrete
 * `scopes` array that doesn't contain `manage`.
 */
export interface RoleView {
	/** The effective role, or `null` when unknown / unscoped. */
	readonly role: Role | null;
	/** True when the caller can perform admin (`manage`-scoped) actions,
	 * or when we have no signal to deny (see the permissive default). */
	readonly canManage: boolean;
	/** True only when the role is positively `admin`. Prefer
	 * {@link canManage} for gating — `isAdmin` is for copy that should
	 * name the role explicitly. */
	readonly isAdmin: boolean;
	/** True while `/auth/me` is still resolving (login configured but the
	 * query hasn't settled). Lets a caller defer a flash of admin UI. */
	readonly isLoading: boolean;
}

export function useRole(): RoleView {
	const session = useSession();
	const subject = session.data ?? null;

	// No subject resolved (login disabled, anonymous, or still loading
	// with no cached data) → no signal to deny on. Permissive default.
	if (!subject) {
		return {
			role: null,
			canManage: true,
			isAdmin: false,
			isLoading: session.isLoading,
		};
	}

	const role = subject.role;
	const scopes = subject.scopes;

	// Positive admin: role says admin, OR the caller is unscoped
	// (`scopes: null` → all scopes, the OIDC-without-mapping / bootstrap
	// case), OR a concrete scope list carries a manage-tier grant. 0.5.0
	// fine scopes mean that's the coarse `manage` OR any `manage:*` facet
	// (e.g. a `manage:keys` key can mint keys), so this matches by
	// containment rather than the bare coarse string — keeping the cosmetic
	// gate in step with the server's `subjectGrantsScope` check.
	const canManage =
		role === "admin" ||
		scopes === null ||
		scopes.some((s) => s === "manage" || s.startsWith("manage:"));

	return {
		role,
		canManage,
		isAdmin: role === "admin",
		isLoading: false,
	};
}
