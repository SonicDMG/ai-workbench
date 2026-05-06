/**
 * Knowledge-base aggregate slice. Owns the
 * `Map<workspaceId, Map<kbId, KnowledgeBaseRecord>>` partition plus
 * the cascade across RAG docs, knowledge filters, and conversation
 * `knowledgeBaseIds` references.
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
import { freezeStringSet } from "../shared/records.js";
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
	docKey,
	type MemoryStoreState,
} from "./state.js";

export function makeKnowledgeBaseMethods(
	state: MemoryStoreState,
): KnowledgeBaseRepo {
	return {
		async listKnowledgeBases(
			workspace: string,
		): Promise<readonly KnowledgeBaseRecord[]> {
			await assertWorkspace(state, workspace);
			return Array.from(state.knowledgeBases.get(workspace)?.values() ?? []);
		},

		async getKnowledgeBase(
			workspace: string,
			uid: string,
		): Promise<KnowledgeBaseRecord | null> {
			await assertWorkspace(state, workspace);
			return state.knowledgeBases.get(workspace)?.get(uid) ?? null;
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
			const bucket = state.knowledgeBases.get(workspace) ?? new Map();
			if (bucket.has(uid)) {
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
			bucket.set(uid, record);
			state.knowledgeBases.set(workspace, bucket);
			return record;
		},

		async updateKnowledgeBase(
			workspace: string,
			uid: string,
			patch: UpdateKnowledgeBaseInput,
		): Promise<KnowledgeBaseRecord> {
			await assertWorkspace(state, workspace);
			const existing = state.knowledgeBases.get(workspace)?.get(uid);
			if (!existing) {
				throw new ControlPlaneNotFoundError("knowledge base", uid);
			}
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
			state.knowledgeBases.get(workspace)?.set(uid, next);
			return next;
		},

		async deleteKnowledgeBase(
			workspace: string,
			uid: string,
		): Promise<{ deleted: boolean }> {
			await assertWorkspace(state, workspace);
			const deleted = state.knowledgeBases.get(workspace)?.delete(uid) ?? false;
			if (deleted) {
				// Cascade RAG document rows so the next create with the same
				// uid starts clean. Underlying vector collection cleanup is the
				// caller's responsibility (KB delete route handles it).
				state.ragDocuments.delete(docKey(workspace, uid));
				state.knowledgeFilters.delete(docKey(workspace, uid));
				// Eager cascade into chat: drop the KB id from any
				// conversation's RAG-grounding set so future retrievals don't
				// try to query a no-longer-existing KB. Single sweep over the
				// workspace's conversations.
				for (const [agentKey, byChat] of state.conversations.entries()) {
					if (!agentKey.startsWith(`${workspace}:`)) continue;
					for (const [chatId, conv] of byChat.entries()) {
						if (!conv.knowledgeBaseIds.includes(uid)) continue;
						byChat.set(chatId, {
							...conv,
							knowledgeBaseIds: freezeStringSet(
								conv.knowledgeBaseIds.filter((id) => id !== uid),
							),
						});
					}
				}
			}
			return { deleted };
		},
	};
}
