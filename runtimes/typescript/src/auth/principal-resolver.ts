/**
 * Principal-resolver middleware (RLAC prototype).
 *
 * Runs after {@link authMiddleware}. Layers a `principal` field onto
 * the request's {@link AuthSubject} so the route layer can pass it to
 * the policy enforcer without re-reading any of the underlying auth
 * material.
 *
 * Resolution order, first match wins:
 *
 *   1. **Dev override** — when `WB_DEV_MODE=1` (or the request is
 *      authenticated as a bootstrap operator) and the header
 *      `x-view-as-principal: <id>` is present, the principal is set
 *      to that id with whatever attributes the workspace stores for
 *      it (empty attributes if the principal record doesn't exist).
 *      The "view as" picker in the SPA sets this header.
 *
 *   2. **OIDC `sub`** — when the subject is an OIDC token, the `sub`
 *      claim becomes the principal id. Attributes come from the
 *      `wb_principals_by_workspace` row, if any.
 *
 *   3. **API key label** — for API-key subjects, the principal is
 *      named after the key's label (slugified). This is intentionally
 *      coarse — the prototype's API-key auth doesn't carry a
 *      principal claim, so labels are the only signal available. Real
 *      deployments would add a per-key `principal_id` claim during
 *      issuance.
 *
 *   4. **Bootstrap operator** — bootstrap tokens resolve to the
 *      conventional `admin` principal so demo workflows work without
 *      having to issue a separate API key.
 *
 * In all cases, if no principal record exists for the resolved id the
 * middleware still threads the id through (with empty attributes) so
 * `current_principal_id()` substitution works. The route layer can
 * decide whether absence-of-record means "reject" or "auto-provision".
 */

import type { Context, MiddlewareHandler } from "hono";
import type { ControlPlaneStore } from "../control-plane/store.js";
import type { AppEnv } from "../lib/types.js";
import type { AuthContext, AuthSubject, ResolvedPrincipal } from "./types.js";

const VIEW_AS_HEADER = "x-view-as-principal";

export interface PrincipalResolverOptions {
	readonly store: ControlPlaneStore;
	/**
	 * Allow the `x-view-as-principal` header to override resolution.
	 * Default: true when `WB_DEV_MODE=1`, false otherwise. Operator
	 * (bootstrap) tokens can always use the header regardless of this
	 * flag — the override is part of their privilege tier.
	 */
	readonly allowViewAsHeader?: boolean;
}

function slugify(label: string | null | undefined): string | null {
	if (!label) return null;
	const slug = label
		.toLowerCase()
		.replace(/[^a-z0-9._@:+-]+/g, "-")
		.replace(/^-+|-+$/g, "");
	return slug || null;
}

function workspaceFromPath(c: Context): string | null {
	const m = c.req.path.match(/\/api\/v1\/workspaces\/([^/]+)/);
	return m?.[1] && m[1] !== "_" ? m[1] : null;
}

async function resolvePrincipalRecord(
	store: ControlPlaneStore,
	workspaceId: string,
	principalId: string,
): Promise<ResolvedPrincipal | null> {
	try {
		const record = await store.getPrincipal(workspaceId, principalId);
		if (record) {
			return {
				id: record.principalId,
				workspaceId: record.workspaceId,
				attributes: { ...record.attributes },
			};
		}
	} catch {
		// Astra "not implemented" or missing workspace — fall back to a
		// principal context with no attributes. The DSL can still
		// resolve `current_principal_id()`.
	}
	return { id: principalId, workspaceId, attributes: {} };
}

export function principalResolverMiddleware(
	opts: PrincipalResolverOptions,
): MiddlewareHandler<AppEnv> {
	const devModeDefault = process.env.WB_DEV_MODE === "1";
	const allowViewAs = opts.allowViewAsHeader ?? devModeDefault;

	return async (c, next) => {
		const auth = c.get("auth") as AuthContext | undefined;
		const workspaceId = workspaceFromPath(c);
		if (!workspaceId) {
			await next();
			return;
		}
		const subject: AuthSubject | null = auth?.subject ?? null;
		const viewAs = c.req.header(VIEW_AS_HEADER);
		const isBootstrap = subject?.type === "bootstrap";
		// The view-as header is honored when:
		//   - The runtime is in explicit dev mode (`WB_DEV_MODE=1` or the
		//     caller-supplied override).
		//   - The caller is a bootstrap operator.
		//   - The request has no auth subject at all. This last branch
		//     covers the `auth.mode: disabled` quickstart posture: the
		//     view-as header is the *only* identity signal in flight,
		//     so refusing to honor it would silently drop every request
		//     into the `policy_principal_required` error path. Production
		//     deployments use `auth.mode: apiKey` or `oidc`, where the
		//     subject is always present and this branch never fires.
		const honorViewAs =
			Boolean(viewAs) && (allowViewAs || isBootstrap || subject === null);
		let principal: ResolvedPrincipal | null = null;

		if (honorViewAs && viewAs) {
			principal = await resolvePrincipalRecord(opts.store, workspaceId, viewAs);
		} else if (subject?.type === "oidc") {
			principal = await resolvePrincipalRecord(
				opts.store,
				workspaceId,
				subject.id,
			);
		} else if (subject?.type === "apiKey") {
			const slug = slugify(subject.label) ?? subject.id;
			principal = await resolvePrincipalRecord(opts.store, workspaceId, slug);
		} else if (subject?.type === "bootstrap") {
			principal = await resolvePrincipalRecord(
				opts.store,
				workspaceId,
				"admin",
			);
		}

		if (principal && auth) {
			c.set("auth", {
				...auth,
				subject: subject
					? { ...subject, principal }
					: {
							type: "apiKey",
							id: principal.id,
							label: principal.id,
							workspaceScopes: [workspaceId],
							scopes: null,
							principal,
						},
			});
		}
		await next();
	};
}

/**
 * Convenience reader that pulls the principal out of the
 * {@link AuthContext}. Returns `null` when the resolver didn't run or
 * couldn't resolve one — the route layer must handle this when
 * policy is enabled on a KB.
 */
export function getRequestPrincipal(c: Context): ResolvedPrincipal | null {
	const auth = c.get("auth") as AuthContext | undefined;
	return auth?.subject?.principal ?? null;
}
