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

/** `wb_config_workspaces` — top-level tenants. */
export const WORKSPACES_TABLE = "wb_config_workspaces";
export const WORKSPACES_DEFINITION = {
	columns: {
		uid: "uuid",
		name: "text",
		url: "text",
		kind: "text",
		keyspace: "text",
		credentials: { type: "map", keyType: "text", valueType: "text" },
		created_at: "timestamp",
		updated_at: "timestamp",
	},
	primaryKey: "uid",
} as const satisfies CreateTableDefinition;

/**
 * `wb_api_key_by_workspace` — per-workspace list of API keys. The
 * stored `hash` is a scrypt digest; plaintext is never written. Walked
 * by the workspace's UI; also the source of truth for revocations.
 */
export const API_KEYS_TABLE = "wb_api_key_by_workspace";
export const API_KEYS_DEFINITION = {
	columns: {
		workspace: "uuid",
		key_id: "uuid",
		prefix: "text",
		hash: "text",
		label: "text",
		created_at: "timestamp",
		last_used_at: "timestamp",
		revoked_at: "timestamp",
		expires_at: "timestamp",
	},
	primaryKey: {
		partitionBy: ["workspace"],
		partitionSort: { key_id: 1 },
	},
} as const satisfies CreateTableDefinition;

/**
 * `wb_api_key_lookup` — secondary index keyed by wire prefix, pointing
 * at the owning `(workspace, key_id)`. Exists so the auth-middleware
 * can resolve a prefix in O(1) without scanning every workspace's
 * key list on every request. Kept in lockstep with `wb_api_key_by_workspace`.
 */
export const API_KEY_LOOKUP_TABLE = "wb_api_key_lookup";
export const API_KEY_LOOKUP_DEFINITION = {
	columns: {
		prefix: "text",
		workspace: "uuid",
		key_id: "uuid",
	},
	primaryKey: "prefix",
} as const satisfies CreateTableDefinition;

/* ================================================================== */
/*                                                                    */
/*  Knowledge-Base schema (issue #98).                                */
/*                                                                    */
/*  Three layers, mirroring the CQL the design proposes:              */
/*    • config — workspaces, knowledge bases, execution services      */
/*    • rag    — documents, indexed three ways                        */
/*    • agentic — agents, conversations, messages (workspaces hold   */
/*                user-defined agents; conversations partition by    */
/*                agent; messages partition by conversation)         */
/*                                                                    */
/*  All shapes use snake_case columns and partition keys that match   */
/*  the access pattern in the route name. Application records         */
/*  (camelCase, nested) and converters live next door.                */
/*                                                                    */
/* ================================================================== */

/* --------------------------- config layer ------------------------- */

/** Backward-compatible aliases for older imports. */
export const CONFIG_WORKSPACES_TABLE = WORKSPACES_TABLE;
export const CONFIG_WORKSPACES_DEFINITION = WORKSPACES_DEFINITION;

/**
 * `wb_config_knowledge_bases_by_workspace` — replaces
 * `wb_catalog_by_workspace`. References execution services by id;
 * `vector_collection` is the auto-provisioned Astra Data API
 * collection name (set by the runtime on KB create from the bound
 * embedding service's dimension + distance metric).
 *
 * Lexical config is folded onto the row because it's a property of
 * how the underlying collection is built, not a callable service.
 */
export const KNOWLEDGE_BASES_TABLE = "wb_config_knowledge_bases_by_workspace";
export const KNOWLEDGE_BASES_DEFINITION = {
	columns: {
		workspace_id: "uuid",
		knowledge_base_id: "uuid",
		name: "text",
		description: "text",
		status: "text", // active | draft | deprecated
		embedding_service_id: "uuid",
		chunking_service_id: "uuid",
		reranking_service_id: "uuid",
		language: "text", // en | fr | multi
		// runtime-managed: the auto-provisioned vector collection backing
		// this KB. Set on create, never edited by callers.
		vector_collection: "text",
		// lexical / BM25 — folded onto the KB row, see issue #98 thread.
		lexical_enabled: "boolean",
		lexical_analyzer: "text",
		lexical_options: { type: "map", keyType: "text", valueType: "text" },
		created_at: "timestamp",
		updated_at: "timestamp",
	},
	primaryKey: {
		partitionBy: ["workspace_id"],
		partitionSort: { knowledge_base_id: 1 },
	},
} as const satisfies CreateTableDefinition;

/** `wb_config_knowledge_filters_by_knowledge_base` — saved KB payload filters. */
export const KNOWLEDGE_FILTERS_TABLE =
	"wb_config_knowledge_filters_by_knowledge_base";
