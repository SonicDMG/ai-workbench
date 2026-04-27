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
	AgentRole,
	AuthType,
	DistanceMetric,
	DocumentStatus,
	KnowledgeBaseLanguage,
	KnowledgeBaseStatus,
	ServiceStatus,
	WorkspaceKind,
} from "../control-plane/types.js";

/** ISO-8601 timestamp string. */
export type Iso = string;
/** UUID string (rendered lowercase with hyphens). */
export type Uuid = string;

export interface WorkspaceRow {
	uid: Uuid;
	name: string;
	url: string | null;
	kind: WorkspaceKind;
	keyspace: string | null;
	credentials: Record<string, string>;
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

/* ================================================================== */
/* Knowledge-Base schema row shapes (issue #98).                      */
/* ================================================================== */

/** Backward-compatible alias for older table-bundle imports. */
export type ConfigWorkspaceRow = WorkspaceRow;

export interface KnowledgeBaseRow {
	workspace_id: Uuid;
	knowledge_base_id: Uuid;
	name: string;
	description: string | null;
	status: KnowledgeBaseStatus;
	embedding_service_id: Uuid;
	chunking_service_id: Uuid;
	reranking_service_id: Uuid | null;
	language: KnowledgeBaseLanguage | null;
	vector_collection: string | null;
	lexical_enabled: boolean;
	lexical_analyzer: string | null;
	lexical_options: Record<string, string>;
	created_at: Iso;
	updated_at: Iso;
}

export interface KnowledgeFilterRow {
	workspace_id: Uuid;
	knowledge_base_id: Uuid;
	knowledge_filter_id: Uuid;
	name: string;
	description: string | null;
	filter_json: string;
	created_at: Iso;
	updated_at: Iso;
}

export interface ChunkingServiceRow {
	workspace_id: Uuid;
	chunking_service_id: Uuid;
	name: string;
	description: string | null;
	status: ServiceStatus;
	engine: string;
	engine_version: string | null;
	strategy: string | null;
	max_chunk_size: number | null;
	min_chunk_size: number | null;
	chunk_unit: string | null;
	overlap_size: number | null;
	overlap_unit: string | null;
	preserve_structure: boolean | null;
	language: string | null;
	endpoint_base_url: string | null;
	endpoint_path: string | null;
	request_timeout_ms: number | null;
	max_payload_size_kb: number | null;
	auth_type: AuthType;
	credential_ref: string | null;
	enable_ocr: boolean | null;
	extract_tables: boolean | null;
	extract_figures: boolean | null;
	reading_order: string | null;
	created_at: Iso;
	updated_at: Iso;
}

export interface EmbeddingServiceRow {
	workspace_id: Uuid;
	embedding_service_id: Uuid;
	name: string;
	description: string | null;
	status: ServiceStatus;
	provider: string;
	model_name: string;
	embedding_dimension: number;
	distance_metric: DistanceMetric;
	endpoint_base_url: string | null;
	endpoint_path: string | null;
	request_timeout_ms: number | null;
	max_batch_size: number | null;
	max_input_tokens: number | null;
	auth_type: AuthType;
	credential_ref: string | null;
	supported_languages: Set<string>;
	supported_content: Set<string>;
	created_at: Iso;
	updated_at: Iso;
}

export interface RerankingServiceRow {
	workspace_id: Uuid;
	reranking_service_id: Uuid;
	name: string;
	description: string | null;
	status: ServiceStatus;
	provider: string;
	engine: string | null;
	model_name: string;
	model_version: string | null;
	max_candidates: number | null;
	scoring_strategy: string | null;
	score_normalized: boolean | null;
	return_scores: boolean | null;
	endpoint_base_url: string | null;
	endpoint_path: string | null;
	request_timeout_ms: number | null;
	max_batch_size: number | null;
	auth_type: AuthType;
	credential_ref: string | null;
	supported_languages: Set<string>;
	supported_content: Set<string>;
	created_at: Iso;
	updated_at: Iso;
}

export interface LlmServiceRow {
	workspace_id: Uuid;
	llm_service_id: Uuid;
	name: string;
	description: string | null;
	status: ServiceStatus;
	provider: string;
	engine: string | null;
	model_name: string;
	model_version: string | null;
	context_window_tokens: number | null;
	max_output_tokens: number | null;
	temperature_min: number | null;
	temperature_max: number | null;
	supports_streaming: boolean | null;
	supports_tools: boolean | null;
	endpoint_base_url: string | null;
	endpoint_path: string | null;
	request_timeout_ms: number | null;
	max_batch_size: number | null;
	auth_type: AuthType;
	credential_ref: string | null;
	supported_languages: Set<string>;
	supported_content: Set<string>;
	created_at: Iso;
	updated_at: Iso;
}

export interface McpToolRow {
	workspace_id: Uuid;
	tool_id: Uuid;
	name: string;
	description: string | null;
	tool_type: string;
	endpoint_base_url: string | null;
	endpoint_path: string | null;
	http_method: string | null;
	/** Serialized JSON Schema describing tool inputs. */
	input_schema: string | null;
	/** Serialized JSON Schema describing tool outputs. */
	output_schema: string | null;
	auth_type: AuthType;
	credential_ref: string | null;
	tags: Set<string>;
	created_at: Iso;
	updated_at: Iso;
}

export interface RagDocumentRow {
	workspace_id: Uuid;
	knowledge_base_id: Uuid;
	document_id: Uuid;
	source_doc_id: string | null;
	source_filename: string | null;
	file_type: string | null;
	file_size: number | null;
	content_hash: string | null;
	chunk_total: number | null;
	status: DocumentStatus;
	error_message: string | null;
	ingested_at: Iso | null;
	updated_at: Iso;
	metadata: Record<string, string>;
}

export interface RagDocumentByStatusRow {
	workspace_id: Uuid;
	knowledge_base_id: Uuid;
	status: DocumentStatus;
	document_id: Uuid;
	source_filename: string | null;
	ingested_at: Iso | null;
}

export interface RagDocumentByContentHashRow {
	content_hash: string;
	workspace_id: Uuid;
	knowledge_base_id: Uuid;
	document_id: Uuid;
}

export interface AgentRow {
	workspace_id: Uuid;
	agent_id: Uuid;
	name: string;
	description: string | null;
	system_prompt: string | null;
	user_prompt: string | null;
	tool_ids: Set<Uuid>;
	rag_enabled: boolean;
	knowledge_base_ids: Set<Uuid>;
	rag_max_results: number | null;
	rag_min_score: number | null;
	rerank_enabled: boolean;
	reranking_service_id: Uuid | null;
	rerank_max_results: number | null;
	created_at: Iso;
	updated_at: Iso;
}

export interface ConversationRow {
	workspace_id: Uuid;
	agent_id: Uuid;
	conversation_id: Uuid;
	created_at: Iso;
	title: string | null;
}

export interface MessageRow {
	workspace_id: Uuid;
	conversation_id: Uuid;
	message_ts: Iso;
	message_id: Uuid;
	role: AgentRole;
	author_id: Uuid | null;
	content: string | null;
	tool_id: Uuid | null;
	/** Serialized JSON of the tool-call arguments for `role: "tool"` messages. */
	tool_call_payload: string | null;
	/** Serialized JSON of the tool's response. */
	tool_response: string | null;
	token_count: number | null;
	metadata: Record<string, string>;
}

/* ================================================================== */
/* End knowledge-base schema row shapes.                              */
/* ================================================================== */

export interface JobRow {
	workspace: Uuid;
	job_id: Uuid;
	kind: string;
	knowledge_base_uid: Uuid | null;
	document_uid: Uuid | null;
	status: string;
	processed: number;
	total: number | null;
	/** Serialized `Record<string, unknown>` on success. Same text-column
	 * pattern as `filter_json` on saved queries. */
	result_json: string | null;
	error_message: string | null;
	created_at: Iso;
	updated_at: Iso;
	/** Replica id holding the lease on a `running` job, or null when
	 * unclaimed. The orphan-sweeper treats stale leases as evidence
	 * the owning replica went away and re-claims them. */
	leased_by: string | null;
	leased_at: Iso | null;
	/** Serialized `IngestInputSnapshot` for `ingest` jobs created via
	 * the async path. The orphan-sweeper reads it back on reclaim to
	 * replay the pipeline. Same `text`-column pattern as
	 * `result_json`; converters parse/stringify on the boundary. */
	ingest_input_json: string | null;
}
