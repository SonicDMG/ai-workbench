/**
 * Converters between application records (camelCase, nested) and Data
 * API Table rows (snake_case, flat for prefixed columns).
 *
 * Pure functions — no I/O, no randomness. All UUID/timestamp generation
 * happens in the backing store, not here.
 */

import type {
	AgentRecord,
	ApiKeyRecord,
	ChunkingServiceRecord,
	ConversationRecord,
	EmbeddingServiceRecord,
	KnowledgeBaseRecord,
	KnowledgeFilterRecord,
	LlmServiceRecord,
	McpToolRecord,
	MessageRecord,
	RagDocumentHashEntry,
	RagDocumentRecord,
	RagDocumentStatusEntry,
	RerankingServiceRecord,
	WorkspaceRecord,
} from "../control-plane/types.js";
import type {
	AgentRow,
	ApiKeyRow,
	ChunkingServiceRow,
	ConversationRow,
	EmbeddingServiceRow,
	KnowledgeBaseRow,
	KnowledgeFilterRow,
	LlmServiceRow,
	McpToolRow,
	MessageRow,
	RagDocumentByContentHashRow,
	RagDocumentByStatusRow,
	RagDocumentRow,
	RerankingServiceRow,
	WorkspaceRow,
} from "./row-types.js";

/* ------------------------------------------------------------------ */
/* Workspace                                                          */
/* ------------------------------------------------------------------ */

export function workspaceToRow(r: WorkspaceRecord): WorkspaceRow {
	return {
		uid: r.uid,
		name: r.name,
		url: r.url,
		kind: r.kind,
		namespace: r.namespace,
		credentials: { ...r.credentials },
		created_at: r.createdAt,
		updated_at: r.updatedAt,
	};
}

export function workspaceFromRow(row: WorkspaceRow): WorkspaceRecord {
	return {
		uid: row.uid,
		name: row.name,
		url: row.url,
		kind: row.kind,
		namespace: row.namespace,
		credentials: { ...(row.credentials ?? {}) },
		createdAt: row.created_at,
		updatedAt: row.updated_at,
	};
}

/* ------------------------------------------------------------------ */
/* Catalog                                                            */
/* ------------------------------------------------------------------ */

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

/* ================================================================== */
/*                                                                    */
/*  Knowledge-Base converters (issue #98) — additive in phase 1a.     */
/*                                                                    */
/*  Same shape as the legacy converters above: pure functions, no     */
/*  I/O, no clock or RNG. Set columns are normalised through `Set`    */
/*  copies; JSON columns parse/stringify at the boundary.             */
/*                                                                    */
/* ================================================================== */

/**
 * Astra row → record: SET<T> arrives as a `Set<T>`; the application
 * record exposes it as a sorted `readonly string[]` so JSON
 * serialization roundtrips cleanly across every backend.
 */
function setToSortedArray(
	value: Iterable<string> | null | undefined,
): string[] {
	return [...(value ?? [])].sort();
}

/** Record → Astra row: arrays go in as `Set<string>` so astra-db-ts
 * encodes them as the underlying `SET<TEXT>` / `SET<UUID>` column. */
function arrayToSet(value: readonly string[]): Set<string> {
	return new Set(value);
}

function parseJsonObject(raw: string | null): Record<string, unknown> | null {
	if (raw == null) return null;
	const parsed = JSON.parse(raw) as unknown;
	if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
		throw new Error("expected JSON object");
	}
	return parsed as Record<string, unknown>;
}

function stringifyJsonObject(value: Readonly<Record<string, unknown>>): string {
	return JSON.stringify(value);
}

/* --------------------------- workspace ---------------------------- */

export const configWorkspaceToRow = workspaceToRow;
export const configWorkspaceFromRow = workspaceFromRow;

/* ------------------------- knowledge base ------------------------- */

export function knowledgeBaseToRow(r: KnowledgeBaseRecord): KnowledgeBaseRow {
	return {
		workspace_id: r.workspaceId,
		knowledge_base_id: r.knowledgeBaseId,
		name: r.name,
		description: r.description,
		status: r.status,
		embedding_service_id: r.embeddingServiceId,
		chunking_service_id: r.chunkingServiceId,
		reranking_service_id: r.rerankingServiceId,
		language: r.language,
		vector_collection: r.vectorCollection,
		lexical_enabled: r.lexical.enabled,
		lexical_analyzer: r.lexical.analyzer,
		lexical_options: { ...r.lexical.options },
		created_at: r.createdAt,
		updated_at: r.updatedAt,
	};
}

