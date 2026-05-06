/**
 * Knowledge-filter aggregate slice (KB-scoped). Owns the
 * `Map<${workspaceId}:${kbId}, Map<filterId, KnowledgeFilterRecord>>`
 * partition.
 */

import { randomUUID } from "node:crypto";
import { nowIso } from "../defaults.js";
import {
	ControlPlaneConflictError,
	ControlPlaneNotFoundError,
} from "../errors.js";
import { freezeFilter } from "../shared/records.js";
import type {
	CreateKnowledgeFilterInput,
	KnowledgeFilterRepo,
	UpdateKnowledgeFilterInput,
} from "../store.js";
import type { KnowledgeFilterRecord } from "../types.js";
import { assertKnowledgeBase, docKey, type MemoryStoreState } from "./state.js";

export function makeKnowledgeFilterMethods(
	state: MemoryStoreState,
): KnowledgeFilterRepo {
	return {
		async listKnowledgeFilters(
			workspace: string,
			knowledgeBase: string,
		): Promise<readonly KnowledgeFilterRecord[]> {
			await assertKnowledgeBase(state, workspace, knowledgeBase);
			return Array.from(
				state.knowledgeFilters
					.get(docKey(workspace, knowledgeBase))
					?.values() ?? [],
			);
		},

		async getKnowledgeFilter(
			workspace: string,
			knowledgeBase: string,
			uid: string,
		): Promise<KnowledgeFilterRecord | null> {
			await assertKnowledgeBase(state, workspace, knowledgeBase);
			return (
				state.knowledgeFilters
					.get(docKey(workspace, knowledgeBase))
					?.get(uid) ?? null
			);
		},

		async createKnowledgeFilter(
			workspace: string,
			knowledgeBase: string,
			input: CreateKnowledgeFilterInput,
		): Promise<KnowledgeFilterRecord> {
			await assertKnowledgeBase(state, workspace, knowledgeBase);
			const uid = input.uid ?? randomUUID();
			const key = docKey(workspace, knowledgeBase);
			const bucket = state.knowledgeFilters.get(key) ?? new Map();
			if (bucket.has(uid)) {
				throw new ControlPlaneConflictError(
					`knowledge filter with id '${uid}' already exists in knowledge base '${knowledgeBase}'`,
				);
			}
			const now = nowIso();
			const record: KnowledgeFilterRecord = {
				workspaceId: workspace,
				knowledgeBaseId: knowledgeBase,
				knowledgeFilterId: uid,
				name: input.name,
				description: input.description ?? null,
				filter: freezeFilter(input.filter),
				createdAt: now,
				updatedAt: now,
			};
			bucket.set(uid, record);
			state.knowledgeFilters.set(key, bucket);
			return record;
		},

		async updateKnowledgeFilter(
			workspace: string,
			knowledgeBase: string,
			uid: string,
			patch: UpdateKnowledgeFilterInput,
		): Promise<KnowledgeFilterRecord> {
			await assertKnowledgeBase(state, workspace, knowledgeBase);
			const key = docKey(workspace, knowledgeBase);
			const existing = state.knowledgeFilters.get(key)?.get(uid);
			if (!existing) {
				throw new ControlPlaneNotFoundError("knowledge filter", uid);
			}
			const next: KnowledgeFilterRecord = {
				...existing,
				...(patch.name !== undefined && { name: patch.name }),
				...(patch.description !== undefined && {
					description: patch.description,
				}),
				...(patch.filter !== undefined && {
					filter: freezeFilter(patch.filter),
				}),
				updatedAt: nowIso(),
			};
			state.knowledgeFilters.get(key)?.set(uid, next);
			return next;
		},

		async deleteKnowledgeFilter(
			workspace: string,
			knowledgeBase: string,
			uid: string,
		): Promise<{ deleted: boolean }> {
			await assertKnowledgeBase(state, workspace, knowledgeBase);
			const deleted =
				state.knowledgeFilters
					.get(docKey(workspace, knowledgeBase))
					?.delete(uid) ?? false;
			return { deleted };
		},
	};
}
