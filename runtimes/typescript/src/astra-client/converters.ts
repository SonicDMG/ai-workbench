/**
 * Converters between application records (camelCase, nested) and Data
 * API Table rows (snake_case, flat for prefixed columns).
 *
 * Pure functions — no I/O, no randomness. All UUID/timestamp generation
 * happens in the backing store, not here.
 */

import type {
	ApiKeyRecord,
	CatalogRecord,
	DocumentRecord,
	SavedQueryRecord,
	VectorStoreRecord,
	WorkspaceRecord,
} from "../control-plane/types.js";
import type {
	ApiKeyRow,
	CatalogRow,
	DocumentRow,
	SavedQueryRow,
	VectorStoreRow,
	WorkspaceRow,
} from "./row-types.js";

/* ------------------------------------------------------------------ */
/* Workspace                                                          */
/* ------------------------------------------------------------------ */

export function workspaceToRow(r: WorkspaceRecord): WorkspaceRow {
	return {
		uid: r.uid,
		name: r.name,
		endpoint: r.endpoint,
		kind: r.kind,
		credentials_ref: { ...r.credentialsRef },
		keyspace: r.keyspace,
		created_at: r.createdAt,
		updated_at: r.updatedAt,
	};
}

export function workspaceFromRow(row: WorkspaceRow): WorkspaceRecord {
	return {
		uid: row.uid,
		name: row.name,
		endpoint: row.endpoint,
		kind: row.kind,
		credentialsRef: { ...(row.credentials_ref ?? {}) },
		keyspace: row.keyspace,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
	};
}

/* ------------------------------------------------------------------ */
/* Catalog                                                            */
/* ------------------------------------------------------------------ */

export function catalogToRow(r: CatalogRecord): CatalogRow {
	return {
		workspace: r.workspace,
		uid: r.uid,
		name: r.name,
		description: r.description,
		vector_store: r.vectorStore,
		created_at: r.createdAt,
		updated_at: r.updatedAt,
	};
}

export function catalogFromRow(row: CatalogRow): CatalogRecord {
	return {
		workspace: row.workspace,
		uid: row.uid,
		name: row.name,
		description: row.description,
		vectorStore: row.vector_store,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
	};
}

/* ------------------------------------------------------------------ */
/* Vector store                                                       */
/* ------------------------------------------------------------------ */

export function vectorStoreToRow(r: VectorStoreRecord): VectorStoreRow {
	return {
		workspace: r.workspace,
		uid: r.uid,
		name: r.name,
		vector_dimension: r.vectorDimension,
		vector_similarity: r.vectorSimilarity,
		embedding_provider: r.embedding.provider,
		embedding_model: r.embedding.model,
		embedding_endpoint: r.embedding.endpoint,
		embedding_dimension: r.embedding.dimension,
		embedding_secret_ref: r.embedding.secretRef,
		lexical_enabled: r.lexical.enabled,
		lexical_analyzer: r.lexical.analyzer,
		lexical_options: { ...r.lexical.options },
		reranking_enabled: r.reranking.enabled,
		reranking_provider: r.reranking.provider,
		reranking_model: r.reranking.model,
		reranking_endpoint: r.reranking.endpoint,
		reranking_secret_ref: r.reranking.secretRef,
		created_at: r.createdAt,
		updated_at: r.updatedAt,
	};
}

export function vectorStoreFromRow(row: VectorStoreRow): VectorStoreRecord {
	return {
		workspace: row.workspace,
		uid: row.uid,
		name: row.name,
		vectorDimension: row.vector_dimension,
		vectorSimilarity: row.vector_similarity,
		embedding: {
			provider: row.embedding_provider,
			model: row.embedding_model,
			endpoint: row.embedding_endpoint,
			dimension: row.embedding_dimension,
			secretRef: row.embedding_secret_ref,
		},
		lexical: {
			enabled: row.lexical_enabled,
			analyzer: row.lexical_analyzer,
			options: { ...(row.lexical_options ?? {}) },
		},
		reranking: {
			enabled: row.reranking_enabled,
			provider: row.reranking_provider,
			model: row.reranking_model,
			endpoint: row.reranking_endpoint,
			secretRef: row.reranking_secret_ref,
		},
		createdAt: row.created_at,
		updatedAt: row.updated_at,
	};
}

/* ------------------------------------------------------------------ */
/* Document                                                           */
/* ------------------------------------------------------------------ */

export function documentToRow(r: DocumentRecord): DocumentRow {
	return {
		workspace: r.workspace,
		catalog_uid: r.catalogUid,
		document_uid: r.documentUid,
		source_doc_id: r.sourceDocId,
		source_filename: r.sourceFilename,
		file_type: r.fileType,
		file_size: r.fileSize,
		md5_hash: r.md5Hash,
		chunk_total: r.chunkTotal,
		ingested_at: r.ingestedAt,
		updated_at: r.updatedAt,
		status: r.status,
		error_message: r.errorMessage,
		metadata: { ...r.metadata },
	};
}

export function documentFromRow(row: DocumentRow): DocumentRecord {
	return {
		workspace: row.workspace,
		catalogUid: row.catalog_uid,
		documentUid: row.document_uid,
		sourceDocId: row.source_doc_id,
		sourceFilename: row.source_filename,
		fileType: row.file_type,
		fileSize: row.file_size,
		md5Hash: row.md5_hash,
		chunkTotal: row.chunk_total,
		ingestedAt: row.ingested_at,
		updatedAt: row.updated_at,
		status: row.status,
		errorMessage: row.error_message,
		metadata: { ...(row.metadata ?? {}) },
	};
}

/* ------------------------------------------------------------------ */
/* Saved query                                                        */
/* ------------------------------------------------------------------ */

export function savedQueryToRow(r: SavedQueryRecord): SavedQueryRow {
	return {
		workspace: r.workspace,
		catalog_uid: r.catalogUid,
		query_uid: r.queryUid,
		name: r.name,
		description: r.description,
		text: r.text,
		top_k: r.topK,
		filter_json: r.filter ? JSON.stringify(r.filter) : null,
		created_at: r.createdAt,
		updated_at: r.updatedAt,
	};
}

export function savedQueryFromRow(row: SavedQueryRow): SavedQueryRecord {
	return {
		workspace: row.workspace,
		catalogUid: row.catalog_uid,
		queryUid: row.query_uid,
		name: row.name,
		description: row.description,
		text: row.text,
		topK: row.top_k,
		filter: row.filter_json
			? (JSON.parse(row.filter_json) as Record<string, unknown>)
			: null,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
	};
}

/* ------------------------------------------------------------------ */
/* API key                                                            */
/* ------------------------------------------------------------------ */

export function apiKeyToRow(r: ApiKeyRecord): ApiKeyRow {
	return {
		workspace: r.workspace,
		key_id: r.keyId,
		prefix: r.prefix,
		hash: r.hash,
		label: r.label,
		created_at: r.createdAt,
		last_used_at: r.lastUsedAt,
		revoked_at: r.revokedAt,
		expires_at: r.expiresAt,
	};
}

export function apiKeyFromRow(row: ApiKeyRow): ApiKeyRecord {
	return {
		workspace: row.workspace,
		keyId: row.key_id,
		prefix: row.prefix,
		hash: row.hash,
		label: row.label,
		createdAt: row.created_at,
		lastUsedAt: row.last_used_at,
		revokedAt: row.revoked_at,
		expiresAt: row.expires_at,
	};
}
