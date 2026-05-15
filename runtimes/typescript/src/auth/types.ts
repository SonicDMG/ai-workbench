/**
 * Shared auth types.
 *
 * Every `/api/v1/*` request gets an {@link AuthContext} on the Hono
 * context (`c.get("auth")`). Route handlers inspect it to decide
 * whether a caller can act — see docs/auth.md for the threat model.
 *
 * All three production modes (`apiKey`, `oidc`, `any`) are live.
 * `disabled` remains the default, in which case every request
 * resolves to an anonymous context and nothing is enforced.
 */

/** Backends the auth middleware accepts. */
export type AuthMode = "disabled" | "apiKey" | "oidc" | "any";

/** How to handle a request that arrives without an `Authorization` header. */
export type AnonymousPolicy = "allow" | "reject";

/** The verified principal behind a request. */
export interface AuthSubject {
	/** Which verifier produced this subject. */
	readonly type: "apiKey" | "oidc" | "bootstrap";
	/** Stable identifier — key id for API keys, `sub` for JWTs. */
	readonly id: string;
	/** Optional human-readable label — API-key name, JWT `email`. */
	readonly label: string | null;
	/**
	 * Workspaces this subject may touch. Empty array = no workspace
	 * access (platform-level admins may still be allowed on non-
	 * workspace-scoped routes). `null` = unrestricted (reserved for
	 * operator tokens).
	 */
	readonly workspaceScopes: readonly string[] | null;
	/**
	 * Privilege tiers this subject carries. Used by `requireScope()`
	 * route gates to differentiate read-only from write-capable
	 * callers. `null` means "all scopes" — used for OIDC users and
	 * bootstrap tokens that don't have a scope picker yet. API-key
	 * subjects always set this to a concrete (possibly empty) array.
	 */
	readonly scopes: readonly string[] | null;
	/**
	 * RLAC (prototype). Resolved sub-workspace principal for the
	 * current request — the value `current_principal_id()` in the
	 * policy DSL evaluates to. Absent/null when no principal has been
	 * provisioned (legacy / unscoped flows). Populated by the
	 * principal-resolver middleware after authentication; the policy
	 * enforcer reads it on every policy-enabled call.
	 *
	 * Optional so verifiers (apiKey, oidc, bootstrap) can construct an
	 * `AuthSubject` without knowing about RLAC; the resolver layers
	 * the field in afterward.
	 */
	readonly principal?: ResolvedPrincipal | null;
}

/** RLAC: resolved principal for a single request. */
export interface ResolvedPrincipal {
	readonly id: string;
	readonly workspaceId: string;
	readonly attributes: Readonly<Record<string, string>>;
}

/** What the middleware writes into `c.set("auth", ...)` on every request. */
export interface AuthContext {
	readonly mode: AuthMode;
	/** True when a verifier matched a valid token. */
	readonly authenticated: boolean;
	/** True when the request had no credentials and the policy allowed it. */
	readonly anonymous: boolean;
	readonly subject: AuthSubject | null;
}
