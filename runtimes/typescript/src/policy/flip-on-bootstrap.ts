/**
 * RLAC flip-on bootstrap.
 *
 * Called when a workspace's `rlacEnabled` transitions from `false` to
 * `true`. Guarantees the workspace is immediately usable instead of
 * dropping the operator into a dead-end where the KB is visible but
 * every document call returns `policy_principal_required`.
 *
 * Two steps, both idempotent:
 *
 *   1. **Default principal.** If the workspace has zero principals,
 *      create `admin`. The View-as picker auto-selects the first
 *      principal in alphabetical order, so this is what the UI will
 *      send as `x-view-as-principal` on the next render. Operators
 *      can rename, delete, or augment freely afterwards.
 *
 *   2. **Visibility backfill.** Every existing document with a
 *      `null`/missing `visibleTo` array gets `["*"]`. The default
 *      DSL (`current_principal_id() = ANY(visible_to) OR '*' =
 *      ANY(visible_to)`) then matches them for any principal — the
 *      "don't lock me out of my own data on flip-on" default.
 *
 *      Documents with an explicit `visibleTo` (including the empty
 *      array, which is a deliberate "no audience" choice) are left
 *      alone. Tightening from `["*"]` to a narrower audience is an
 *      explicit per-document edit afterwards.
 *
 * Re-running on an already-bootstrapped workspace returns
 * `{ principalCreated: false, documentsBackfilled: 0 }`.
 */

import type { ControlPlaneStore } from "../control-plane/store.js";

const DEFAULT_PRINCIPAL_ID = "admin";
const DEFAULT_PRINCIPAL_LABEL = "Workspace administrator";
/**
 * The default DSL grants universal read access to any principal
 * carrying `admin: 'true'`. Setting it on the bootstrap-created
 * principal means the operator sees every document immediately
 * without having to add themselves to every doc's `visible_to` list.
 * Operators can promote / demote any principal later by toggling
 * this attribute via the Principals panel or
 * `aiw principal update <id> --attribute admin=true`.
 */
const DEFAULT_PRINCIPAL_ATTRIBUTES: Readonly<Record<string, string>> = {
	admin: "true",
};

export interface RlacFlipOnSummary {
	/** True when this call inserted the default `admin` principal. */
	readonly principalCreated: boolean;
	/** Count of documents whose `visibleTo` was upgraded from null → ["*"]. */
	readonly documentsBackfilled: number;
}

export async function bootstrapRlacFlipOn(
	store: ControlPlaneStore,
	workspaceId: string,
): Promise<RlacFlipOnSummary> {
	const principalCreated = await ensureDefaultPrincipal(store, workspaceId);
	const documentsBackfilled = await backfillVisibility(store, workspaceId);
	return { principalCreated, documentsBackfilled };
}

async function ensureDefaultPrincipal(
	store: ControlPlaneStore,
	workspaceId: string,
): Promise<boolean> {
	const existing = await store.listPrincipals(workspaceId);
	if (existing.length > 0) return false;
	await store.createPrincipal(workspaceId, {
		principalId: DEFAULT_PRINCIPAL_ID,
		label: DEFAULT_PRINCIPAL_LABEL,
		attributes: { ...DEFAULT_PRINCIPAL_ATTRIBUTES },
	});
	return true;
}

async function backfillVisibility(
	store: ControlPlaneStore,
	workspaceId: string,
): Promise<number> {
	let count = 0;
	const kbs = await store.listKnowledgeBases(workspaceId);
	for (const kb of kbs) {
		const docs = await store.listRagDocuments(workspaceId, kb.knowledgeBaseId);
		for (const doc of docs) {
			// Only upgrade truly-unset values. An explicit empty array is
			// a deliberate "no audience" choice and stays that way.
			if (doc.visibleTo !== null && doc.visibleTo !== undefined) continue;
			await store.updateRagDocument(
				workspaceId,
				kb.knowledgeBaseId,
				doc.documentId,
				{ visibleTo: ["*"] },
			);
			count += 1;
		}
	}
	return count;
}
