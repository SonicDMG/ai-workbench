/**
 * RAG-document aggregate slice (KB-scoped). Owns the
 * `Map<${workspaceId}:${kbId}, Map<docId, RagDocumentRecord>>`
 * partition.
 */

import { randomUUID } from "node:crypto";
import { nowIso } from "../defaults.js";
import {
	ControlPlaneConflictError,
	ControlPlaneNotFoundError,
} from "../errors.js";
import { freezeMetadata } from "../shared/records.js";
import type {
	CreateRagDocumentInput,
	RagDocumentRepo,
	UpdateRagDocumentInput,
} from "../store.js";
import type { RagDocumentRecord } from "../types.js";
import { assertKnowledgeBase, docKey, type MemoryStoreState } from "./state.js";

export function makeRagDocumentMethods(
	state: MemoryStoreState,
): RagDocumentRepo {
	return {
		async listRagDocuments(
			workspace: string,
			knowledgeBase: string,
		): Promise<readonly RagDocumentRecord[]> {
			await assertKnowledgeBase(state, workspace, knowledgeBase);
			return Array.from(
				state.ragDocuments.get(docKey(workspace, knowledgeBase))?.values() ??
					[],
			);
		},

		async getRagDocument(
			workspace: string,
			knowledgeBase: string,
			uid: string,
		): Promise<RagDocumentRecord | null> {
			await assertKnowledgeBase(state, workspace, knowledgeBase);
			return (
				state.ragDocuments.get(docKey(workspace, knowledgeBase))?.get(uid) ??
				null
			);
		},

		async findRagDocumentByContentHash(
			workspace: string,
			knowledgeBase: string,
			contentHash: string,
		): Promise<RagDocumentRecord | null> {
			await assertKnowledgeBase(state, workspace, knowledgeBase);
			const map = state.ragDocuments.get(docKey(workspace, knowledgeBase));
			if (!map) return null;
			for (const doc of map.values()) {
				if (doc.contentHash === contentHash) return doc;
			}
			return null;
		},

		async findRagDocumentBySourceFilename(
			workspace: string,
			knowledgeBase: string,
			sourceFilename: string,
		): Promise<RagDocumentRecord | null> {
			await assertKnowledgeBase(state, workspace, knowledgeBase);
			const map = state.ragDocuments.get(docKey(workspace, knowledgeBase));
			if (!map) return null;
			for (const doc of map.values()) {
				if (doc.sourceFilename === sourceFilename) return doc;
			}
			return null;
		},

		async createRagDocument(
			workspace: string,
			knowledgeBase: string,
			input: CreateRagDocumentInput,
		): Promise<RagDocumentRecord> {
			await assertKnowledgeBase(state, workspace, knowledgeBase);
			const key = docKey(workspace, knowledgeBase);
			const uid = input.uid ?? randomUUID();
			const bucket = state.ragDocuments.get(key) ?? new Map();
			if (bucket.has(uid)) {
				throw new ControlPlaneConflictError(
					`document with id '${uid}' already exists in knowledge base '${knowledgeBase}'`,
				);
			}
			const record: RagDocumentRecord = {
				workspaceId: workspace,
				knowledgeBaseId: knowledgeBase,
				documentId: uid,
				sourceDocId: input.sourceDocId ?? null,
				sourceFilename: input.sourceFilename ?? null,
				fileType: input.fileType ?? null,
				fileSize: input.fileSize ?? null,
				contentHash: input.contentHash ?? null,
				chunkTotal: input.chunkTotal ?? null,
				ingestedAt: input.ingestedAt ?? null,
				updatedAt: nowIso(),
				status: input.status ?? "pending",
				errorMessage: input.errorMessage ?? null,
				metadata: freezeMetadata(input.metadata),
			};
			bucket.set(uid, record);
			state.ragDocuments.set(key, bucket);
			return record;
		},

		async updateRagDocument(
			workspace: string,
			knowledgeBase: string,
			uid: string,
			patch: UpdateRagDocumentInput,
		): Promise<RagDocumentRecord> {
			await assertKnowledgeBase(state, workspace, knowledgeBase);
			const key = docKey(workspace, knowledgeBase);
			const existing = state.ragDocuments.get(key)?.get(uid);
			if (!existing) {
				throw new ControlPlaneNotFoundError("document", uid);
			}
			const next: RagDocumentRecord = {
				...existing,
				...(patch.sourceDocId !== undefined && {
					sourceDocId: patch.sourceDocId,
				}),
				...(patch.sourceFilename !== undefined && {
					sourceFilename: patch.sourceFilename,
				}),
				...(patch.fileType !== undefined && { fileType: patch.fileType }),
				...(patch.fileSize !== undefined && { fileSize: patch.fileSize }),
				...(patch.contentHash !== undefined && {
					contentHash: patch.contentHash,
				}),
				...(patch.chunkTotal !== undefined && { chunkTotal: patch.chunkTotal }),
				...(patch.ingestedAt !== undefined && { ingestedAt: patch.ingestedAt }),
				...(patch.status !== undefined && { status: patch.status }),
				...(patch.errorMessage !== undefined && {
					errorMessage: patch.errorMessage,
				}),
				...(patch.metadata !== undefined && {
					metadata: freezeMetadata(patch.metadata),
				}),
				updatedAt: nowIso(),
			};
			state.ragDocuments.get(key)?.set(uid, next);
			return next;
		},

		async deleteRagDocument(
			workspace: string,
			knowledgeBase: string,
			uid: string,
		): Promise<{ deleted: boolean }> {
			await assertKnowledgeBase(state, workspace, knowledgeBase);
			return {
				deleted:
					state.ragDocuments
						.get(docKey(workspace, knowledgeBase))
						?.delete(uid) ?? false,
			};
		},
	};
}
