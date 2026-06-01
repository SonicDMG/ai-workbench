/**
 * Orphan reconciliation for the Astra control-plane backend.
 *
 * Repairs dependents stranded by a partial cross-partition cascade
 * failure — a row whose owning workspace was removed but whose own
 * `deleteMany` had rejected (the pre-self-heal failure mode, where the
 * workspace row was deleted *before* the dependents). For each workspace
 * id that still appears in a dependent table but has no live workspace
 * row, re-run the idempotent dependent-delete cascade.
 *
 * With the children-first `deleteWorkspace` (see `workspaces.ts`) new
 * orphans no longer occur — a failed cascade leaves the workspace row in
 * place and is retried. This sweep mops up orphans left by older
 * deployments or out-of-band row deletions.
 */

import { logger } from "../../lib/logger.js";
import type { OrphanReconcileReport } from "../store.js";
import type { AstraStoreState } from "./state.js";
import { deleteWorkspaceDependents } from "./workspaces.js";

/**
 * Workspace ids present in a dependent table but absent from
 * `wb_workspaces` — the signature of a partial cross-partition cascade
 * failure. Any surviving dependent in ANY workspace-scoped table marks an
 * incomplete cascade, so we union the distinct workspace ids across the
 * scanned tables and subtract the live ones.
 *
 * The scanned set mirrors what `deleteWorkspaceDependents` actually
 * sweeps (which mirrors `WORKSPACE_CASCADE_STEPS`) — there's no point
 * detecting an orphan the cascade can't then remove. `apiKeyLookup` is
 * intentionally excluded: it's a prefix-keyed secondary index, not
 * workspace-partitioned, and the cascade clears it by enumerating the
 * surviving key rows; a stale lookup pointing at a deleted key row is
 * benign (auth re-reads the key row and finds nothing).
 *
 * Cost: each `find({})` is a full-table scan (O(all rows across all
 * workspaces)), which is why the startup trigger is opt-in and
 * operator-gated — see `controlPlane.reconcileOrphansOnStart`.
 */
async function findOrphanWorkspaceIds(
	state: AstraStoreState,
): Promise<string[]> {
	const [
		live,
		kbs,
		agents,
		keys,
		chunking,
		embedding,
		reranking,
		llm,
		rag,
		principals,
		mcpServers,
		policyAudit,
	] = await Promise.all([
		state.tables.workspaces.find({}).toArray(),
		state.tables.knowledgeBases.find({}).toArray(),
		state.tables.agents.find({}).toArray(),
		state.tables.apiKeys.find({}).toArray(),
		state.tables.chunkingServices.find({}).toArray(),
		state.tables.embeddingServices.find({}).toArray(),
		state.tables.rerankingServices.find({}).toArray(),
		state.tables.llmServices.find({}).toArray(),
		state.tables.ragDocuments.find({}).toArray(),
		state.tables.principals.find({}).toArray(),
		state.tables.mcpServers.find({}).toArray(),
		state.tables.policyAudit.find({}).toArray(),
	]);
	const liveIds = new Set(live.map((w) => w.uid));
	const seen = new Set<string>();
	for (const r of kbs) seen.add(r.workspace_id);
	for (const r of agents) seen.add(r.workspace_id);
	for (const r of keys) seen.add(r.workspace);
	for (const r of chunking) seen.add(r.workspace_id);
	for (const r of embedding) seen.add(r.workspace_id);
	for (const r of reranking) seen.add(r.workspace_id);
	for (const r of llm) seen.add(r.workspace_id);
	for (const r of rag) seen.add(r.workspace_id);
	for (const r of principals) seen.add(r.workspace_id);
	for (const r of mcpServers) seen.add(r.workspace_id);
	for (const r of policyAudit) seen.add(r.workspace_id);
	return [...seen].filter((id) => !liveIds.has(id));
}

export function makeReconcileMethods(state: AstraStoreState): {
	reconcileOrphans(): Promise<OrphanReconcileReport>;
} {
	return {
		async reconcileOrphans(): Promise<OrphanReconcileReport> {
			const orphans = await findOrphanWorkspaceIds(state);
			let partialFailures = 0;
			for (const uid of orphans) {
				const results = await deleteWorkspaceDependents(state, uid);
				const failed = results.filter((r) => r.status === "rejected").length;
				if (failed > 0) {
					partialFailures++;
					logger.warn(
						{ workspaceId: uid, failed, total: results.length },
						"reconcileOrphans: some dependent deletes still failing; retry next sweep",
					);
				}
			}
			if (orphans.length > 0) {
				logger.info(
					{ workspaces: orphans.length, partialFailures },
					"reconcileOrphans swept orphaned workspace dependents",
				);
			}
			return { workspaces: orphans.length, partialFailures };
		},
	};
}
