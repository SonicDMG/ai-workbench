/**
 * Principal aggregate slice (RLAC prototype).
 *
 * Owns the `Map<workspaceId, Map<principalId, PrincipalRecord>>`
 * partition. Memory-only; mirrors the structure of every other
 * workspace-partitioned aggregate.
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
import { DEFAULT_ROLE, type PrincipalRecord } from "../types.js";
import { assertWorkspace, type MemoryStoreState } from "./state.js";

function freezeAttributes(
	input: Readonly<Record<string, string>> | undefined,
): Readonly<Record<string, string>> {
	if (!input) return Object.freeze({});
	return Object.freeze({ ...input });
}

export function makePrincipalMethods(state: MemoryStoreState): PrincipalRepo {
	return {
		async listPrincipals(
			workspace: string,
		): Promise<readonly PrincipalRecord[]> {
			await assertWorkspace(state, workspace);
			const bucket = state.principals.get(workspace);
			if (!bucket) return [];
			return Array.from(bucket.values()).sort((a, b) =>
				a.principalId.localeCompare(b.principalId),
			);
		},

		async getPrincipal(
			workspace: string,
			principalId: string,
		): Promise<PrincipalRecord | null> {
			await assertWorkspace(state, workspace);
			return state.principals.get(workspace)?.get(principalId) ?? null;
		},

		async createPrincipal(
			workspace: string,
			input: CreatePrincipalInput,
		): Promise<PrincipalRecord> {
			await assertWorkspace(state, workspace);
			const bucket = state.principals.get(workspace) ?? new Map();
			if (bucket.has(input.principalId)) {
				throw new ControlPlaneConflictError(
					`principal '${input.principalId}' already exists in workspace '${workspace}'`,
				);
			}
			const now = nowIso();
			const record: PrincipalRecord = {
				workspaceId: workspace,
				principalId: input.principalId,
				label: input.label ?? null,
				attributes: freezeAttributes(input.attributes),
				role: input.role ?? DEFAULT_ROLE,
				createdAt: now,
				updatedAt: now,
			};
			bucket.set(input.principalId, record);
			state.principals.set(workspace, bucket);
			return record;
		},

		async updatePrincipal(
			workspace: string,
			principalId: string,
			patch: UpdatePrincipalInput,
		): Promise<PrincipalRecord> {
			await assertWorkspace(state, workspace);
			const existing = state.principals.get(workspace)?.get(principalId);
			if (!existing) {
				throw new ControlPlaneNotFoundError("principal", principalId);
			}
			const next: PrincipalRecord = {
				...existing,
				...(patch.label !== undefined && { label: patch.label }),
				...(patch.attributes !== undefined && {
					attributes: freezeAttributes(patch.attributes),
				}),
				...(patch.role !== undefined && { role: patch.role }),
				updatedAt: nowIso(),
			};
			state.principals.get(workspace)?.set(principalId, next);
			return next;
		},

		async deletePrincipal(
			workspace: string,
			principalId: string,
		): Promise<{ deleted: boolean }> {
			await assertWorkspace(state, workspace);
			return {
				deleted: state.principals.get(workspace)?.delete(principalId) ?? false,
			};
		},
	};
}
