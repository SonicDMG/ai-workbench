/**
 * Shared invariants for workspace creation + update across all
 * control-plane backends (memory / file / astra).
 *
 * The runtime is single-tenant, so listing every workspace on each
 * mutation is fine in practice — workspace creation is rare and
 * admin-driven, and the population in even the largest installs is
 * small (low double digits). If that ever changes the helper can be
 * replaced with a backend-native unique constraint.
 */

import { ControlPlaneConflictError } from "../errors.js";
import type { WorkspaceRecord } from "../types.js";

export interface WorkspaceConflictCheck {
	readonly name: string;
	readonly url: string | null;
	readonly keyspace: string | null;
}

/**
 * Reject duplicate workspaces. Two checks:
 *
 *   - **Name uniqueness** — exact-match (case-sensitive) against any
 *     existing workspace's `name`. Workspace names anchor the SPA
 *     picker and the routing surface; duplicates make the picker
 *     ambiguous and the slug-style URL meaningless. Matches standard
 *     SaaS conventions (Slack workspace handles, GitHub repo names
 *     per org).
 *
 *   - **Database-binding uniqueness** — when `url` is non-null, two
 *     workspaces with the same `(url, keyspace)` point at the same
 *     physical data. Rejecting prevents:
 *       - cross-workspace ownership ambiguity ("which workspace
 *         owns this collection?");
 *       - delete-workspace cascades that could enumerate or drop
 *         collections owned by another workspace's KBs;
 *       - operator-dashboard confusion when two workspaces appear
 *         to manage the same data.
 *
 *     `url: null` workspaces (`mock` kind, primarily) skip the
 *     binding check — they don't have a real DB pointer.
 *
 * For updates, pass `selfUid` so the row being patched doesn't
 * conflict with itself when `name` / `url` / `keyspace` are
 * unchanged.
 */
export function assertNoWorkspaceConflict(
	existing: readonly WorkspaceRecord[],
	input: WorkspaceConflictCheck,
	selfUid?: string,
): void {
	for (const w of existing) {
		if (selfUid && w.uid === selfUid) continue;
		if (w.name === input.name) {
			throw new ControlPlaneConflictError(
				`a workspace named '${input.name}' already exists (id ${w.uid}); pick a different name`,
				"workspace_name_conflict",
			);
		}
		if (
			input.url !== null &&
			w.url === input.url &&
			(w.keyspace ?? null) === (input.keyspace ?? null)
		) {
			const ks = input.keyspace ? ` (keyspace '${input.keyspace}')` : "";
			throw new ControlPlaneConflictError(
				`workspace '${w.name}' (id ${w.uid}) is already bound to '${input.url}'${ks}; one workspace per database binding`,
				"workspace_database_conflict",
			);
		}
	}
}
