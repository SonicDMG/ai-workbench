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
			// Tear down the prefix-lookup entries before the owning table so a
			// concurrent verify can't hit a lookup pointing at a just-deleted
			// key row.
			const keyRows = await state.tables.apiKeys
				.find({ workspace: uid })
				.toArray();
			for (const row of keyRows) {
				await state.tables.apiKeyLookup.deleteOne({ prefix: row.prefix });
			}
			// Astra Data API requires the *full* partition key on
			// `deleteMany`, so for tables partitioned by (workspace_id, X)
			// we enumerate the dependent rows up front and issue one
			// deleteMany per partition. Read the dependents *before*
			// removing the workspace row — purely defensive; the dependent
			// tables don't FK back to the workspace row, but it keeps the
			// "everything we need to delete" snapshot consistent.
			const [kbs, agents, conversations] = await Promise.all([
				state.tables.knowledgeBases.find({ workspace_id: uid }).toArray(),
				state.tables.agents.find({ workspace_id: uid }).toArray(),
				state.tables.conversations.find({ workspace_id: uid }).toArray(),
			]);
			await state.tables.workspaces.deleteOne({ uid });
			const deletes: Promise<unknown>[] = [
				state.tables.apiKeys.deleteMany({ workspace: uid }),
				// Single-column partitions — workspace_id alone is the full PK.
				state.tables.knowledgeBases.deleteMany({ workspace_id: uid }),
				state.tables.chunkingServices.deleteMany({ workspace_id: uid }),
				state.tables.embeddingServices.deleteMany({ workspace_id: uid }),
				state.tables.rerankingServices.deleteMany({ workspace_id: uid }),
				state.tables.llmServices.deleteMany({ workspace_id: uid }),
				state.tables.agents.deleteMany({ workspace_id: uid }),
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
				// (workspace_id, knowledge_base_id, status) partitions —
				// fan out across the closed DocumentStatus enum so we don't
				// have to scan the index first.
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
			// Chat cascade: (workspace_id, agent_id) for conversations,
			// (workspace_id, conversation_id) for messages.
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
			await Promise.all(deletes);
			return { deleted: true };
		},
	};
}
