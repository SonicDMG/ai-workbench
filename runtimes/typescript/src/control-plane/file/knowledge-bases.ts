/**
 * Knowledge-base aggregate slice for the file-backed store. Cascades
 * into RAG docs, knowledge filters, and conversation
 * `knowledgeBaseIds` references on delete — each cascade acquires its
 * own mutex.
 */

import { randomUUID } from "node:crypto";
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
import type { KnowledgeBaseRecord } from "../types.js";
import {
	assertChunkingService,
	assertEmbeddingService,
	assertRerankingService,
	assertWorkspace,
	type FileStoreState,
} from "./state.js";

export function makeKnowledgeBaseMethods(
	state: FileStoreState,
): KnowledgeBaseRepo {
	return {
		async listKnowledgeBases(
			workspace: string,
		): Promise<readonly KnowledgeBaseRecord[]> {
			await assertWorkspace(state, workspace);
			const all = await state.readAll("knowledge-bases");
			return all.filter((kb) => kb.workspaceId === workspace);
		},

		async getKnowledgeBase(
			workspace: string,
			uid: string,
		): Promise<KnowledgeBaseRecord | null> {
			await assertWorkspace(state, workspace);
			const all = await state.readAll("knowledge-bases");
			return (
				all.find(
					(kb) => kb.workspaceId === workspace && kb.knowledgeBaseId === uid,
				) ?? null
			);
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
			return state.mutate("knowledge-bases", (rows) => {
				const uid = input.uid ?? randomUUID();
				if (
					rows.some(
						(kb) => kb.workspaceId === workspace && kb.knowledgeBaseId === uid,
					)
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
				return { rows: [...rows, record], result: record };
			});
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
			return state.mutate("knowledge-bases", (rows) => {
				const idx = rows.findIndex(
					(kb) => kb.workspaceId === workspace && kb.knowledgeBaseId === uid,
				);
				if (idx < 0) {
					throw new ControlPlaneNotFoundError("knowledge base", uid);
				}
				const existing = rows[idx] as KnowledgeBaseRecord;
				const next: KnowledgeBaseRecord = {
					...existing,
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
				const nextRows = [...rows];
				nextRows[idx] = next;
				return { rows: nextRows, result: next };
			});
		},

		async deleteKnowledgeBase(
			workspace: string,
			uid: string,
		): Promise<{ deleted: boolean }> {
			await assertWorkspace(state, workspace);
			const res = await state.mutate("knowledge-bases", (rows) => {
				const next = rows.filter(
					(kb) => !(kb.workspaceId === workspace && kb.knowledgeBaseId === uid),
				);
				return {
					rows: next,
					result: { deleted: next.length !== rows.length },
				};
			});
			// Cascade RAG document rows. Underlying vector collection cleanup
			// is the caller's responsibility (KB delete route handles it).
			await state.mutate("rag-documents", (rows) => ({
				rows: rows.filter(
					(d) => !(d.workspaceId === workspace && d.knowledgeBaseId === uid),
				),
				result: null,
			}));
			await state.mutate("knowledge-filters", (rows) => ({
				rows: rows.filter(
					(f) => !(f.workspaceId === workspace && f.knowledgeBaseId === uid),
				),
				result: null,
			}));
			// Eager cascade into chat: drop the KB id from any conversation's
			// RAG-grounding set so retrievals don't try to query a no-longer-
			// existing KB. No-op if no conversation referenced the KB.
			await state.mutate("conversations", (rows) => ({
				rows: rows.map((c) =>
					c.workspaceId === workspace && c.knowledgeBaseIds.includes(uid)
						? {
								...c,
								knowledgeBaseIds: Object.freeze(
									c.knowledgeBaseIds.filter((id) => id !== uid),
								),
							}
						: c,
				),
				result: null,
			}));
			return res;
		},
	};
}
