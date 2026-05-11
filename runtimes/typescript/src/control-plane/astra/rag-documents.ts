/**
 * RAG-document aggregate slice (KB-scoped) for the Astra-backed store.
 *
 * Owns three tables that move in lock-step:
 *   - `wb_rag_documents_by_knowledge_base` — the canonical record.
 *   - `wb_rag_documents_by_content_hash`   — hash-keyed secondary index
 *     for `findRagDocumentByContentHash`.
 *   - `wb_rag_documents_by_status`         — status-keyed secondary
 *     index, fanned out per `DocumentStatus` enum value.
 *
 * Every create/update/delete mirrors writes across all three tables so
 * the by-hash and by-status indexes stay consistent.
 */

import { randomUUID } from "node:crypto";
import {
	ragDocumentByHashToRow,
	ragDocumentByStatusToRow,
	ragDocumentFromRow,
	ragDocumentToRow,
} from "../../astra-client/converters.js";
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
import { type AstraStoreState, assertKnowledgeBase } from "./state.js";

async function writeRagStatusIndex(
	state: AstraStoreState,
	rec: RagDocumentRecord,
): Promise<void> {
	await state.tables.ragDocumentsByStatus.insertOne(
		ragDocumentByStatusToRow({
			workspaceId: rec.workspaceId,
			knowledgeBaseId: rec.knowledgeBaseId,
			status: rec.status,
			documentId: rec.documentId,
			sourceFilename: rec.sourceFilename,
			ingestedAt: rec.ingestedAt,
		}),
	);
}