export const KNOWLEDGE_FILTERS_DEFINITION = {
	columns: {
		workspace_id: "uuid",
		knowledge_base_id: "uuid",
		knowledge_filter_id: "uuid",
		name: "text",
		description: "text",
		filter_json: "text",
		created_at: "timestamp",
		updated_at: "timestamp",
	},
	primaryKey: {
		partitionBy: ["workspace_id", "knowledge_base_id"],
		partitionSort: { knowledge_filter_id: 1 },
	},
} as const satisfies CreateTableDefinition;

/** `wb_config_chunking_service_by_workspace` — chunking executor config. */
export const CHUNKING_SERVICES_TABLE =
	"wb_config_chunking_service_by_workspace";
export const CHUNKING_SERVICES_DEFINITION = {
	columns: {
		workspace_id: "uuid",
		chunking_service_id: "uuid",
		name: "text",
		description: "text",
		status: "text", // active | deprecated | experimental
		engine: "text", // docling | langchain_ts
		engine_version: "text",
		strategy: "text", // layout | recursive | semantic | hybrid
		max_chunk_size: "int",
		min_chunk_size: "int",
		chunk_unit: "text", // tokens | characters
		overlap_size: "int",
		overlap_unit: "text",
		preserve_structure: "boolean",
		language: "text",
		endpoint_base_url: "text",
		endpoint_path: "text",
		request_timeout_ms: "int",
		max_payload_size_kb: "int",
		auth_type: "text", // none | api_key | oauth2 | mTLS
		credential_ref: "text",
		enable_ocr: "boolean",
		extract_tables: "boolean",
		extract_figures: "boolean",
		reading_order: "text",
		created_at: "timestamp",
		updated_at: "timestamp",
	},
	primaryKey: {
		partitionBy: ["workspace_id"],
		partitionSort: { chunking_service_id: 1 },
	},
} as const satisfies CreateTableDefinition;

/** `wb_config_embedding_service_by_workspace` — embedding executor config. */
export const EMBEDDING_SERVICES_TABLE =
	"wb_config_embedding_service_by_workspace";
export const EMBEDDING_SERVICES_DEFINITION = {
	columns: {
		workspace_id: "uuid",
		embedding_service_id: "uuid",
		name: "text",
		description: "text",
		status: "text",
		provider: "text", // openai | azure_openai | huggingface | custom
		model_name: "text",
		embedding_dimension: "int",
		distance_metric: "text", // cosine | dot | euclidean
		endpoint_base_url: "text",
		endpoint_path: "text",
		request_timeout_ms: "int",
		max_batch_size: "int",
		max_input_tokens: "int",
		auth_type: "text",
		credential_ref: "text",
		supported_languages: { type: "set", valueType: "text" },
		supported_content: { type: "set", valueType: "text" },
		created_at: "timestamp",
		updated_at: "timestamp",
	},
	primaryKey: {
		partitionBy: ["workspace_id"],
		partitionSort: { embedding_service_id: 1 },
	},
} as const satisfies CreateTableDefinition;

/** `wb_config_reranking_service_by_workspace` — reranker executor config. */
export const RERANKING_SERVICES_TABLE =
	"wb_config_reranking_service_by_workspace";
export const RERANKING_SERVICES_DEFINITION = {
	columns: {
		workspace_id: "uuid",
		reranking_service_id: "uuid",
		name: "text",
		description: "text",
		status: "text",
		provider: "text", // cohere | openai | huggingface | custom
		engine: "text", // cross_encoder | llm | api
		model_name: "text",
		model_version: "text",
		max_candidates: "int",
		scoring_strategy: "text",
		score_normalized: "boolean",
		return_scores: "boolean",
		endpoint_base_url: "text",
		endpoint_path: "text",
		request_timeout_ms: "int",
		max_batch_size: "int",
		auth_type: "text",
		credential_ref: "text",
		supported_languages: { type: "set", valueType: "text" },
		supported_content: { type: "set", valueType: "text" },
		created_at: "timestamp",
		updated_at: "timestamp",
	},
	primaryKey: {
		partitionBy: ["workspace_id"],
		partitionSort: { reranking_service_id: 1 },
	},
} as const satisfies CreateTableDefinition;

/** `wb_config_llm_service_by_workspace` — LLM executor config (Stage 2). */
export const LLM_SERVICES_TABLE = "wb_config_llm_service_by_workspace";
export const LLM_SERVICES_DEFINITION = {
	columns: {
		workspace_id: "uuid",
		llm_service_id: "uuid",
		name: "text",
		description: "text",
		status: "text",
		provider: "text", // openai | azure_openai | anthropic | huggingface | custom
		engine: "text", // langchain_ts | direct_rest | sdk
		model_name: "text",
		model_version: "text",
		context_window_tokens: "int",
		max_output_tokens: "int",
		temperature_min: "double",
		temperature_max: "double",
		supports_streaming: "boolean",
		supports_tools: "boolean",
		endpoint_base_url: "text",
		endpoint_path: "text",
		request_timeout_ms: "int",
		max_batch_size: "int",
		auth_type: "text",
		credential_ref: "text",
		supported_languages: { type: "set", valueType: "text" },
		supported_content: { type: "set", valueType: "text" },
		created_at: "timestamp",
		updated_at: "timestamp",
	},
	primaryKey: {
		partitionBy: ["workspace_id"],
		partitionSort: { llm_service_id: 1 },
	},
} as const satisfies CreateTableDefinition;

