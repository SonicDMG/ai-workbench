/**
 * Knowledge-filter aggregate slice (KB-scoped) for the file-backed
 * store.
 */

import { randomUUID } from "node:crypto";
import { nowIso } from "../defaults.js";
import {
	ControlPlaneConflictError,
	ControlPlaneNotFoundError,
} from "../errors.js";
import type {
	CreateKnowledgeFilterInput,
	KnowledgeFilterRepo,
	UpdateKnowledgeFilterInput,
} from "../store.js";
import type { KnowledgeFilterRecord } from "../types.js";
import { assertKnowledgeBase, type FileStoreState } from "./state.js";

export function makeKnowledgeFilterMethods(
	state: FileStoreState,
): KnowledgeFilterRepo {
	return {
		async listKnowledgeFilters(
			workspace: string,
			knowledgeBase: string,
		): Promise<readonly KnowledgeFilterRecord[]> {
			await assertKnowledgeBase(state, workspace, knowledgeBase);
			const all = await state.readAll("knowledge-filters");
			return all.filter(
				(f) =>
					f.workspaceId === workspace && f.knowledgeBaseId === knowledgeBase,
			);
		},

		async getKnowledgeFilter(
			workspace: string,
			knowledgeBase: string,
			uid: string,
		): Promise<KnowledgeFilterRecord | null> {
			await assertKnowledgeBase(state, workspace, knowledgeBase);
			const all = await state.readAll("knowledge-filters");
			return (
				all.find(
					(f) =>
						f.workspaceId === workspace &&
						f.knowledgeBaseId === knowledgeBase &&
						f.knowledgeFilterId === uid,
				) ?? null
			);
		},

		async createKnowledgeFilter(
			workspace: string,
			knowledgeBase: string,
			input: CreateKnowledgeFilterInput,
		): Promise<KnowledgeFilterRecord> {
			await assertKnowledgeBase(state, workspace, knowledgeBase);
			return state.mutate("knowledge-filters", (rows) => {
				const uid = input.uid ?? randomUUID();
				if (
					rows.some(
						(f) =>
							f.workspaceId === workspace &&
							f.knowledgeBaseId === knowledgeBase &&
							f.knowledgeFilterId === uid,
					)
				) {
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
					filter: { ...input.filter },
					createdAt: now,
					updatedAt: now,
				};
				return { rows: [...rows, record], result: record };
			});
		},

		async updateKnowledgeFilter(
			workspace: string,
			knowledgeBase: string,
			uid: string,
			patch: UpdateKnowledgeFilterInput,
		): Promise<KnowledgeFilterRecord> {
			await assertKnowledgeBase(state, workspace, knowledgeBase);
			return state.mutate("knowledge-filters", (rows) => {
				const idx = rows.findIndex(
					(f) =>
						f.workspaceId === workspace &&
						f.knowledgeBaseId === knowledgeBase &&
						f.knowledgeFilterId === uid,
				);
				if (idx < 0) {
					throw new ControlPlaneNotFoundError("knowledge filter", uid);
				}
				const existing = rows[idx] as KnowledgeFilterRecord;
				const next: KnowledgeFilterRecord = {
					...existing,
					...(patch.name !== undefined && { name: patch.name }),
					...(patch.description !== undefined && {
						description: patch.description,
					}),
					...(patch.filter !== undefined && { filter: { ...patch.filter } }),
					updatedAt: nowIso(),
				};
				const nextRows = [...rows];
				nextRows[idx] = next;
				return { rows: nextRows, result: next };
			});
		},

		async deleteKnowledgeFilter(
			workspace: string,
			knowledgeBase: string,
			uid: string,
		): Promise<{ deleted: boolean }> {
			await assertKnowledgeBase(state, workspace, knowledgeBase);
			return state.mutate("knowledge-filters", (rows) => {
				const next = rows.filter(
					(f) =>
						!(
							f.workspaceId === workspace &&
							f.knowledgeBaseId === knowledgeBase &&
							f.knowledgeFilterId === uid
						),
				);
				return {
					rows: next,
					result: { deleted: next.length !== rows.length },
				};
			});
		},
	};
}
