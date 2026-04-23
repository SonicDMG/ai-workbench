/**
 * Data API Table DDL for the AI Workbench control-plane tables.
 *
 * Shapes match the canonical workbench CQL schema — snake_case
 * column names, composite primary keys where appropriate. The runtime
 * calls these at startup with `ifNotExists: true` so restarting
 * against an already-populated keyspace is safe.
 *
 * The record shape returned to the application (camelCase) is produced
 * by {@link ../astra-client/converters} — the Python runtime does the
 * same conversion on its side.
 */

import type { CreateTableDefinition } from "@datastax/astra-db-ts";

/** `wb_workspaces` — top-level tenants. */
export const WORKSPACES_TABLE = "wb_workspaces";
export const WORKSPACES_DEFINITION = {
	columns: {
		uid: "uuid",
		name: "text",
		url: "text",
		kind: "text",
		credentials_ref: { type: "map", keyType: "text", valueType: "text" },
		keyspace: "text",
		created_at: "timestamp",
		updated_at: "timestamp",
	},
	primaryKey: "uid",
} as const satisfies CreateTableDefinition;

/** `wb_catalog_by_workspace` — catalogs, partitioned by workspace. */
export const CATALOGS_TABLE = "wb_catalog_by_workspace";
export const CATALOGS_DEFINITION = {
	columns: {
		workspace: "uuid",
		uid: "uuid",
		name: "text",
		description: "text",
		vector_store: "uuid",
		created_at: "timestamp",
		updated_at: "timestamp",
	},
	primaryKey: {
		partitionBy: ["workspace"],
		partitionSort: { uid: 1 },
	},
} as const satisfies CreateTableDefinition;

/** `wb_vector_store_by_workspace` — the DEFINITION row for a vector
 * store. The actual vector data lives in a Data API Collection created
 * separately in Phase 1b. */
export const VECTOR_STORES_TABLE = "wb_vector_store_by_workspace";
export const VECTOR_STORES_DEFINITION = {
	columns: {
		workspace: "uuid",
		uid: "uuid",
		name: "text",
		vector_dimension: "int",
		vector_similarity: "text",
		embedding_provider: "text",
		embedding_model: "text",
		embedding_endpoint: "text",
		embedding_dimension: "int",
		embedding_secret_ref: "text",
		lexical_enabled: "boolean",
		lexical_analyzer: "text",
		lexical_options: { type: "map", keyType: "text", valueType: "text" },
		reranking_enabled: "boolean",
		reranking_provider: "text",
		reranking_model: "text",
		reranking_endpoint: "text",
		reranking_secret_ref: "text",
		created_at: "timestamp",
		updated_at: "timestamp",
	},
	primaryKey: {
		partitionBy: ["workspace"],
		partitionSort: { uid: 1 },
	},
} as const satisfies CreateTableDefinition;

/** `wb_documents_by_catalog` — documents, partitioned by (workspace, catalog). */
export const DOCUMENTS_TABLE = "wb_documents_by_catalog";
export const DOCUMENTS_DEFINITION = {
	columns: {
		workspace: "uuid",
		catalog_uid: "uuid",
		document_uid: "uuid",
		source_doc_id: "text",
		source_filename: "text",
		file_type: "text",
		file_size: "bigint",
		md5_hash: "text",
		chunk_total: "int",
		ingested_at: "timestamp",
		updated_at: "timestamp",
		status: "text",
		error_message: "text",
		metadata: { type: "map", keyType: "text", valueType: "text" },
	},
	primaryKey: {
		partitionBy: ["workspace", "catalog_uid"],
		partitionSort: { document_uid: 1 },
	},
} as const satisfies CreateTableDefinition;
