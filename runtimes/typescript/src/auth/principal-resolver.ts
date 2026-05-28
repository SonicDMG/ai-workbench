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
import { DEFAULT_ROLE, scopesForRole } from "./roles.js";
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

interface PrincipalResolution {
	readonly principal: ResolvedPrincipal;
	/**
	 * True when an actual principal record backed the resolution. The
	 * RBAC scope-derivation only fires for explicitly-provisioned
	 * principals so an unknown OIDC subject isn't silently downgraded.
	 */
	readonly fromRecord: boolean;
}

async function resolvePrincipalRecord(
	store: ControlPlaneStore,
	workspaceId: string,
	principalId: string,
): Promise<PrincipalResolution> {
	try {
		const record = await store.getPrincipal(workspaceId, principalId);
		if (record) {
			const attributes: Record<string, string> = { ...record.attributes };
			// RLAC: surface an `admin` role as the `$principal.admin = 'true'`
			// clause the canonical policy DSL bypasses on, so an RBAC admin
			// also bypasses row filters without operators setting the
			// attribute by hand. An explicit attribute is left untouched.
			if (record.role === "admin" && attributes.admin === undefined) {
				attributes.admin = "true";
			}
			return {
				principal: {
					id: record.principalId,
					workspaceId: record.workspaceId,
					attributes,
					role: record.role,
				},
				fromRecord: true,
			};
		}
	} catch {
		// Astra "not implemented" or missing workspace — fall back to a
		// principal context with no attributes. The DSL can still
		// resolve `current_principal_id()`.
	}
	return {
		principal: {
			id: principalId,
			workspaceId,
			attributes: {},
			role: DEFAULT_ROLE,
		},
		fromRecord: false,
	};
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
		let resolved: PrincipalResolution | null = null;

		if (honorViewAs && viewAs) {
			resolved = await resolvePrincipalRecord(opts.store, workspaceId, viewAs);
		} else if (subject?.type === "oidc") {
			resolved = await resolvePrincipalRecord(
				opts.store,
				workspaceId,
				subject.id,
			);
		} else if (subject?.type === "apiKey") {
			const slug = slugify(subject.label) ?? subject.id;
			resolved = await resolvePrincipalRecord(opts.store, workspaceId, slug);
		} else if (subject?.type === "bootstrap") {
			resolved = await resolvePrincipalRecord(opts.store, workspaceId, "admin");
		}

		if (resolved && auth) {
			const { principal, fromRecord } = resolved;
			// RBAC: an OIDC subject carries `scopes: null` (all scopes) by
			// default. When it resolves to an *explicitly provisioned*
			// principal record, constrain its effective scopes to the
			// principal's role. OIDC subjects with no record keep the
			// null/all default (B3 layers the group→role mapping + viewer
			// floor on top). API-key subjects keep their own concrete
			// scopes; bootstrap operators stay unrestricted.
			const deriveScopes =
				subject?.type === "oidc" && fromRecord && subject.scopes === null;
			const nextSubject: AuthSubject = subject
				? {
						...subject,
						principal,
						...(deriveScopes ? { scopes: scopesForRole(principal.role) } : {}),
					}
				: {
						type: "apiKey",
						id: principal.id,
						label: principal.id,
						workspaceScopes: [workspaceId],
						scopes: null,
						principal,
					};
			c.set("auth", { ...auth, subject: nextSubject });
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
