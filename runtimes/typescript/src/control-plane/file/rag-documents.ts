/**
 * RAG-document aggregate slice (KB-scoped) for the file-backed store.
 */

import { randomUUID } from "node:crypto";
import { nowIso } from "../defaults.js";
import {
	ControlPlaneConflictError,
	ControlPlaneNotFoundError,
} from "../errors.js";
import type {
	CreateRagDocumentInput,
	RagDocumentRepo,
	UpdateRagDocumentInput,
} from "../store.js";
import type { RagDocumentRecord } from "../types.js";
import { assertKnowledgeBase, type FileStoreState } from "./state.js";

export function makeRagDocumentMethods(state: FileStoreState): RagDocumentRepo {
	return {
		async listRagDocuments(
			workspace: string,
			knowledgeBase: string,
		): Promise<readonly RagDocumentRecord[]> {
			await assertKnowledgeBase(state, workspace, knowledgeBase);
			const all = await state.readAll("rag-documents");
			return all.filter(
				(d) =>
					d.workspaceId === workspace && d.knowledgeBaseId === knowledgeBase,
			);
		},

		async getRagDocument(
			workspace: string,
			knowledgeBase: string,
			uid: string,
		): Promise<RagDocumentRecord | null> {
			await assertKnowledgeBase(state, workspace, knowledgeBase);
			const all = await state.readAll("rag-documents");
			return (
				all.find(
					(d) =>
						d.workspaceId === workspace &&
						d.knowledgeBaseId === knowledgeBase &&
						d.documentId === uid,
				) ?? null
			);
		},

		async findRagDocumentByContentHash(
			workspace: string,
			knowledgeBase: string,
			contentHash: string,
		): Promise<RagDocumentRecord | null> {
			await assertKnowledgeBase(state, workspace, knowledgeBase);
			const all = await state.readAll("rag-documents");
			return (
				all.find(
					(d) =>
						d.workspaceId === workspace &&
						d.knowledgeBaseId === knowledgeBase &&
						d.contentHash === contentHash,
				) ?? null
			);
		},

		async findRagDocumentBySourceFilename(
			workspace: string,
			knowledgeBase: string,
			sourceFilename: string,
		): Promise<RagDocumentRecord | null> {
			await assertKnowledgeBase(state, workspace, knowledgeBase);
			const all = await state.readAll("rag-documents");
			return (
				all.find(
					(d) =>
						d.workspaceId === workspace &&
						d.knowledgeBaseId === knowledgeBase &&
						d.sourceFilename === sourceFilename,
				) ?? null
			);
		},

		async createRagDocument(
			workspace: string,
			knowledgeBase: string,
			input: CreateRagDocumentInput,
		): Promise<RagDocumentRecord> {
			await assertKnowledgeBase(state, workspace, knowledgeBase);
			return state.mutate("rag-documents", (rows) => {
				const uid = input.uid ?? randomUUID();
				if (
					rows.some(
						(d) =>
							d.workspaceId === workspace &&
							d.knowledgeBaseId === knowledgeBase &&
							d.documentId === uid,
					)
				) {
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
					metadata: { ...(input.metadata ?? {}) },
				};
				return { rows: [...rows, record], result: record };
			});
		},

		async updateRagDocument(
			workspace: string,
			knowledgeBase: string,
			uid: string,
			patch: UpdateRagDocumentInput,
		): Promise<RagDocumentRecord> {
			await assertKnowledgeBase(state, workspace, knowledgeBase);
			return state.mutate("rag-documents", (rows) => {
				const idx = rows.findIndex(
					(d) =>
						d.workspaceId === workspace &&
						d.knowledgeBaseId === knowledgeBase &&
						d.documentId === uid,
				);
				if (idx < 0) {
					throw new ControlPlaneNotFoundError("document", uid);
				}
				const existing = rows[idx] as RagDocumentRecord;
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
					...(patch.chunkTotal !== undefined && {
						chunkTotal: patch.chunkTotal,
					}),
					...(patch.ingestedAt !== undefined && {
						ingestedAt: patch.ingestedAt,
					}),
					...(patch.status !== undefined && { status: patch.status }),
					...(patch.errorMessage !== undefined && {
						errorMessage: patch.errorMessage,
					}),
					...(patch.metadata !== undefined && {
						metadata: { ...patch.metadata },
					}),
					updatedAt: nowIso(),
				};
				const nextRows = [...rows];
				nextRows[idx] = next;
				return { rows: nextRows, result: next };
			});
		},

		async deleteRagDocument(
			workspace: string,
			knowledgeBase: string,
			uid: string,
		): Promise<{ deleted: boolean }> {
			await assertKnowledgeBase(state, workspace, knowledgeBase);
			return state.mutate("rag-documents", (rows) => {
				const next = rows.filter(
					(d) =>
						!(
							d.workspaceId === workspace &&
							d.knowledgeBaseId === knowledgeBase &&
							d.documentId === uid
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