export function knowledgeBaseFromRow(
	row: KnowledgeBaseRow,
): KnowledgeBaseRecord {
	return {
		workspaceId: row.workspace_id,
		knowledgeBaseId: row.knowledge_base_id,
		name: row.name,
		description: row.description,
		status: row.status,
		embeddingServiceId: row.embedding_service_id,
		chunkingServiceId: row.chunking_service_id,
		rerankingServiceId: row.reranking_service_id,
		language: row.language,
		vectorCollection: row.vector_collection,
		lexical: {
			enabled: row.lexical_enabled,
			analyzer: row.lexical_analyzer,
			options: { ...(row.lexical_options ?? {}) },
		},
		createdAt: row.created_at,
		updatedAt: row.updated_at,
	};
}

/* ------------------------ knowledge filter ------------------------ */

export function knowledgeFilterToRow(
	r: KnowledgeFilterRecord,
): KnowledgeFilterRow {
	return {
		workspace_id: r.workspaceId,
		knowledge_base_id: r.knowledgeBaseId,
		knowledge_filter_id: r.knowledgeFilterId,
		name: r.name,
		description: r.description,
		filter_json: stringifyJsonObject(r.filter),
		created_at: r.createdAt,
		updated_at: r.updatedAt,
	};
}

export function knowledgeFilterFromRow(
	row: KnowledgeFilterRow,
): KnowledgeFilterRecord {
	return {
		workspaceId: row.workspace_id,
		knowledgeBaseId: row.knowledge_base_id,
		knowledgeFilterId: row.knowledge_filter_id,
		name: row.name,
		description: row.description,
		filter: parseJsonObject(row.filter_json) ?? {},
		createdAt: row.created_at,
		updatedAt: row.updated_at,
	};
}

/* ----------------------- chunking service ------------------------- */

export function chunkingServiceToRow(
	r: ChunkingServiceRecord,
): ChunkingServiceRow {
	return {
		workspace_id: r.workspaceId,
		chunking_service_id: r.chunkingServiceId,
		name: r.name,
		description: r.description,
		status: r.status,
		engine: r.engine,
		engine_version: r.engineVersion,
		strategy: r.strategy,
		max_chunk_size: r.maxChunkSize,
		min_chunk_size: r.minChunkSize,
		chunk_unit: r.chunkUnit,
		overlap_size: r.overlapSize,
		overlap_unit: r.overlapUnit,
		preserve_structure: r.preserveStructure,
		language: r.language,
		endpoint_base_url: r.endpointBaseUrl,
		endpoint_path: r.endpointPath,
		request_timeout_ms: r.requestTimeoutMs,
		max_payload_size_kb: r.maxPayloadSizeKb,
		auth_type: r.authType,
		credential_ref: r.credentialRef,
		enable_ocr: r.enableOcr,
		extract_tables: r.extractTables,
		extract_figures: r.extractFigures,
		reading_order: r.readingOrder,
		created_at: r.createdAt,
		updated_at: r.updatedAt,
	};
}

export function chunkingServiceFromRow(
	row: ChunkingServiceRow,
): ChunkingServiceRecord {
	return {
		workspaceId: row.workspace_id,
		chunkingServiceId: row.chunking_service_id,
		name: row.name,
		description: row.description,
		status: row.status,
		engine: row.engine,
		engineVersion: row.engine_version,
		strategy: row.strategy,
		maxChunkSize: row.max_chunk_size,
		minChunkSize: row.min_chunk_size,
		chunkUnit: row.chunk_unit,
		overlapSize: row.overlap_size,
		overlapUnit: row.overlap_unit,
		preserveStructure: row.preserve_structure,
		language: row.language,
		endpointBaseUrl: row.endpoint_base_url,
		endpointPath: row.endpoint_path,
		requestTimeoutMs: row.request_timeout_ms,
		maxPayloadSizeKb: row.max_payload_size_kb,
		authType: row.auth_type,
		credentialRef: row.credential_ref,
		enableOcr: row.enable_ocr,
		extractTables: row.extract_tables,
		extractFigures: row.extract_figures,
		readingOrder: row.reading_order,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
	};
}

