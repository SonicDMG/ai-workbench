/**
 * Row shapes for the Data API Tables.
 *
 * These are the literal JSON shapes on the wire (snake_case, flat for
 * nested configs like `embedding_*`). The runtime's application-facing
 * record types (camelCase, nested) live in
 * {@link ../control-plane/types}; {@link ./converters} moves between
 * them.
 */

import type {
	DocumentStatus,
	VectorSimilarity,
	WorkspaceKind,
} from "../control-plane/types.js";

/** ISO-8601 timestamp string. */
export type Iso = string;
/** UUID string (rendered lowercase with hyphens). */
export type Uuid = string;

export interface WorkspaceRow {
	uid: Uuid;
	name: string;
	endpoint: string | null;
	kind: WorkspaceKind;
	credentials_ref: Record<string, string>;
	keyspace: string | null;
	created_at: Iso;
	updated_at: Iso;
}

export interface CatalogRow {
	workspace: Uuid;
	uid: Uuid;
	name: string;
	description: string | null;
	vector_store: Uuid | null;
	created_at: Iso;
	updated_at: Iso;
}

export interface VectorStoreRow {
	workspace: Uuid;
	uid: Uuid;
	name: string;
	vector_dimension: number;
	vector_similarity: VectorSimilarity;
	embedding_provider: string;
	embedding_model: string;
	embedding_endpoint: string | null;
	embedding_dimension: number;
	embedding_secret_ref: string | null;
	lexical_enabled: boolean;
	lexical_analyzer: string | null;
	lexical_options: Record<string, string>;
	reranking_enabled: boolean;
	reranking_provider: string | null;
	reranking_model: string | null;
	reranking_endpoint: string | null;
	reranking_secret_ref: string | null;
	created_at: Iso;
	updated_at: Iso;
}

export interface ApiKeyRow {
	workspace: Uuid;
	key_id: Uuid;
	prefix: string;
	hash: string;
	label: string;
	created_at: Iso;
	last_used_at: Iso | null;
	revoked_at: Iso | null;
	expires_at: Iso | null;
}

export interface ApiKeyLookupRow {
	prefix: string;
	workspace: Uuid;
	key_id: Uuid;
}

export interface DocumentRow {
	workspace: Uuid;
	catalog_uid: Uuid;
	document_uid: Uuid;
	source_doc_id: string | null;
	source_filename: string | null;
	file_type: string | null;
	file_size: number | null;
	md5_hash: string | null;
	chunk_total: number | null;
	ingested_at: Iso | null;
	updated_at: Iso;
	status: DocumentStatus;
	error_message: string | null;
	metadata: Record<string, string>;
}