export function makeRagDocumentMethods(
	state: AstraStoreState,
): RagDocumentRepo {
	return {
		async listRagDocuments(
			workspace: string,
			knowledgeBase: string,
		): Promise<readonly RagDocumentRecord[]> {
			await assertKnowledgeBase(state, workspace, knowledgeBase);
			const rows = await state.tables.ragDocuments
				.find({ workspace_id: workspace, knowledge_base_id: knowledgeBase })
				.toArray();
			return rows.map(ragDocumentFromRow);
		},

		async getRagDocument(
			workspace: string,
			knowledgeBase: string,
			uid: string,
		): Promise<RagDocumentRecord | null> {
			await assertKnowledgeBase(state, workspace, knowledgeBase);
			const row = await state.tables.ragDocuments.findOne({
				workspace_id: workspace,
				knowledge_base_id: knowledgeBase,
				document_id: uid,
			});
			return row ? ragDocumentFromRow(row) : null;
		},

		async findRagDocumentByContentHash(
			workspace: string,
			knowledgeBase: string,
			contentHash: string,
		): Promise<RagDocumentRecord | null> {
			await assertKnowledgeBase(state, workspace, knowledgeBase);
			// `wb_rag_documents_by_content_hash` is partitioned by hash and
			// clustered by `(workspace_id, knowledge_base_id, document_id)`,
			// so an exact-match lookup is a single partition read.
			const indexRow = await state.tables.ragDocumentsByHash.findOne({
				content_hash: contentHash,
				workspace_id: workspace,
				knowledge_base_id: knowledgeBase,
			});
			if (!indexRow) return null;
			// Fetch the canonical record from the by-KB table. The index
			// row only stores identifiers; the full document state (status,
			// timestamps, metadata) lives in `wb_rag_documents_by_knowledge_base`.
			const row = await state.tables.ragDocuments.findOne({
				workspace_id: workspace,
				knowledge_base_id: knowledgeBase,
				document_id: indexRow.document_id,
			});
			return row ? ragDocumentFromRow(row) : null;
		},

		async findRagDocumentBySourceFilename(
			workspace: string,
			knowledgeBase: string,
			sourceFilename: string,
		): Promise<RagDocumentRecord | null> {
			await assertKnowledgeBase(state, workspace, knowledgeBase);
			// No dedicated index on source_filename; scan the KB partition
			// and filter in-memory. Acceptable scope-wise — KBs are
			// typically small (hundreds to low thousands of docs) and the
			// only caller (ingest service's name-conflict pre-check) runs
			// at most once per upload. If this becomes a hot path we can
			// add a `wb_rag_documents_by_filename` index analogous to the
			// content-hash one, but that's out of scope for the
			// overwrite-prompt phase.
			const rows = await state.tables.ragDocuments
				.find({ workspace_id: workspace, knowledge_base_id: knowledgeBase })
				.toArray();
			const match = rows.find((r) => r.source_filename === sourceFilename);
			return match ? ragDocumentFromRow(match) : null;
		},

		async createRagDocument(
			workspace: string,
			knowledgeBase: string,
			input: CreateRagDocumentInput,
		): Promise<RagDocumentRecord> {
			await assertKnowledgeBase(state, workspace, knowledgeBase);
			const uid = input.uid ?? randomUUID();
			if (
				await state.tables.ragDocuments.findOne({
					workspace_id: workspace,
					knowledge_base_id: knowledgeBase,
					document_id: uid,
				})
			) {
				throw new ControlPlaneConflictError(
					`document with id '${uid}' already exists in knowledge base '${knowledgeBase}'`,
				);
			}
			const now = nowIso();
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
				updatedAt: now,
				status: input.status ?? "pending",
				errorMessage: input.errorMessage ?? null,
				metadata: { ...(input.metadata ?? {}) },
			};
			await state.tables.ragDocuments.insertOne(ragDocumentToRow(record));
			await writeRagStatusIndex(state, record);
			if (record.contentHash) {
				await state.tables.ragDocumentsByHash.insertOne(
					ragDocumentByHashToRow({
						contentHash: record.contentHash,
						workspaceId: record.workspaceId,
						knowledgeBaseId: record.knowledgeBaseId,
						documentId: record.documentId,
					}),
				);
			}
			return record;
		},

		async updateRagDocument(
			workspace: string,
			knowledgeBase: string,
			uid: string,
			patch: UpdateRagDocumentInput,
		): Promise<RagDocumentRecord> {
			await assertKnowledgeBase(state, workspace, knowledgeBase);
			const existing = await state.tables.ragDocuments.findOne({
				workspace_id: workspace,
				knowledge_base_id: knowledgeBase,
				document_id: uid,
			});
			if (!existing) throw new ControlPlaneNotFoundError("document", uid);
			const base = ragDocumentFromRow(existing);
			const next: RagDocumentRecord = {
				...base,
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
					metadata: { ...patch.metadata },
				}),
				updatedAt: nowIso(),
			};
			const nextRow = ragDocumentToRow(next);
			const {
				workspace_id: _w,
				knowledge_base_id: _k,
				document_id: _d,
				...fields
			} = nextRow;
			await state.tables.ragDocuments.updateOne(
				{
					workspace_id: workspace,
					knowledge_base_id: knowledgeBase,
					document_id: uid,
				},
				{ $set: fields },
			);
			// Status index — drop the old row when status changed, write the new.
			if (base.status !== next.status) {
				await state.tables.ragDocumentsByStatus.deleteOne({
					workspace_id: workspace,
					knowledge_base_id: knowledgeBase,
					status: base.status,
					document_id: uid,
				});
			}
			await writeRagStatusIndex(state, next);
			// Hash index updates only when content_hash changed.
			if (base.contentHash !== next.contentHash) {
				if (base.contentHash) {
					// `wb_rag_documents_by_content_hash` has the full
					// `(content_hash, workspace_id, knowledge_base_id, document_id)`
					// composite primary key — Astra Tables rejects deleteOne
					// without every PK column. The same physical content can
					// legitimately appear under multiple (workspace, KB, doc)
					// tuples; we only want to drop the row that corresponds to
					// this specific document.
					await state.tables.ragDocumentsByHash.deleteOne({
						content_hash: base.contentHash,
						workspace_id: workspace,
						knowledge_base_id: knowledgeBase,
						document_id: uid,
					});
				}
				if (next.contentHash) {
					await state.tables.ragDocumentsByHash.insertOne(
						ragDocumentByHashToRow({
							contentHash: next.contentHash,
							workspaceId: next.workspaceId,
							knowledgeBaseId: next.knowledgeBaseId,
							documentId: next.documentId,
						}),
					);
				}
			}
			return next;
		},

		async deleteRagDocument(
			workspace: string,
			knowledgeBase: string,
			uid: string,
		): Promise<{ deleted: boolean }> {
			await assertKnowledgeBase(state, workspace, knowledgeBase);
			const existing = await state.tables.ragDocuments.findOne({
				workspace_id: workspace,
				knowledge_base_id: knowledgeBase,
				document_id: uid,
			});
			if (!existing) return { deleted: false };
			const base = ragDocumentFromRow(existing);
			await Promise.all([
				state.tables.ragDocuments.deleteOne({
					workspace_id: workspace,
					knowledge_base_id: knowledgeBase,
					document_id: uid,
				}),
				state.tables.ragDocumentsByStatus.deleteOne({
					workspace_id: workspace,
					knowledge_base_id: knowledgeBase,
					status: base.status,
					document_id: uid,
				}),
				base.contentHash
					? state.tables.ragDocumentsByHash.deleteOne({
							content_hash: base.contentHash,
							workspace_id: workspace,
							knowledge_base_id: knowledgeBase,
							document_id: uid,
						})
					: Promise.resolve(),
			]);
			return { deleted: true };
		},
	};
}