/* ----------------------- embedding service ------------------------ */

export function embeddingServiceToRow(
	r: EmbeddingServiceRecord,
): EmbeddingServiceRow {
	return {
		workspace_id: r.workspaceId,
		embedding_service_id: r.embeddingServiceId,
		name: r.name,
		description: r.description,
		status: r.status,
		provider: r.provider,
		model_name: r.modelName,
		embedding_dimension: r.embeddingDimension,
		distance_metric: r.distanceMetric,
		endpoint_base_url: r.endpointBaseUrl,
		endpoint_path: r.endpointPath,
		request_timeout_ms: r.requestTimeoutMs,
		max_batch_size: r.maxBatchSize,
		max_input_tokens: r.maxInputTokens,
		auth_type: r.authType,
		credential_ref: r.credentialRef,
		supported_languages: arrayToSet(r.supportedLanguages),
		supported_content: arrayToSet(r.supportedContent),
		created_at: r.createdAt,
		updated_at: r.updatedAt,
	};
}

export function embeddingServiceFromRow(
	row: EmbeddingServiceRow,
): EmbeddingServiceRecord {
	return {
		workspaceId: row.workspace_id,
		embeddingServiceId: row.embedding_service_id,
		name: row.name,
		description: row.description,
		status: row.status,
		provider: row.provider,
		modelName: row.model_name,
		embeddingDimension: row.embedding_dimension,
		distanceMetric: row.distance_metric,
		endpointBaseUrl: row.endpoint_base_url,
		endpointPath: row.endpoint_path,
		requestTimeoutMs: row.request_timeout_ms,
		maxBatchSize: row.max_batch_size,
		maxInputTokens: row.max_input_tokens,
		authType: row.auth_type,
		credentialRef: row.credential_ref,
		supportedLanguages: setToSortedArray(row.supported_languages),
		supportedContent: setToSortedArray(row.supported_content),
		createdAt: row.created_at,
		updatedAt: row.updated_at,
	};
}

/* ----------------------- reranking service ------------------------ */

export function rerankingServiceToRow(
	r: RerankingServiceRecord,
): RerankingServiceRow {
	return {
		workspace_id: r.workspaceId,
		reranking_service_id: r.rerankingServiceId,
		name: r.name,
		description: r.description,
		status: r.status,
		provider: r.provider,
		engine: r.engine,
		model_name: r.modelName,
		model_version: r.modelVersion,
		max_candidates: r.maxCandidates,
		scoring_strategy: r.scoringStrategy,
		score_normalized: r.scoreNormalized,
		return_scores: r.returnScores,
		endpoint_base_url: r.endpointBaseUrl,
		endpoint_path: r.endpointPath,
		request_timeout_ms: r.requestTimeoutMs,
		max_batch_size: r.maxBatchSize,
		auth_type: r.authType,
		credential_ref: r.credentialRef,
		supported_languages: arrayToSet(r.supportedLanguages),
		supported_content: arrayToSet(r.supportedContent),
		created_at: r.createdAt,
		updated_at: r.updatedAt,
	};
}

export function rerankingServiceFromRow(
	row: RerankingServiceRow,
): RerankingServiceRecord {
	return {
		workspaceId: row.workspace_id,
		rerankingServiceId: row.reranking_service_id,
		name: row.name,
		description: row.description,
		status: row.status,
		provider: row.provider,
		engine: row.engine,
		modelName: row.model_name,
		modelVersion: row.model_version,
		maxCandidates: row.max_candidates,
		scoringStrategy: row.scoring_strategy,
		scoreNormalized: row.score_normalized,
		returnScores: row.return_scores,
		endpointBaseUrl: row.endpoint_base_url,
		endpointPath: row.endpoint_path,
		requestTimeoutMs: row.request_timeout_ms,
		maxBatchSize: row.max_batch_size,
		authType: row.auth_type,
		credentialRef: row.credential_ref,
		supportedLanguages: setToSortedArray(row.supported_languages),
		supportedContent: setToSortedArray(row.supported_content),
		createdAt: row.created_at,
		updatedAt: row.updated_at,
	};
}

/* -------------------------- LLM service --------------------------- */

