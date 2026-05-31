import type {
	RagDocumentHashEntry,
	RagDocumentRecord,
	RagDocumentStatusEntry,
} from "../../control-plane/types.js";
import type {
	RagDocumentByContentHashRow,
	RagDocumentByStatusRow,
	RagDocumentRow,
} from "../row-types.js";
import { asNumberOrNull, asPlainStringMap, asUuidString } from "./coerce.js";

export function ragDocumentToRow(r: RagDocumentRecord): RagDocumentRow {
	return {
		workspace_id: r.workspaceId,
		knowledge_base_id: r.knowledgeBaseId,
		document_id: r.documentId,
		source_doc_id: r.sourceDocId,
		source_filename: r.sourceFilename,
		file_type: r.fileType,
		file_size: r.fileSize,
		content_hash: r.contentHash,
		chunk_total: r.chunkTotal,
		status: r.status,
		error_message: r.errorMessage,
		ingested_at: r.ingestedAt,
		updated_at: r.updatedAt,
		metadata: { ...r.metadata },
		visible_to: r.visibleTo === null ? null : new Set(r.visibleTo),
		owner_principal_id: r.ownerPrincipalId,
	};
}

export function ragDocumentFromRow(row: RagDocumentRow): RagDocumentRecord {
	return {
		workspaceId: asUuidString(row.workspace_id),
		knowledgeBaseId: asUuidString(row.knowledge_base_id),
		documentId: asUuidString(row.document_id),
		sourceDocId: row.source_doc_id,
		sourceFilename: row.source_filename,
		fileType: row.file_type,
		fileSize: asNumberOrNull(row.file_size),
		contentHash: row.content_hash,
		chunkTotal: asNumberOrNull(row.chunk_total),
		status: row.status,
		errorMessage: row.error_message,
		ingestedAt: row.ingested_at,
		updatedAt: row.updated_at,
		metadata: asPlainStringMap(row.metadata),
		visibleTo: row.visible_to == null ? null : [...row.visible_to].sort(),
		ownerPrincipalId: row.owner_principal_id ?? null,
	};
}

export function ragDocumentByStatusToRow(
	r: RagDocumentStatusEntry,
): RagDocumentByStatusRow {
	return {
		workspace_id: r.workspaceId,
		knowledge_base_id: r.knowledgeBaseId,
		status: r.status,
		document_id: r.documentId,
		source_filename: r.sourceFilename,
		ingested_at: r.ingestedAt,
	};
}

export function ragDocumentByHashToRow(
	r: RagDocumentHashEntry,
): RagDocumentByContentHashRow {
	return {
		content_hash: r.contentHash,
		workspace_id: r.workspaceId,
		knowledge_base_id: r.knowledgeBaseId,
		document_id: r.documentId,
	};
}
