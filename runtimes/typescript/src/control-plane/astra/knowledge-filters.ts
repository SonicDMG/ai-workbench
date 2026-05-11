/**
 * Knowledge-filter aggregate slice (KB-scoped) for the Astra-backed
 * store. Owns the `wb_knowledge_filters` table.
 */

import { randomUUID } from "node:crypto";
import {
	knowledgeFilterFromRow,
	knowledgeFilterToRow,
} from "../../astra-client/converters.js";
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
import { type AstraStoreState, assertKnowledgeBase } from "./state.js";

export function makeKnowledgeFilterMethods(
	state: AstraStoreState,
): KnowledgeFilterRepo {
	return {
		async listKnowledgeFilters(
			workspace: string,
			knowledgeBase: string,
		): Promise<readonly KnowledgeFilterRecord[]> {
			await assertKnowledgeBase(state, workspace, knowledgeBase);
			const rows = await state.tables.knowledgeFilters
				.find({ workspace_id: workspace, knowledge_base_id: knowledgeBase })
				.toArray();
			return rows.map(knowledgeFilterFromRow);
		},

		async getKnowledgeFilter(
			workspace: string,
			knowledgeBase: string,
			uid: string,
		): Promise<KnowledgeFilterRecord | null> {
			await assertKnowledgeBase(state, workspace, knowledgeBase);
			const row = await state.tables.knowledgeFilters.findOne({
				workspace_id: workspace,
				knowledge_base_id: knowledgeBase,
				knowledge_filter_id: uid,
			});
			return row ? knowledgeFilterFromRow(row) : null;
		},

		async createKnowledgeFilter(
			workspace: string,
			knowledgeBase: string,
			input: CreateKnowledgeFilterInput,
		): Promise<KnowledgeFilterRecord> {
			await assertKnowledgeBase(state, workspace, knowledgeBase);
			const uid = input.uid ?? randomUUID();
			if (
				await state.tables.knowledgeFilters.findOne({
					workspace_id: workspace,
					knowledge_base_id: knowledgeBase,
					knowledge_filter_id: uid,
				})
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
			await state.tables.knowledgeFilters.insertOne(
				knowledgeFilterToRow(record),
			);
			return record;
		},

		async updateKnowledgeFilter(
			workspace: string,
			knowledgeBase: string,
			uid: string,
			patch: UpdateKnowledgeFilterInput,
		): Promise<KnowledgeFilterRecord> {
			await assertKnowledgeBase(state, workspace, knowledgeBase);
			const existing = await state.tables.knowledgeFilters.findOne({
				workspace_id: workspace,
				knowledge_base_id: knowledgeBase,
				knowledge_filter_id: uid,
			});
			if (!existing) {
				throw new ControlPlaneNotFoundError("knowledge filter", uid);
			}
			const base = knowledgeFilterFromRow(existing);
			const next: KnowledgeFilterRecord = {
				...base,
				...(patch.name !== undefined && { name: patch.name }),
				...(patch.description !== undefined && {
					description: patch.description,
				}),
				...(patch.filter !== undefined && { filter: { ...patch.filter } }),
				updatedAt: nowIso(),
			};
			const nextRow = knowledgeFilterToRow(next);
			const {
				workspace_id: _w,
				knowledge_base_id: _kb,
				knowledge_filter_id: _kf,
				...fields
			} = nextRow;
			await state.tables.knowledgeFilters.updateOne(
				{
					workspace_id: workspace,
					knowledge_base_id: knowledgeBase,
					knowledge_filter_id: uid,
				},
				{ $set: fields },
			);
			return next;
		},

		async deleteKnowledgeFilter(
			workspace: string,
			knowledgeBase: string,
			uid: string,
		): Promise<{ deleted: boolean }> {
			await assertKnowledgeBase(state, workspace, knowledgeBase);
			const existing = await state.tables.knowledgeFilters.findOne({
				workspace_id: workspace,
				knowledge_base_id: knowledgeBase,
				knowledge_filter_id: uid,
			});
			if (!existing) return { deleted: false };
			await state.tables.knowledgeFilters.deleteOne({
				workspace_id: workspace,
				knowledge_base_id: knowledgeBase,
				knowledge_filter_id: uid,
			});
			return { deleted: true };
		},
	};
}