/** `wb_config_mcp_tools_by_workspace` — tool registry (Stage 2). */
export const MCP_TOOLS_TABLE = "wb_config_mcp_tools_by_workspace";
export const MCP_TOOLS_DEFINITION = {
	columns: {
		workspace_id: "uuid",
		tool_id: "uuid",
		name: "text",
		description: "text",
		tool_type: "text", // mcp | http | function | builtin
		endpoint_base_url: "text",
		endpoint_path: "text",
		http_method: "text", // GET | POST
		input_schema: "text", // JSON schema, serialized
		output_schema: "text",
		auth_type: "text",
		credential_ref: "text",
		tags: { type: "set", valueType: "text" },
		created_at: "timestamp",
		updated_at: "timestamp",
	},
	primaryKey: {
		partitionBy: ["workspace_id"],
		partitionSort: { tool_id: 1 },
	},
} as const satisfies CreateTableDefinition;

/* ----------------------------- rag layer -------------------------- */

/** `wb_rag_documents_by_knowledge_base` — primary docs view, by KB. */
export const RAG_DOCUMENTS_TABLE = "wb_rag_documents_by_knowledge_base";
export const RAG_DOCUMENTS_DEFINITION = {
	columns: {
		workspace_id: "uuid",
		knowledge_base_id: "uuid",
		document_id: "uuid",
		source_doc_id: "text",
		source_filename: "text",
		file_type: "text",
		file_size: "bigint",
		content_hash: "text",
		chunk_total: "int",
		status: "text",
		error_message: "text",
		ingested_at: "timestamp",
		updated_at: "timestamp",
		metadata: { type: "map", keyType: "text", valueType: "text" },
	},
	primaryKey: {
		partitionBy: ["workspace_id", "knowledge_base_id"],
		partitionSort: { document_id: 1 },
	},
} as const satisfies CreateTableDefinition;

/**
 * `wb_rag_documents_by_knowledge_base_and_status` — secondary index for
 * "all docs in KB with status X" (e.g. dashboard pending/failed lists).
 * Maintained in lockstep with `wb_rag_documents_by_knowledge_base`.
 */
export const RAG_DOCUMENTS_BY_STATUS_TABLE =
	"wb_rag_documents_by_knowledge_base_and_status";
export const RAG_DOCUMENTS_BY_STATUS_DEFINITION = {
	columns: {
		workspace_id: "uuid",
		knowledge_base_id: "uuid",
		status: "text",
		document_id: "uuid",
		source_filename: "text",
		ingested_at: "timestamp",
	},
	primaryKey: {
		partitionBy: ["workspace_id", "knowledge_base_id", "status"],
		partitionSort: { document_id: 1 },
	},
} as const satisfies CreateTableDefinition;

/**
 * `wb_rag_documents_by_content_hash` — dedup index. Lets ingest check
 * "have I already seen this content?" without scanning per-KB rows.
 * One physical document may appear across multiple KBs, so the row is
 * partitioned by hash and clustered by `(workspace_id, knowledge_base_id, document_id)`.
 */
export const RAG_DOCUMENTS_BY_HASH_TABLE = "wb_rag_documents_by_content_hash";
export const RAG_DOCUMENTS_BY_HASH_DEFINITION = {
	columns: {
		content_hash: "text",
		workspace_id: "uuid",
		knowledge_base_id: "uuid",
		document_id: "uuid",
	},
	primaryKey: {
		partitionBy: ["content_hash"],
		partitionSort: {
			workspace_id: 1,
			knowledge_base_id: 1,
			document_id: 1,
		},
	},
} as const satisfies CreateTableDefinition;

/* --------------------------- agentic layer ------------------------ */

/**
 * `wb_agentic_agents_by_workspace` — agent definitions.
 *
 * Holds user-defined agents, partitioned by workspace. Each agent
 * has a random UUID; deletion cascades to its conversations and
 * messages.
 */