export function llmServiceToRow(r: LlmServiceRecord): LlmServiceRow {
	return {
		workspace_id: r.workspaceId,
		llm_service_id: r.llmServiceId,
		name: r.name,
		description: r.description,
		status: r.status,
		provider: r.provider,
		engine: r.engine,
		model_name: r.modelName,
		model_version: r.modelVersion,
		context_window_tokens: r.contextWindowTokens,
		max_output_tokens: r.maxOutputTokens,
		temperature_min: r.temperatureMin,
		temperature_max: r.temperatureMax,
		supports_streaming: r.supportsStreaming,
		supports_tools: r.supportsTools,
		endpoint_base_url: r.endpointBaseUrl,
		endpoint_path: r.endpointPath,
		request_timeout_ms: r.requestTimeoutMs,
		max_batch_size: r.maxBatchSize,
		auth_type: r.authType,
		credential_ref: r.credentialRef,
		supported_languages: arrayToSet(r.supportedLanguages),
		supported_content: arrayToSet(r.supportedContent),
		created_at: r.createdAt,
		updated_at: r.updatedAt,
	};
}

export function llmServiceFromRow(row: LlmServiceRow): LlmServiceRecord {
	return {
		workspaceId: row.workspace_id,
		llmServiceId: row.llm_service_id,
		name: row.name,
		description: row.description,
		status: row.status,
		provider: row.provider,
		engine: row.engine,
		modelName: row.model_name,
		modelVersion: row.model_version,
		contextWindowTokens: row.context_window_tokens,
		maxOutputTokens: row.max_output_tokens,
		temperatureMin: row.temperature_min,
		temperatureMax: row.temperature_max,
		supportsStreaming: row.supports_streaming,
		supportsTools: row.supports_tools,
		endpointBaseUrl: row.endpoint_base_url,
		endpointPath: row.endpoint_path,
		requestTimeoutMs: row.request_timeout_ms,
		maxBatchSize: row.max_batch_size,
		authType: row.auth_type,
		credentialRef: row.credential_ref,
		supportedLanguages: setToSortedArray(row.supported_languages),
		supportedContent: setToSortedArray(row.supported_content),
		createdAt: row.created_at,
		updatedAt: row.updated_at,
	};
}

/* --------------------------- MCP tool ----------------------------- */

export function mcpToolToRow(r: McpToolRecord): McpToolRow {
	return {
		workspace_id: r.workspaceId,
		tool_id: r.toolId,
		name: r.name,
		description: r.description,
		tool_type: r.toolType,
		endpoint_base_url: r.endpointBaseUrl,
		endpoint_path: r.endpointPath,
		http_method: r.httpMethod,
		input_schema: r.inputSchema ? JSON.stringify(r.inputSchema) : null,
		output_schema: r.outputSchema ? JSON.stringify(r.outputSchema) : null,
		auth_type: r.authType,
		credential_ref: r.credentialRef,
		tags: arrayToSet(r.tags),
		created_at: r.createdAt,
		updated_at: r.updatedAt,
	};
}

export function mcpToolFromRow(row: McpToolRow): McpToolRecord {
	return {
		workspaceId: row.workspace_id,
		toolId: row.tool_id,
		name: row.name,
		description: row.description,
		toolType: row.tool_type,
		endpointBaseUrl: row.endpoint_base_url,
		endpointPath: row.endpoint_path,
		httpMethod: row.http_method,
		inputSchema: parseJsonObject(row.input_schema),
		outputSchema: parseJsonObject(row.output_schema),
		authType: row.auth_type,
		credentialRef: row.credential_ref,
		tags: setToSortedArray(row.tags),
		createdAt: row.created_at,
		updatedAt: row.updated_at,
	};
}

/* ------------------------- RAG documents -------------------------- */

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
	};
}

