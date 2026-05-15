/**
 * Workspace aggregate slice for the in-memory store.
 *
 * Owns the `workspaces` map plus the cascade across every dependent
 * partition. The cascade reaches into the shared {@link MemoryStoreState}
 * directly so each child aggregate can keep its own state contract
 * minimal — there is no separate "delete-for-workspace" hook on every
 * slice.
 */

import { randomUUID } from "node:crypto";
import { byCreatedAtThenId, nowIso } from "../defaults.js";
import {
	ControlPlaneConflictError,
	ControlPlaneNotFoundError,
} from "../errors.js";
import { freezeCredentials } from "../shared/records.js";
import { assertNoWorkspaceConflict } from "../shared/workspaces.js";
import type {
	CreateWorkspaceInput,
	UpdateWorkspaceInput,
	WorkspaceRepo,
} from "../store.js";
import type { WorkspaceRecord } from "../types.js";
import type { MemoryStoreState } from "./state.js";

export function makeWorkspaceMethods(state: MemoryStoreState): WorkspaceRepo {
	return {
		async listWorkspaces(): Promise<readonly WorkspaceRecord[]> {
			return Array.from(state.workspaces.values()).sort(byCreatedAtThenId);
		},

		async getWorkspace(uid: string): Promise<WorkspaceRecord | null> {
			return state.workspaces.get(uid) ?? null;
		},

		async createWorkspace(
			input: CreateWorkspaceInput,
		): Promise<WorkspaceRecord> {
			const uid = input.uid ?? randomUUID();
			if (state.workspaces.has(uid)) {
				throw new ControlPlaneConflictError(
					`workspace with id '${uid}' already exists`,
				);
			}
			assertNoWorkspaceConflict([...state.workspaces.values()], {
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
				credentials: freezeCredentials(input.credentials),
				keyspace: input.keyspace ?? null,
				rlacEnabled: input.rlacEnabled ?? false,
				createdAt: now,
				updatedAt: now,
			};
			state.workspaces.set(uid, record);
			return record;
		},

		async updateWorkspace(
			uid: string,
			patch: UpdateWorkspaceInput,
		): Promise<WorkspaceRecord> {
			const existing = state.workspaces.get(uid);
			if (!existing) {
				throw new ControlPlaneNotFoundError("workspace", uid);
			}
			const next: WorkspaceRecord = {
				...existing,
				...(patch.name !== undefined && { name: patch.name }),
				...(patch.url !== undefined && { url: patch.url }),
				...(patch.credentials !== undefined && {
					credentials: freezeCredentials(patch.credentials),
				}),
				...(patch.keyspace !== undefined && { keyspace: patch.keyspace }),
				...(patch.rlacEnabled !== undefined && {
					rlacEnabled: patch.rlacEnabled,
				}),
				updatedAt: nowIso(),
			};
			assertNoWorkspaceConflict(
				[...state.workspaces.values()],
				{ name: next.name, url: next.url, keyspace: next.keyspace },
				uid,
			);
			state.workspaces.set(uid, next);
			return next;
		},

		async deleteWorkspace(uid: string): Promise<{ deleted: boolean }> {
			const deleted = state.workspaces.delete(uid);
			// Cascade: delete all dependent partitions.
			state.apiKeyRepo.deleteAllForWorkspace(uid);
			state.knowledgeBases.delete(uid);
			for (const key of Array.from(state.knowledgeFilters.keys())) {
				if (key.startsWith(`${uid}:`)) state.knowledgeFilters.delete(key);
			}
			state.chunkingServices.delete(uid);
			state.embeddingServices.delete(uid);
			state.rerankingServices.delete(uid);
			state.llmServices.delete(uid);
			for (const key of Array.from(state.ragDocuments.keys())) {
				if (key.startsWith(`${uid}:`)) state.ragDocuments.delete(key);
			}
			// Chat cascade: agents → conversations → messages.
			state.agents.delete(uid);
			for (const key of Array.from(state.conversations.keys())) {
				if (key.startsWith(`${uid}:`)) state.conversations.delete(key);
			}
			for (const key of Array.from(state.messages.keys())) {
				if (key.startsWith(`${uid}:`)) state.messages.delete(key);
			}
			return { deleted };
		},
	};
}