export const AGENTS_TABLE = "wb_agentic_agents_by_workspace";
export const AGENTS_DEFINITION = {
	columns: {
		workspace_id: "uuid",
		agent_id: "uuid",
		name: "text",
		description: "text",
		system_prompt: "text",
		user_prompt: "text",
		tool_ids: { type: "set", valueType: "uuid" },
		llm_service_id: "uuid",
		rag_enabled: "boolean",
		knowledge_base_ids: { type: "set", valueType: "uuid" },
		rag_max_results: "int",
		rag_min_score: "double",
		rerank_enabled: "boolean",
		reranking_service_id: "uuid",
		rerank_max_results: "int",
		created_at: "timestamp",
		updated_at: "timestamp",
	},
	primaryKey: {
		partitionBy: ["workspace_id"],
		partitionSort: { agent_id: 1 },
	},
} as const satisfies CreateTableDefinition;

/**
 * `wb_agentic_conversations_by_agent` — conversation list per agent.
 * Clustered by `created_at DESC` so list endpoints get newest-first
 * for free. `conversation_id` is part of the cluster key so two
 * conversations with identical timestamps don't collide.
 *
 * `knowledge_base_ids` is the per-conversation RAG-grounding set.
 * Empty / null = the agent draws from all KBs in the workspace;
 * populated = restricted to those KBs.
 * Stored on the conversation rather than the agent so a single
 * agent can host multiple conversations with different KB scopes.
 * Additive column — `CREATE TABLE IF NOT EXISTS` is idempotent on
 * the column set; existing tables get this column added on next
 * boot (same pattern as the JOBS_TABLE lease columns above).
 */
export const CONVERSATIONS_TABLE = "wb_agentic_conversations_by_agent";
export const CONVERSATIONS_DEFINITION = {
	columns: {
		workspace_id: "uuid",
		agent_id: "uuid",
		conversation_id: "uuid",
		created_at: "timestamp",
		title: "text",
		knowledge_base_ids: { type: "set", valueType: "uuid" },
	},
	primaryKey: {
		partitionBy: ["workspace_id", "agent_id"],
		partitionSort: { created_at: -1, conversation_id: 1 },
	},
} as const satisfies CreateTableDefinition;

/**
 * `wb_agentic_messages_by_conversation` — message log per conversation.
 * Clustered ASC by timestamp so replay/streaming reads in chronological
 * order; UI flips to display order client-side. `message_id` is a
 * non-key column for client-side dedup.
 */
export const MESSAGES_TABLE = "wb_agentic_messages_by_conversation";
export const MESSAGES_DEFINITION = {
	columns: {
		workspace_id: "uuid",
		conversation_id: "uuid",
		message_ts: "timestamp",
		message_id: "uuid",
		role: "text", // user | agent | tool | system
		author_id: "uuid",
		content: "text",
		tool_id: "uuid",
		tool_call_payload: "text",
		tool_response: "text",
		token_count: "int",
		metadata: { type: "map", keyType: "text", valueType: "text" },
	},
	primaryKey: {
		partitionBy: ["workspace_id", "conversation_id"],
		partitionSort: { message_ts: 1 },
	},
} as const satisfies CreateTableDefinition;

/* ================================================================== */
/* End knowledge-base schema (issue #98).                             */
/* ================================================================== */

/**
 * `wb_jobs_by_workspace` — background-operation records for async
 * routes (today: ingest). Partitioned by workspace so every job
 * lookup hits one partition; sorted by `job_id` so list endpoints
 * (when they land) stay bounded.
 *
 * `result_json` holds a JSON-encoded summary on success — same
 * text-column pattern as `filter_json` on saved queries.
 */
export const JOBS_TABLE = "wb_jobs_by_workspace";
export const JOBS_DEFINITION = {
	columns: {
		workspace: "uuid",
		job_id: "uuid",
		kind: "text",
		knowledge_base_id: "uuid",
		document_id: "uuid",
		status: "text",
		processed: "int",
		total: "int",
		result_json: "text",
		error_message: "text",
		created_at: "timestamp",
		updated_at: "timestamp",
		// Cross-replica lease (Phase 2b). `leased_by` is the replica
		// id currently driving a running job; `leased_at` is the
		// last heartbeat. Both null when the job is unclaimed
		// (just-created, terminal, or freshly released). Existing
		// tables created before this column landed get the columns
		// added on next `openAstraClient` boot — Astra's
		// CREATE TABLE IF NOT EXISTS is idempotent on the column set,
		// missing columns get added.
		leased_by: "text",
		leased_at: "timestamp",
		// Snapshot of the original `IngestInput` (text + metadata +
		// chunker opts) for `ingest` jobs created via the async path.
		// The orphan sweeper reads it back on reclaim and replays the
		// pipeline instead of marking the job failed. `text` so
		// arbitrary JSON survives — same pattern as `result_json`.
		ingest_input_json: "text",
	},
	primaryKey: {
		partitionBy: ["workspace"],
		partitionSort: { job_id: 1 },
	},
} as const satisfies CreateTableDefinition;