export function ragDocumentFromRow(row: RagDocumentRow): RagDocumentRecord {
	return {
		workspaceId: row.workspace_id,
		knowledgeBaseId: row.knowledge_base_id,
		documentId: row.document_id,
		sourceDocId: row.source_doc_id,
		sourceFilename: row.source_filename,
		fileType: row.file_type,
		fileSize: row.file_size,
		contentHash: row.content_hash,
		chunkTotal: row.chunk_total,
		status: row.status,
		errorMessage: row.error_message,
		ingestedAt: row.ingested_at,
		updatedAt: row.updated_at,
		metadata: { ...(row.metadata ?? {}) },
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

export function ragDocumentByStatusFromRow(
	row: RagDocumentByStatusRow,
): RagDocumentStatusEntry {
	return {
		workspaceId: row.workspace_id,
		knowledgeBaseId: row.knowledge_base_id,
		status: row.status,
		documentId: row.document_id,
		sourceFilename: row.source_filename,
		ingestedAt: row.ingested_at,
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

export function ragDocumentByHashFromRow(
	row: RagDocumentByContentHashRow,
): RagDocumentHashEntry {
	return {
		contentHash: row.content_hash,
		workspaceId: row.workspace_id,
		knowledgeBaseId: row.knowledge_base_id,
		documentId: row.document_id,
	};
}

/* ----------------------------- agent ------------------------------ */

export function agentToRow(r: AgentRecord): AgentRow {
	return {
		workspace_id: r.workspaceId,
		agent_id: r.agentId,
		name: r.name,
		description: r.description,
		system_prompt: r.systemPrompt,
		user_prompt: r.userPrompt,
		tool_ids: arrayToSet(r.toolIds),
		rag_enabled: r.ragEnabled,
		knowledge_base_ids: arrayToSet(r.knowledgeBaseIds),
		rag_max_results: r.ragMaxResults,
		rag_min_score: r.ragMinScore,
		rerank_enabled: r.rerankEnabled,
		reranking_service_id: r.rerankingServiceId,
		rerank_max_results: r.rerankMaxResults,
		created_at: r.createdAt,
		updated_at: r.updatedAt,
	};
}

export function agentFromRow(row: AgentRow): AgentRecord {
	return {
		workspaceId: row.workspace_id,
		agentId: row.agent_id,
		name: row.name,
		description: row.description,
		systemPrompt: row.system_prompt,
		userPrompt: row.user_prompt,
		toolIds: setToSortedArray(row.tool_ids),
		ragEnabled: row.rag_enabled,
		knowledgeBaseIds: setToSortedArray(row.knowledge_base_ids),
		ragMaxResults: row.rag_max_results,
		ragMinScore: row.rag_min_score,
		rerankEnabled: row.rerank_enabled,
		rerankingServiceId: row.reranking_service_id,
		rerankMaxResults: row.rerank_max_results,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
	};
}

/* -------------------------- conversation -------------------------- */

export function conversationToRow(r: ConversationRecord): ConversationRow {
	return {
		workspace_id: r.workspaceId,
		agent_id: r.agentId,
		conversation_id: r.conversationId,
		created_at: r.createdAt,
		title: r.title,
	};
}

export function conversationFromRow(row: ConversationRow): ConversationRecord {
	return {
		workspaceId: row.workspace_id,
		agentId: row.agent_id,
		conversationId: row.conversation_id,
		createdAt: row.created_at,
		title: row.title,
	};
}

/* ---------------------------- message ----------------------------- */

export function messageToRow(r: MessageRecord): MessageRow {
	return {
		workspace_id: r.workspaceId,
		conversation_id: r.conversationId,
		message_ts: r.messageTs,
		message_id: r.messageId,
		role: r.role,
		author_id: r.authorId,
		content: r.content,
		tool_id: r.toolId,
		tool_call_payload: r.toolCallPayload
			? JSON.stringify(r.toolCallPayload)
			: null,
		tool_response: r.toolResponse ? JSON.stringify(r.toolResponse) : null,
		token_count: r.tokenCount,
		metadata: { ...r.metadata },
	};
}

export function messageFromRow(row: MessageRow): MessageRecord {
	return {
		workspaceId: row.workspace_id,
		conversationId: row.conversation_id,
		messageTs: row.message_ts,
		messageId: row.message_id,
		role: row.role,
		authorId: row.author_id,
		content: row.content,
		toolId: row.tool_id,
		toolCallPayload: parseJsonObject(row.tool_call_payload),
		toolResponse: parseJsonObject(row.tool_response),
		tokenCount: row.token_count,
		metadata: { ...(row.metadata ?? {}) },
	};
}

/* ================================================================== */
/* End knowledge-base converters.                                     */
/* ================================================================== */
