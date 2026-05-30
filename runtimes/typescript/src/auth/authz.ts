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
 * {@link AuthContext}. The app mounts {@link workspaceRouteAuthz}
 * around `/api/v1/workspaces/{workspaceId}/...` so workspace-scoped
 * resource handlers inherit this check by default.
 *
 * {@link filterToAccessibleWorkspaces} is the corresponding "list"
 * helper: returns the subset of workspaces the subject can see.
 * Anonymous / unscoped callers see everything.
 */

import type { Context, MiddlewareHandler } from "hono";
import type { AppEnv } from "../lib/types.js";
import { ForbiddenError } from "./errors.js";
import { SCOPE_MANAGE } from "./roles.js";

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

/**
 * Workspace-route authorization wrapper. Mount this after
 * {@link authMiddleware} on paths that expose a `:workspaceId`
 * parameter and before the concrete route modules are mounted.
 *
 * This keeps the security invariant centralized: resource handlers
 * still read `workspaceId` from their validated params, but they do
 * not each have to remember to call {@link assertWorkspaceAccess}.
 */
export function workspaceRouteAuthz(): MiddlewareHandler<AppEnv> {
	return async (c, next) => {
		const workspaceId = c.req.param("workspaceId");
		if (workspaceId) {
			assertWorkspaceAccess(c, workspaceId);
		}
		await next();
	};
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

/**
 * Require the authenticated subject to carry a given privilege scope
 * (e.g. `"read"`, `"write"`). Used by route handlers that need finer
 * gating than the workspace-membership check above — typically MCP
 * write tools and other mutating endpoints once scope-aware keys are
 * in flight.
 *
 * Semantics:
 *
 *   - **anonymous** → pass through. `anonymousPolicy` decided whether
 *     anonymous gets here at all; once it does, scope gates don't
 *     re-litigate.
 *   - **subject with `scopes: null`** → pass through. OIDC and
 *     bootstrap subjects implicitly carry every scope.
 *   - **subject with explicit `scopes: []` or missing the required
 *     scope** → throw `ForbiddenError` (403 `forbidden`).
 *
 * Phase 2 of the API-key scopes work wires this onto specific routes;
 * Phase 1 (this PR) ships the helper without enforcement so existing
 * behavior is unchanged.
 */
export function assertScope(c: Context<AppEnv>, scope: string): void {
	const auth = c.get("auth");
	if (!auth || auth.anonymous) return;
	const scopes = auth.subject?.scopes;
	if (scopes === null || scopes === undefined) return;
	if (scopes.includes(scope)) return;
	throw new ForbiddenError(
		`authenticated subject is missing required scope '${scope}'`,
	);
}

/**
 * Workspace-route middleware: reject mutating REST requests when the
 * caller is missing the `write` scope. Mounts after
 * {@link workspaceRouteAuthz} so workspace membership has already
 * cleared.
 *
 * The gate fires only on **write-shaped** methods (POST/PATCH/PUT/
 * DELETE). It then consults a small allowlist of "POST as read"
 * paths that semantically don't mutate KB state:
 *
 *   - `/test-connection`     workspace-connection probe (read-only).
 *   - `/connect/verify`      MCP smoke test (read-only).
 *   - `/mcp`                 JSON-RPC entry point — the tool-level
 *                            scope gate in `mcp/server.ts` covers
 *                            individual write tools; gating the route
 *                            here would block `search_kb` calls from
 *                            a read-only key.
 *   - `/search`              KB search; body-shaped so it has to be
 *                            POST, but semantically a query.
 *   - `/conversations` …     chat session state. Conversations and
 *                            their messages aren't KB content; we
 *                            treat them like the `chat_send` MCP tool
 *                            (ungated). Includes `…/messages` and
 *                            `…/messages/stream`.
 *
 * Anything else (KB CRUD, document register / patch / delete, ingest,
 * agent CRUD, service CRUD, key issuance / revocation, …) goes
 * through {@link assertScope} and fails 403 for a `["read"]` key.
 *
 * Scope is workspace-scoped routes only — workspace create
 * (`POST /api/v1/workspaces`) is gated separately by
 * {@link assertPlatformAccess} inside the handler.
 */
export function mutatingRouteWriteScope(): MiddlewareHandler<AppEnv> {
	return async (c, next) => {
		const method = c.req.method.toUpperCase();
		if (method === "GET" || method === "HEAD" || method === "OPTIONS") {
			await next();
			return;
		}
		if (isReadShapedRoute(c.req.path)) {
			await next();
			return;
		}
		assertScope(c, "write");
		await next();
	};
}

/**
 * Path tests for the {@link mutatingRouteWriteScope} allowlist. The
 * mount restricts the patterns to `/api/v1/workspaces/{w}/...` so
 * each suffix is a meaningful identifier — collisions with
 * unrelated paths are not a concern given the surface today.
 */
function isReadShapedRoute(path: string): boolean {
	if (path.endsWith("/test-connection")) return true;
	if (path.endsWith("/connect/verify")) return true;
	if (path.endsWith("/mcp")) return true;
	if (path.endsWith("/search")) return true;
	// `/conversations` covers POST /conversations (create), PATCH /
	// DELETE on a specific conversation, and POST /messages
	// + /messages/stream — chat session, not KB content.
	if (path.includes("/conversations")) return true;
	return false;
}

/**
 * Workspace-route middleware: require the `manage` scope on admin-only
 * surfaces. Mounts after {@link mutatingRouteWriteScope} so workspace
 * membership and the `write` floor have already cleared.
 *
 * `manage` is the admin tier (see {@link ./roles.ts}). It gates the
 * operations that, before 0.4.0, any `write`-capable key could perform —
 * a deliberate split (see docs/auth.md → Migration) so an `editor` can
 * manage workspace *content* (KBs, documents, agents, services, ingest)
 * without also being able to mint credentials, administer RLAC, or
 * destroy the workspace. Admin surfaces:
 *
 *   - `…/api-keys` …     credential issuance / revocation / listing.
 *   - `…/principals` …   RLAC principal CRUD.
 *   - `…/policy` …       RLAC policy preview + audit log.
 *   - `DELETE /workspaces/{w}`  destroy the workspace.
 *
 * The whole CRUD surface — including `GET` — is gated for these
 * resources: listing credentials or principals is itself a privileged
 * read. Anonymous and unscoped (OIDC / bootstrap) callers pass through
 * exactly as in {@link assertScope}; the gate only bites a scoped API
 * key that lacks `manage`.
 *
 * The workspace `PATCH` that toggles `rlacEnabled` is also an admin
 * action, but it shares a route with the (write-level) rename, so it's
 * gated at the handler with `assertScope(c, "manage")` rather than here.
 */
export function manageRouteScope(): MiddlewareHandler<AppEnv> {
	return async (c, next) => {
		if (isManageScopedRoute(c.req.path, c.req.method)) {
			assertScope(c, SCOPE_MANAGE);
		}
		await next();
	};
}

/**
 * Path/method tests for the {@link manageRouteScope} gate. The mount
 * restricts these to `/api/v1/workspaces/{w}/...`, so the suffixes are
 * unambiguous identifiers.
 */
function isManageScopedRoute(path: string, method: string): boolean {
	if (path.includes("/api-keys")) return true;
	if (path.includes("/principals")) return true;
	if (path.includes("/policy")) return true;
	// Workspace destroy — DELETE on the workspace root, no sub-resource.
	if (
		method.toUpperCase() === "DELETE" &&
		/\/api\/v1\/workspaces\/[^/]+$/.test(path)
	) {
		return true;
	}
	return false;
}
