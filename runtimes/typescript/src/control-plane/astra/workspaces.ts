/**
 * Workspace aggregate slice for the Astra-backed store.
 *
 * Owns the `wb_workspaces` table plus the cross-partition cascade on
 * delete: Astra Data API requires the *full* partition key on
 * `deleteMany`, so for tables partitioned by `(workspace_id, X)` we
 * enumerate the dependent rows up front and issue one `deleteMany` per
 * partition. No cross-partition transaction — partial failure across
 * partitions is accepted, exactly like today.
 */

import { randomUUID } from "node:crypto";
import {
	workspaceFromRow,
	workspaceToRow,
} from "../../astra-client/converters.js";
import { byCreatedAtThenId, nowIso } from "../defaults.js";
import {
	ControlPlaneCascadeError,
	ControlPlaneConflictError,
	ControlPlaneNotFoundError,
} from "../errors.js";
import { assertNoWorkspaceConflict } from "../shared/workspaces.js";
import type {
	CreateWorkspaceInput,
	UpdateWorkspaceInput,
	WorkspaceRepo,
} from "../store.js";
import { DOCUMENT_STATUSES, type WorkspaceRecord } from "../types.js";
import type { AstraStoreState } from "./state.js";

export function makeWorkspaceMethods(state: AstraStoreState): WorkspaceRepo {
	return {
		async listWorkspaces(): Promise<readonly WorkspaceRecord[]> {
			const rows = await state.tables.workspaces.find({}).toArray();
			return rows.map(workspaceFromRow).sort(byCreatedAtThenId);
		},

		async getWorkspace(uid: string): Promise<WorkspaceRecord | null> {
			const row = await state.tables.workspaces.findOne({ uid });
			return row ? workspaceFromRow(row) : null;
		},

		async createWorkspace(
			input: CreateWorkspaceInput,
		): Promise<WorkspaceRecord> {
			const uid = input.uid ?? randomUUID();
			if (await state.tables.workspaces.findOne({ uid })) {
				throw new ControlPlaneConflictError(
					`workspace with id '${uid}' already exists`,
				);
			}
			// List-then-check is racy under concurrent createWorkspace, but
			// workspace creation is admin-driven and rare; the cost of a
			// CQL UNIQUE on a non-PK column would be far higher than the
			// occasional race we'd settle by retrying on the duplicate row.
			const existing = (await state.tables.workspaces.find({}).toArray()).map(
				workspaceFromRow,
			);
			assertNoWorkspaceConflict(existing, {
				name: input.name,
				url: input.url ?? null,
				keyspace: input.keyspace ?? null,
			});
			const now = nowIso();
			const record: WorkspaceRecord = {
				uid,
				name: input.name,
				url: input.url ?? null,
				kind: input.kind,
				credentials: { ...(input.credentials ?? {}) },
				keyspace: input.keyspace ?? null,
				rlacEnabled: input.rlacEnabled ?? false,
				createdAt: now,
				updatedAt: now,
			};
			await state.tables.workspaces.insertOne(workspaceToRow(record));
			return record;
		},

		async updateWorkspace(
			uid: string,
			patch: UpdateWorkspaceInput,
		): Promise<WorkspaceRecord> {
			const existing = await state.tables.workspaces.findOne({ uid });
			if (!existing) throw new ControlPlaneNotFoundError("workspace", uid);
			const base = workspaceFromRow(existing);
			const next: WorkspaceRecord = {
				...base,
				...(patch.name !== undefined && { name: patch.name }),
				...(patch.url !== undefined && { url: patch.url }),
				...(patch.credentials !== undefined && {
					credentials: { ...patch.credentials },
				}),
				...(patch.keyspace !== undefined && { keyspace: patch.keyspace }),
				...(patch.rlacEnabled !== undefined && {
					rlacEnabled: patch.rlacEnabled,
				}),
				updatedAt: nowIso(),
			};
			const allRows = (await state.tables.workspaces.find({}).toArray()).map(
				workspaceFromRow,
			);
			assertNoWorkspaceConflict(
				allRows,
				{ name: next.name, url: next.url, keyspace: next.keyspace },
				uid,
			);
			const nextRow = workspaceToRow(next);
			const { uid: _pk, ...fields } = nextRow;
			await state.tables.workspaces.updateOne({ uid }, { $set: fields });
			return next;
		},

		async deleteWorkspace(uid: string): Promise<{ deleted: boolean }> {
			const existing = await state.tables.workspaces.findOne({ uid });
			if (!existing) return { deleted: false };
			// Children-before-parent: remove every dependent partition
			// first, then the workspace row LAST and only if they all
			// succeeded. Astra has no cross-partition transaction, so a
			// partial failure leaves the workspace row intact and raises a
			// retryable ControlPlaneCascadeError — re-issuing
			// deleteWorkspace re-runs the idempotent cascade and removes
			// the now-childless row, so a transient Data API failure never
			// strands orphaned dependents. `reconcileOrphans` mops up any
			// orphans left by the older parent-row-first code path.
			const results = await deleteWorkspaceDependents(state, uid);
			const failed = results.filter((r) => r.status === "rejected");
			if (failed.length > 0) {
				throw new ControlPlaneCascadeError(
					"workspace",
					uid,
					failed.length,
					results.length,
					(failed[0] as PromiseRejectedResult).reason,
				);
			}
			await state.tables.workspaces.deleteOne({ uid });
			return { deleted: true };
		},
	};
}

