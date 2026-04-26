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
