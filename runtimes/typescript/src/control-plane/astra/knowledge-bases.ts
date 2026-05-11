/**
 * Knowledge-base aggregate slice for the Astra-backed store.
 *
 * Owns `wb_knowledge_bases` plus the cascade across RAG docs, knowledge
 * filters, and conversation `knowledge_base_ids` references on delete.
 * Reference guards for the embedding / chunking / reranking services
 * are checked at create time.
 */

import { randomUUID } from "node:crypto";
import {
	knowledgeBaseFromRow,
	knowledgeBaseToRow,
} from "../../astra-client/converters.js";
import {
	DEFAULT_KB_STATUS,
	DEFAULT_LEXICAL,
	defaultVectorCollection,
	nowIso,
} from "../defaults.js";
import {
	ControlPlaneConflictError,
	ControlPlaneNotFoundError,
} from "../errors.js";
import type {
	CreateKnowledgeBaseInput,
	KnowledgeBaseRepo,
	UpdateKnowledgeBaseInput,
} from "../store.js";
import { DOCUMENT_STATUSES, type KnowledgeBaseRecord } from "../types.js";
import {
	type AstraStoreState,
	assertChunkingService,
	assertEmbeddingService,
	assertRerankingService,
	assertWorkspace,
} from "./state.js";

export function makeKnowledgeBaseMethods(
	state: AstraStoreState,
): KnowledgeBaseRepo {
	return {
		async listKnowledgeBases(
			workspace: string,
		): Promise<readonly KnowledgeBaseRecord[]> {
			await assertWorkspace(state, workspace);
			const rows = await state.tables.knowledgeBases
				.find({ workspace_id: workspace })
				.toArray();
			return rows.map(knowledgeBaseFromRow);
		},

		async getKnowledgeBase(
			workspace: string,
			uid: string,
		): Promise<KnowledgeBaseRecord | null> {
			await assertWorkspace(state, workspace);
			const row = await state.tables.knowledgeBases.findOne({
				workspace_id: workspace,
				knowledge_base_id: uid,
			});
			return row ? knowledgeBaseFromRow(row) : null;
		},

		async createKnowledgeBase(
			workspace: string,
			input: CreateKnowledgeBaseInput,
		): Promise<KnowledgeBaseRecord> {
			await assertWorkspace(state, workspace);
			await assertEmbeddingService(state, workspace, input.embeddingServiceId);
			await assertChunkingService(state, workspace, input.chunkingServiceId);
			if (input.rerankingServiceId) {
				await assertRerankingService(
					state,
					workspace,
					input.rerankingServiceId,
				);
			}
			const uid = input.uid ?? randomUUID();
			if (
				await state.tables.knowledgeBases.findOne({
					workspace_id: workspace,
					knowledge_base_id: uid,
				})
			) {
				throw new ControlPlaneConflictError(
					`knowledge base with id '${uid}' already exists in workspace '${workspace}'`,
				);
			}
			const now = nowIso();
			const record: KnowledgeBaseRecord = {
				workspaceId: workspace,
				knowledgeBaseId: uid,
				name: input.name,
				description: input.description ?? null,
				status: input.status ?? DEFAULT_KB_STATUS,
				embeddingServiceId: input.embeddingServiceId,
				chunkingServiceId: input.chunkingServiceId,
				rerankingServiceId: input.rerankingServiceId ?? null,
				language: input.language ?? null,
				vectorCollection:
					input.vectorCollection ?? defaultVectorCollection(uid),
				owned: input.owned ?? true,
				lexical: input.lexical ?? DEFAULT_LEXICAL,
				createdAt: now,
				updatedAt: now,
			};
			await state.tables.knowledgeBases.insertOne(knowledgeBaseToRow(record));
			return record;
		},

		async updateKnowledgeBase(
			workspace: string,
			uid: string,
			patch: UpdateKnowledgeBaseInput,
		): Promise<KnowledgeBaseRecord> {
			await assertWorkspace(state, workspace);
			if (
				patch.rerankingServiceId !== undefined &&
				patch.rerankingServiceId !== null
			) {
				await assertRerankingService(
					state,
					workspace,
					patch.rerankingServiceId,
				);
			}
			const existing = await state.tables.knowledgeBases.findOne({
				workspace_id: workspace,
				knowledge_base_id: uid,
			});
			if (!existing) throw new ControlPlaneNotFoundError("knowledge base", uid);
			const base = knowledgeBaseFromRow(existing);
			const next: KnowledgeBaseRecord = {
				...base,
				...(patch.description !== undefined && {
					description: patch.description,
				}),
				...(patch.status !== undefined && { status: patch.status }),
				...(patch.rerankingServiceId !== undefined && {
					rerankingServiceId: patch.rerankingServiceId,
				}),
				...(patch.language !== undefined && { language: patch.language }),
				...(patch.lexical !== undefined && { lexical: patch.lexical }),
				updatedAt: nowIso(),
			};
			const nextRow = knowledgeBaseToRow(next);
			const { workspace_id: _w, knowledge_base_id: _kb, ...fields } = nextRow;
			await state.tables.knowledgeBases.updateOne(
				{ workspace_id: workspace, knowledge_base_id: uid },
				{ $set: fields },
			);
			return next;
		},

		async deleteKnowledgeBase(
			workspace: string,
			uid: string,
		): Promise<{ deleted: boolean }> {
			await assertWorkspace(state, workspace);
			const existing = await state.tables.knowledgeBases.findOne({
				workspace_id: workspace,
				knowledge_base_id: uid,
			});
			if (!existing) return { deleted: false };
			await state.tables.knowledgeBases.deleteOne({
				workspace_id: workspace,
				knowledge_base_id: uid,
			});
			// Cascade RAG document rows + secondary indexes. Underlying vector
			// collection cleanup is the caller's responsibility (KB delete
			// route handles it). `wb_rag_documents_by_status` partitions by
			// `(workspace_id, knowledge_base_id, status)`, so the Data API
			// requires us to fan out one `deleteMany` per status rather
			// than letting `(workspace_id, knowledge_base_id)` alone
			// match the entire partition family.
			const cascade: Promise<unknown>[] = [
				state.tables.ragDocuments.deleteMany({
					workspace_id: workspace,
					knowledge_base_id: uid,
				}),
				state.tables.knowledgeFilters.deleteMany({
					workspace_id: workspace,
					knowledge_base_id: uid,
				}),
			];
			for (const status of DOCUMENT_STATUSES) {
				cascade.push(
					state.tables.ragDocumentsByStatus.deleteMany({
						workspace_id: workspace,
						knowledge_base_id: uid,
						status,
					}),
				);
			}
			await Promise.all(cascade);
			// Eager cascade into chat: rewrite any conversation row whose
			// `knowledge_base_ids` set contained the deleted KB. We can't
			// do this server-side (no SET-element delete on the wire), so
			// we read back the workspace's conversations, filter, and
			// patch each affected row. v0 expects O(handful) chats per
			// workspace; if that grows we'll add a `_by_kb` secondary
			// index on conversations.
			const convRows = await state.tables.conversations
				.find({ workspace_id: workspace })
				.toArray();
			for (const row of convRows) {
				const kbs = row.knowledge_base_ids;
				if (!kbs?.has(uid)) continue;
				const next = new Set(kbs);
				next.delete(uid);
				await state.tables.conversations.updateOne(
					{
						workspace_id: workspace,
						agent_id: row.agent_id,
						created_at: row.created_at,
						conversation_id: row.conversation_id,
					},
					{ $set: { knowledge_base_ids: next.size > 0 ? next : null } },
				);
			}
			return { deleted: true };
		},
	};
}