/**
 * Run every dependent-partition delete for one workspace id,
 * concurrently, returning the settled results so the caller decides
 * whether the parent row may be removed.
 *
 * Astra's Data API requires the *full* partition key on `deleteMany`, so
 * tables partitioned by `(workspace_id, X)` are enumerated up front and
 * deleted one partition at a time. Every delete is idempotent (it
 * no-ops once the rows are gone), so this is safe to re-run after a
 * partial failure.
 *
 * Shared by {@link makeWorkspaceMethods}'s `deleteWorkspace`
 * (children-first, then the workspace row) and `reconcileOrphans`
 * (children only — the workspace row is already gone).
 *
 * Snapshot window: KB / agent / conversation sub-partitions are
 * enumerated once up front, so a child written into a *new* sub-partition
 * after that read (e.g. a conversation created mid-delete) can survive —
 * an inherent limit of partitioned deletes with no cross-partition
 * transaction. A normal `deleteWorkspace` isn't racing concurrent writes
 * to the same workspace, and `reconcileOrphans` is the backstop.
 */
export async function deleteWorkspaceDependents(
	state: AstraStoreState,
	uid: string,
): Promise<PromiseSettledResult<unknown>[]> {
	const [kbs, agents, conversations, keyRows, auditRows] = await Promise.all([
		state.tables.knowledgeBases.find({ workspace_id: uid }).toArray(),
		state.tables.agents.find({ workspace_id: uid }).toArray(),
		state.tables.conversations.find({ workspace_id: uid }).toArray(),
		state.tables.apiKeys.find({ workspace: uid }).toArray(),
		// policyAudit is partitioned by (workspace_id, audit_day); enumerate
		// the live rows up front so the fan-out below knows which day
		// partitions exist (audit_day is an open set, not a closed enum).
		state.tables.policyAudit.find({ workspace_id: uid }).toArray(),
	]);
	const deletes: Promise<unknown>[] = [
		// Prefix-lookup index rows keyed by their own prefix. Folded into
		// the cascade batch; auth re-reads the key row, so a brief window
		// where a lookup outlives its key row during the sweep is benign.
		...keyRows.map((row) =>
			state.tables.apiKeyLookup.deleteOne({ prefix: row.prefix }),
		),
		state.tables.apiKeys.deleteMany({ workspace: uid }),
		// Single-column partitions — workspace_id alone is the full PK.
		state.tables.knowledgeBases.deleteMany({ workspace_id: uid }),
		state.tables.chunkingServices.deleteMany({ workspace_id: uid }),
		state.tables.embeddingServices.deleteMany({ workspace_id: uid }),
		state.tables.rerankingServices.deleteMany({ workspace_id: uid }),
		state.tables.llmServices.deleteMany({ workspace_id: uid }),
		state.tables.agents.deleteMany({ workspace_id: uid }),
		// RLAC principals + MCP servers — single-column workspace_id partitions.
		state.tables.principals.deleteMany({ workspace_id: uid }),
		state.tables.mcpServers.deleteMany({ workspace_id: uid }),
	];
	// (workspace_id, knowledge_base_id) partitions.
	for (const kb of kbs) {
		deletes.push(
			state.tables.knowledgeFilters.deleteMany({
				workspace_id: uid,
				knowledge_base_id: kb.knowledge_base_id,
			}),
			state.tables.ragDocuments.deleteMany({
				workspace_id: uid,
				knowledge_base_id: kb.knowledge_base_id,
			}),
		);
		// (workspace_id, knowledge_base_id, status) partitions — fan out
		// across the closed DocumentStatus enum so we don't scan first.
		for (const status of DOCUMENT_STATUSES) {
			deletes.push(
				state.tables.ragDocumentsByStatus.deleteMany({
					workspace_id: uid,
					knowledge_base_id: kb.knowledge_base_id,
					status,
				}),
			);
		}
	}
	// Chat cascade: (workspace_id, agent_id) conversations,
	// (workspace_id, conversation_id) messages.
	for (const agent of agents) {
		deletes.push(
			state.tables.conversations.deleteMany({
				workspace_id: uid,
				agent_id: agent.agent_id,
			}),
		);
	}
	for (const conv of conversations) {
		deletes.push(
			state.tables.messages.deleteMany({
				workspace_id: uid,
				conversation_id: conv.conversation_id,
			}),
		);
	}
	// (workspace_id, audit_day) partitions — fan out one full-PK deleteMany
	// per distinct day actually present. Unlike ragDocumentsByStatus (a
	// closed status enum) audit_day is open-ended, so we enumerate from the
	// rows read above rather than iterating a fixed set. policyAudit is
	// purged, not retained — see `WORKSPACE_CASCADE_STEPS`.
	for (const day of new Set(auditRows.map((r) => r.audit_day))) {
		deletes.push(
			state.tables.policyAudit.deleteMany({
				workspace_id: uid,
				audit_day: day,
			}),
		);
	}
	return Promise.allSettled(deletes);
}
