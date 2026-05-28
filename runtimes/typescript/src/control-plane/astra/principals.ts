/**
 * Principal aggregate slice (RLAC prototype) — Astra backend.
 *
 * Backed by `wb_principals_by_workspace`. The table is workbench-owned
 * (no Data API DDL change required) and lifts to a real Astra table
 * the same way every other `wb_*` aggregate does. This replaces the
 * in-process Map fallback the prototype shipped with; principals now
 * survive runtime restarts.
 *
 * Conventions match the rest of the Astra slices:
 *   - `findOne` returning null surfaces `ControlPlaneNotFoundError`
 *     where the contract demands it.
 *   - `insertOne` is upsert-by-default in Data API; we check existence
 *     first so a re-create with the same id surfaces a 409 conflict
 *     instead of silently overwriting attributes.
 */

import {
	principalFromRow,
	principalToRow,
} from "../../astra-client/converters.js";
import { nowIso } from "../defaults.js";
import {
	ControlPlaneConflictError,
	ControlPlaneNotFoundError,
} from "../errors.js";
import type {
	CreatePrincipalInput,
	PrincipalRepo,
	UpdatePrincipalInput,
} from "../store.js";
import { DEFAULT_ROLE, type PrincipalRecord } from "../types.js";
import { type AstraStoreState, assertWorkspace } from "./state.js";

export function makePrincipalMethods(state: AstraStoreState): PrincipalRepo {
	return {
		async listPrincipals(
			workspace: string,
		): Promise<readonly PrincipalRecord[]> {
			await assertWorkspace(state, workspace);
			const rows = await state.tables.principals
				.find({ workspace_id: workspace })
				.toArray();
			return rows
				.map(principalFromRow)
				.sort((a, b) => a.principalId.localeCompare(b.principalId));
		},

		async getPrincipal(
			workspace: string,
			principalId: string,
		): Promise<PrincipalRecord | null> {
			await assertWorkspace(state, workspace);
			const row = await state.tables.principals.findOne({
				workspace_id: workspace,
				principal_id: principalId,
			});
			return row ? principalFromRow(row) : null;
		},

		async createPrincipal(
			workspace: string,
			input: CreatePrincipalInput,
		): Promise<PrincipalRecord> {
			await assertWorkspace(state, workspace);
			const existing = await state.tables.principals.findOne({
				workspace_id: workspace,
				principal_id: input.principalId,
			});
			if (existing) {
				throw new ControlPlaneConflictError(
					`principal '${input.principalId}' already exists in workspace '${workspace}'`,
				);
			}
			const now = nowIso();
			const record: PrincipalRecord = {
				workspaceId: workspace,
				principalId: input.principalId,
				label: input.label ?? null,
				attributes: { ...(input.attributes ?? {}) },
				role: input.role ?? DEFAULT_ROLE,
				createdAt: now,
				updatedAt: now,
			};
			await state.tables.principals.insertOne(principalToRow(record));
			return record;
		},

		async updatePrincipal(
			workspace: string,
			principalId: string,
			patch: UpdatePrincipalInput,
		): Promise<PrincipalRecord> {
			await assertWorkspace(state, workspace);
			const existing = await state.tables.principals.findOne({
				workspace_id: workspace,
				principal_id: principalId,
			});
			if (!existing) {
				throw new ControlPlaneNotFoundError("principal", principalId);
			}
			const base = principalFromRow(existing);
			const next: PrincipalRecord = {
				...base,
				...(patch.label !== undefined && { label: patch.label }),
				...(patch.attributes !== undefined && {
					attributes: { ...patch.attributes },
				}),
				...(patch.role !== undefined && { role: patch.role }),
				updatedAt: nowIso(),
			};
			const nextRow = principalToRow(next);
			const { workspace_id: _w, principal_id: _p, ...fields } = nextRow;
			await state.tables.principals.updateOne(
				{ workspace_id: workspace, principal_id: principalId },
				{ $set: fields },
			);
			return next;
		},

		async deletePrincipal(
			workspace: string,
			principalId: string,
		): Promise<{ deleted: boolean }> {
			await assertWorkspace(state, workspace);
			const existing = await state.tables.principals.findOne({
				workspace_id: workspace,
				principal_id: principalId,
			});
			if (!existing) return { deleted: false };
			await state.tables.principals.deleteOne({
				workspace_id: workspace,
				principal_id: principalId,
			});
			return { deleted: true };
		},
	};
}
