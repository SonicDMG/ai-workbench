/**
 * Principal aggregate slice (RLAC prototype) — file backend.
 */

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
import type { PrincipalRecord } from "../types.js";
import { assertWorkspace, type FileStoreState } from "./state.js";

export function makePrincipalMethods(state: FileStoreState): PrincipalRepo {
	return {
		async listPrincipals(
			workspace: string,
		): Promise<readonly PrincipalRecord[]> {
			await assertWorkspace(state, workspace);
			const rows = await state.readAll("principals");
			return rows
				.filter((r) => r.workspaceId === workspace)
				.sort((a, b) => a.principalId.localeCompare(b.principalId));
		},

		async getPrincipal(
			workspace: string,
			principalId: string,
		): Promise<PrincipalRecord | null> {
			await assertWorkspace(state, workspace);
			const rows = await state.readAll("principals");
			return (
				rows.find(
					(r) => r.workspaceId === workspace && r.principalId === principalId,
				) ?? null
			);
		},

		async createPrincipal(
			workspace: string,
			input: CreatePrincipalInput,
		): Promise<PrincipalRecord> {
			await assertWorkspace(state, workspace);
			return state.mutate("principals", (rows) => {
				if (
					rows.some(
						(r) =>
							r.workspaceId === workspace &&
							r.principalId === input.principalId,
					)
				) {
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
					createdAt: now,
					updatedAt: now,
				};
				return { rows: [...rows, record], result: record };
			});
		},

		async updatePrincipal(
			workspace: string,
			principalId: string,
			patch: UpdatePrincipalInput,
		): Promise<PrincipalRecord> {
			await assertWorkspace(state, workspace);
			return state.mutate("principals", (rows) => {
				const idx = rows.findIndex(
					(r) => r.workspaceId === workspace && r.principalId === principalId,
				);
				if (idx < 0) {
					throw new ControlPlaneNotFoundError("principal", principalId);
				}
				const existing = rows[idx] as PrincipalRecord;
				const next: PrincipalRecord = {
					...existing,
					...(patch.label !== undefined && { label: patch.label }),
					...(patch.attributes !== undefined && {
						attributes: { ...patch.attributes },
					}),
					updatedAt: nowIso(),
				};
				const nextRows = [...rows];
				nextRows[idx] = next;
				return { rows: nextRows, result: next };
			});
		},

		async deletePrincipal(
			workspace: string,
			principalId: string,
		): Promise<{ deleted: boolean }> {
			await assertWorkspace(state, workspace);
			return state.mutate("principals", (rows) => {
				const next = rows.filter(
					(r) =>
						!(r.workspaceId === workspace && r.principalId === principalId),
				);
				return {
					rows: next,
					result: { deleted: next.length !== rows.length },
				};
			});
		},
	};
}
