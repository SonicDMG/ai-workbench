/**
 * Converters between application records (camelCase, nested) and Data
 * API Table rows (snake_case, flat for prefixed columns).
 *
 * Pure functions — no I/O, no randomness. All UUID/timestamp generation
 * happens in the backing store, not here.
 */

import {
	type AgentRecord,
	type ApiKeyRecord,
	type ChunkingServiceRecord,
	type ConversationRecord,
	type EmbeddingServiceRecord,
	type KnowledgeBaseRecord,
	type KnowledgeFilterRecord,
	type LlmServiceRecord,
	type McpServerRecord,
	type MessageRecord,
	normalizeApiKeyScopes,
	type PolicyAction,
	type PolicyAuditRecord,
	type PolicyDecision,
	type PrincipalRecord,
	parseRole,
	type RagDocumentHashEntry,
	type RagDocumentRecord,
	type RagDocumentStatusEntry,
	type RerankingServiceRecord,
	type WorkspaceRecord,
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
	McpServerRow,
	MessageRow,
	PolicyAuditRow,
	PrincipalRow,
	RagDocumentByContentHashRow,
	RagDocumentByStatusRow,
	RagDocumentRow,
	RerankingServiceRow,
	WorkspaceRow,
} from "./row-types.js";

/* ------------------------------------------------------------------ */
/* Coercion helpers                                                   */
/* ------------------------------------------------------------------ */
/*
 * The default Tables serdes in `@datastax/astra-db-ts` v2.x returns
 * column values typed as the underlying datatype's runtime class:
 *   - `uuid` columns come back as `UUID` instances (`{ version, _raw }`)
 *   - `map<text, text>` columns come back as `Map<string, string>`
 * Our row types declare these as `string` and `Record<string, string>`
 * respectively, so reading rows verbatim into the application records
 * surfaces the wrong shape downstream:
 *   - `JSON.stringify(record.uid)` produces `{"version":4,"_raw":"…"}`
 *     instead of the canonical UUID string.
 *   - `{ ...record.credentials }` spreads a `Map` into an empty object
 *     (Maps have no enumerable own string-keyed properties), silently
 *     dropping all credentials — which makes the workspace's
 *     test-connection fail with "missing credentials.token" even
 *     though the row was stored correctly.
 *
 * Rather than register custom Astra serdes codecs (which would change
 * library behavior globally and surprise future readers), the
 * converters coerce on the way out. `*ToRow` writes the
 * application-shape value directly — astra-db-ts accepts both `string`
 * (becomes a `uuid`) and `Record<string, string>` (becomes a `map`)
 * for write, so the write path doesn't need this workaround.
 */

export function asUuidString(v: unknown): string {
	if (typeof v === "string") return v;
	if (v && typeof v === "object") {
		const raw = (v as { _raw?: unknown })._raw;
		if (typeof raw === "string") return raw;
		// `UUID.toString()` returns the canonical lowercase form.
		const candidate = (v as { toString?: () => string }).toString?.();
		if (typeof candidate === "string" && /^[0-9a-f-]{36}$/i.test(candidate)) {
			return candidate;
		}
	}
	return String(v ?? "");
}

export function asNullableUuidString(v: unknown): string | null {
	if (v === null || v === undefined) return null;
	return asUuidString(v);
}

export function asPlainStringMap(v: unknown): Record<string, string> {
	if (v instanceof Map) {
		const out: Record<string, string> = {};
		for (const [k, val] of v as Map<unknown, unknown>) {
			if (typeof k === "string" && typeof val === "string") out[k] = val;
		}
		return out;
	}
	if (v && typeof v === "object") {
		return { ...(v as Record<string, string>) };
	}
	return {};
}

/**
 * Coerce a numeric column value back to a plain `number`. The Tables
 * serdes in `@datastax/astra-db-ts` v2.x decodes `int` and `bigint`
 * columns as JS `BigInt` (so values larger than `Number.MAX_SAFE_INTEGER`
 * survive the round-trip), but our row-type interfaces declare these
 * as `number`. Without coercion, anything that flows through
 * `JSON.stringify(record)` — every API response — throws
 * `TypeError: Do not know how to serialize a BigInt`. The values we
 * actually store (file sizes up to ~5MB, chunk counts in the
 * thousands, request timeouts in ms, token counts) all fit in
 * `Number.MAX_SAFE_INTEGER`, so the precision loss is benign.
 *
 * `double` columns also come back as plain `number` and pass through
 * untouched.
 */
export function asNumber(v: unknown): number {
	if (typeof v === "number") return v;
	if (typeof v === "bigint") return Number(v);
	if (typeof v === "string") return Number.parseFloat(v);
	return Number(v);
}

export function asNumberOrNull(v: unknown): number | null {
	if (v === null || v === undefined) return null;
	return asNumber(v);
}

/**
 * Coerce a Data API timestamp column value back to an ISO-8601 string.
 *
 * astra-db-ts decodes `timestamp` columns as JS `Date` instances —
 * fine for most callsites because JSON serialization runs
 * `Date.toJSON()` and produces the same wire format the application
 * expects. But anything that touches the value before serialization
 * (sorting, comparing, computing day partitions) sees the underlying
 * class and breaks: `Date.localeCompare` is not a function, `Date <
 * Date` only works through `valueOf` coercion, etc. Coerce on the way
 * out so every `Iso`-typed field in the record is genuinely a string.
 */
export function asIsoString(v: unknown): string {
	if (typeof v === "string") return v;
	if (v instanceof Date) return v.toISOString();
	if (v && typeof v === "object") {
		const fn = (v as { toISOString?: () => string }).toISOString;
		if (typeof fn === "function") return fn.call(v);
	}
	return String(v ?? "");
}

export function asIsoStringOrNull(v: unknown): string | null {
	if (v === null || v === undefined) return null;
	return asIsoString(v);
}

/* ------------------------------------------------------------------ */
/* Workspace                                                          */
/* ------------------------------------------------------------------ */

export function workspaceToRow(r: WorkspaceRecord): WorkspaceRow {
	return {
		uid: r.uid,
		name: r.name,
		url: r.url,
		kind: r.kind,
		keyspace: r.keyspace,
		credentials: { ...r.credentials },
		rlac_enabled: r.rlacEnabled,
		created_at: r.createdAt,
		updated_at: r.updatedAt,
	};
}

export function workspaceFromRow(row: WorkspaceRow): WorkspaceRecord {
	// Defensive `?? null` on url/keyspace so rows written before those
	// columns existed (or rows where the Astra driver decodes a missing
	// column as undefined rather than null) come back through this
	// converter as the typed `string | null` shape — matches the
	// memory/file stores and keeps the WorkspaceRecord wire format
	// honest. Without this, a missing field reaches the JSON
	// serializer as `undefined` and gets stripped, which fails the
	// UI's schema validation downstream.
	//
	// `asUuidString` + `asPlainStringMap` coerce the runtime-class
	// shapes (UUID + Map) the Tables serdes hands us back, see the
	// "Coercion helpers" header above for the full rationale.
	return {
		uid: asUuidString(row.uid),
		name: row.name,
		url: row.url ?? null,
		kind: row.kind,
		keyspace: row.keyspace ?? null,
		credentials: asPlainStringMap(row.credentials),
		// Legacy rows (written before the column existed) decode as
		// `false` — the safest default for a feature gate.
		rlacEnabled: row.rlac_enabled ?? false,
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
		// Cassandra `set<text>` accepts a plain array on insert.
		scopes: [...r.scopes],
		created_at: r.createdAt,
		last_used_at: r.lastUsedAt,
		revoked_at: r.revokedAt,
		expires_at: r.expiresAt,
	};
}

export function apiKeyFromRow(row: ApiKeyRow): ApiKeyRecord {
	return {
		workspace: asUuidString(row.workspace),
		keyId: asUuidString(row.key_id),
		prefix: row.prefix,
		hash: row.hash,
		label: row.label,
		// `set<text>` round-trips as a JS Set; older rows that predate
		// the column return null. The store-level normalizer downstream
		// would also default this, but we resolve it here so the
		// `ApiKeyRecord` shape is always concrete from the store
		// boundary down.
		scopes: normalizeApiKeyScopes(scopesFromColumn(row.scopes)),
		createdAt: row.created_at,
		lastUsedAt: row.last_used_at,
		revokedAt: row.revoked_at,
		expiresAt: row.expires_at,
	};
}

/**
 * Coerce a Data-API `set<text>` value into a plain array. The SDK
 * returns a `Set<string>` when the column is present; older rows
 * (predating the additive `scopes` column) hand back `null` or
 * `undefined`.
 */
function scopesFromColumn(
	value: ApiKeyRow["scopes"],
): readonly string[] | null {
	if (value == null) return null;
	if (value instanceof Set) return [...value];
	return value as readonly string[];
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
 * serialization roundtrips cleanly across every backend. Elements are
 * coerced through {@link asUuidString} on the way out so SET<UUID>
 * columns (which the Tables serdes hands back as UUID instances) end
 * up as canonical UUID strings — the rest of the codebase assumes
 * `string` for `toolIds`, `knowledgeBaseIds`, etc.
 */
function setToSortedArray(
	value: Iterable<unknown> | null | undefined,
): string[] {
	const out: string[] = [];
	for (const v of value ?? []) {
		out.push(typeof v === "string" ? v : asUuidString(v));
	}
	return out.sort();
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
		owned: r.owned,
		lexical_enabled: r.lexical.enabled,
		lexical_analyzer: r.lexical.analyzer,
		lexical_options: { ...r.lexical.options },
		policy_dsl: r.policyDsl,
		policy_enabled: r.policyEnabled,
		created_at: r.createdAt,
		updated_at: r.updatedAt,
	};
}

export function knowledgeBaseFromRow(
	row: KnowledgeBaseRow,
): KnowledgeBaseRecord {
	return {
		workspaceId: asUuidString(row.workspace_id),
		knowledgeBaseId: asUuidString(row.knowledge_base_id),
		name: row.name,
		description: row.description,
		status: row.status,
		embeddingServiceId: asUuidString(row.embedding_service_id),
		chunkingServiceId: asUuidString(row.chunking_service_id),
		rerankingServiceId: asNullableUuidString(row.reranking_service_id),
		language: row.language,
		vectorCollection: row.vector_collection,
		// Pre-`owned`-column rows are coerced to `true` so their
		// collection lifecycle stays under runtime control, matching
		// the original behavior at the time those rows were written.
		owned: row.owned ?? true,
		lexical: {
			enabled: row.lexical_enabled ?? false,
			analyzer: row.lexical_analyzer ?? null,
			options: asPlainStringMap(row.lexical_options),
		},
		policyDsl: row.policy_dsl ?? null,
		policyEnabled: row.policy_enabled ?? false,
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
		workspaceId: asUuidString(row.workspace_id),
		knowledgeBaseId: asUuidString(row.knowledge_base_id),
		knowledgeFilterId: asUuidString(row.knowledge_filter_id),
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
		workspaceId: asUuidString(row.workspace_id),
		chunkingServiceId: asUuidString(row.chunking_service_id),
		name: row.name,
		description: row.description,
		status: row.status,
		engine: row.engine,
		engineVersion: row.engine_version,
		strategy: row.strategy,
		maxChunkSize: asNumberOrNull(row.max_chunk_size),
		minChunkSize: asNumberOrNull(row.min_chunk_size),
		chunkUnit: row.chunk_unit,
		overlapSize: asNumberOrNull(row.overlap_size),
		overlapUnit: row.overlap_unit,
		preserveStructure: row.preserve_structure,
		language: row.language,
		endpointBaseUrl: row.endpoint_base_url,
		endpointPath: row.endpoint_path,
		requestTimeoutMs: asNumberOrNull(row.request_timeout_ms),
		maxPayloadSizeKb: asNumberOrNull(row.max_payload_size_kb),
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
		workspaceId: asUuidString(row.workspace_id),
		embeddingServiceId: asUuidString(row.embedding_service_id),
		name: row.name,
		description: row.description,
		status: row.status,
		provider: row.provider,
		modelName: row.model_name,
		embeddingDimension: asNumber(row.embedding_dimension),
		distanceMetric: row.distance_metric,
		endpointBaseUrl: row.endpoint_base_url,
		endpointPath: row.endpoint_path,
		requestTimeoutMs: asNumberOrNull(row.request_timeout_ms),
		maxBatchSize: asNumberOrNull(row.max_batch_size),
		maxInputTokens: asNumberOrNull(row.max_input_tokens),
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
		workspaceId: asUuidString(row.workspace_id),
		rerankingServiceId: asUuidString(row.reranking_service_id),
		name: row.name,
		description: row.description,
		status: row.status,
		provider: row.provider,
		engine: row.engine,
		modelName: row.model_name,
		modelVersion: row.model_version,
		maxCandidates: asNumberOrNull(row.max_candidates),
		scoringStrategy: row.scoring_strategy,
		scoreNormalized: row.score_normalized,
		returnScores: row.return_scores,
		endpointBaseUrl: row.endpoint_base_url,
		endpointPath: row.endpoint_path,
		requestTimeoutMs: asNumberOrNull(row.request_timeout_ms),
		maxBatchSize: asNumberOrNull(row.max_batch_size),
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
		workspaceId: asUuidString(row.workspace_id),
		llmServiceId: asUuidString(row.llm_service_id),
		name: row.name,
		description: row.description,
		status: row.status,
		provider: row.provider,
		engine: row.engine,
		modelName: row.model_name,
		modelVersion: row.model_version,
		contextWindowTokens: asNumberOrNull(row.context_window_tokens),
		maxOutputTokens: asNumberOrNull(row.max_output_tokens),
		temperatureMin: asNumberOrNull(row.temperature_min),
		temperatureMax: asNumberOrNull(row.temperature_max),
		supportsStreaming: row.supports_streaming,
		supportsTools: row.supports_tools,
		endpointBaseUrl: row.endpoint_base_url,
		endpointPath: row.endpoint_path,
		requestTimeoutMs: asNumberOrNull(row.request_timeout_ms),
		maxBatchSize: asNumberOrNull(row.max_batch_size),
		authType: row.auth_type,
		credentialRef: row.credential_ref,
		supportedLanguages: setToSortedArray(row.supported_languages),
		supportedContent: setToSortedArray(row.supported_content),
		createdAt: row.created_at,
		updatedAt: row.updated_at,
	};
}

/* -------------------------- MCP server ---------------------------- */

/**
 * Parse the `allowed_tools` text column. `null`/missing → `null` (expose
 * every advertised tool); a serialized JSON array → a sorted, deduped
 * `string[]`. Throws on malformed JSON / non-array so a corrupt row
 * surfaces loudly rather than silently exposing every tool.
 */
function parseAllowedTools(raw: string | null): readonly string[] | null {
	if (raw == null) return null;
	const parsed = JSON.parse(raw) as unknown;
	if (!Array.isArray(parsed)) {
		throw new Error("expected allowed_tools to be a JSON array");
	}
	return [...new Set(parsed.map((v) => String(v)))].sort();
}

export function mcpServerToRow(r: McpServerRecord): McpServerRow {
	return {
		workspace_id: r.workspaceId,
		mcp_server_id: r.mcpServerId,
		label: r.label,
		url: r.url,
		credential_ref: r.credentialRef,
		enabled: r.enabled,
		allowed_tools:
			r.allowedTools === null ? null : JSON.stringify(r.allowedTools),
		created_at: r.createdAt,
		updated_at: r.updatedAt,
	};
}

export function mcpServerFromRow(row: McpServerRow): McpServerRecord {
	return {
		workspaceId: asUuidString(row.workspace_id),
		mcpServerId: asUuidString(row.mcp_server_id),
		label: row.label,
		url: row.url,
		credentialRef: row.credential_ref,
		// Legacy rows written before the column existed read as enabled.
		enabled: row.enabled ?? true,
		allowedTools: parseAllowedTools(row.allowed_tools),
		createdAt: asIsoString(row.created_at),
		updatedAt: asIsoString(row.updated_at),
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
		llm_service_id: r.llmServiceId,
		knowledge_base_ids: arrayToSet(r.knowledgeBaseIds),
		rerank_enabled: r.rerankEnabled,
		reranking_service_id: r.rerankingServiceId,
		rerank_max_results: r.rerankMaxResults,
		created_at: r.createdAt,
		updated_at: r.updatedAt,
	};
}

export function agentFromRow(row: AgentRow): AgentRecord {
	return {
		workspaceId: asUuidString(row.workspace_id),
		agentId: asUuidString(row.agent_id),
		name: row.name,
		description: row.description,
		systemPrompt: row.system_prompt,
		userPrompt: row.user_prompt,
		toolIds: setToSortedArray(row.tool_ids),
		llmServiceId: asNullableUuidString(row.llm_service_id),
		knowledgeBaseIds: setToSortedArray(row.knowledge_base_ids),
		rerankEnabled: row.rerank_enabled,
		rerankingServiceId: asNullableUuidString(row.reranking_service_id),
		rerankMaxResults: asNumberOrNull(row.rerank_max_results),
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
		// `null` and the empty set both mean "no KB filter — draw from
		// all KBs in the workspace." We send `null` to keep the wire
		// representation compact; reads coalesce both back to `[]`.
		knowledge_base_ids:
			r.knowledgeBaseIds.length > 0 ? arrayToSet(r.knowledgeBaseIds) : null,
	};
}

export function conversationFromRow(row: ConversationRow): ConversationRecord {
	return {
		workspaceId: asUuidString(row.workspace_id),
		agentId: asUuidString(row.agent_id),
		conversationId: asUuidString(row.conversation_id),
		createdAt: row.created_at,
		title: row.title,
		knowledgeBaseIds: setToSortedArray(row.knowledge_base_ids),
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
		workspaceId: asUuidString(row.workspace_id),
		conversationId: asUuidString(row.conversation_id),
		messageTs: row.message_ts,
		messageId: asUuidString(row.message_id),
		role: row.role,
		authorId: row.author_id == null ? null : asUuidString(row.author_id),
		content: row.content,
		// `tool_id` is text (tool *name*), not a UUID — see the schema
		// note in `MESSAGES_DEFINITION`. Pass through verbatim.
		toolId: row.tool_id ?? null,
		toolCallPayload: parseJsonObject(row.tool_call_payload),
		toolResponse: parseJsonObject(row.tool_response),
		tokenCount: asNumberOrNull(row.token_count),
		metadata: asPlainStringMap(row.metadata),
	};
}

/* ================================================================== */
/* End knowledge-base converters.                                     */
/* ================================================================== */

/* ================================================================== */
/* RLAC prototype converters.                                          */
/* ================================================================== */

export function principalToRow(r: PrincipalRecord): PrincipalRow {
	return {
		workspace_id: r.workspaceId,
		principal_id: r.principalId,
		label: r.label,
		attributes: { ...r.attributes },
		role: r.role,
		created_at: r.createdAt,
		updated_at: r.updatedAt,
	};
}

export function principalFromRow(row: PrincipalRow): PrincipalRecord {
	return {
		workspaceId: asUuidString(row.workspace_id),
		principalId: row.principal_id,
		label: row.label,
		attributes: asPlainStringMap(row.attributes),
		role: parseRole(row.role),
		// `timestamp` columns come back as `Date` from astra-db-ts;
		// coerce to ISO-8601 so consumers can sort/compare with
		// `localeCompare` and `<` without crashing.
		createdAt: asIsoString(row.created_at),
		updatedAt: asIsoString(row.updated_at),
	};
}

const POLICY_ACTIONS = new Set<PolicyAction>([
	"list",
	"get",
	"search",
	"ingest",
	"update",
	"delete",
]);
const POLICY_DECISIONS = new Set<PolicyDecision>(["allow", "deny", "filter"]);

function coercePolicyAction(value: string): PolicyAction {
	return POLICY_ACTIONS.has(value as PolicyAction)
		? (value as PolicyAction)
		: "list";
}

function coercePolicyDecision(value: string): PolicyDecision {
	return POLICY_DECISIONS.has(value as PolicyDecision)
		? (value as PolicyDecision)
		: "filter";
}

export function policyAuditToRow(r: PolicyAuditRecord): PolicyAuditRow {
	return {
		workspace_id: r.workspaceId,
		audit_day: r.auditDay,
		ts: r.ts,
		decision_id: r.decisionId,
		principal_id: r.principalId,
		knowledge_base_id: r.knowledgeBaseId,
		resource_id: r.resourceId,
		action: r.action,
		decision: r.decision,
		reason: r.reason,
		compiled_filter_json: r.compiledFilterJson,
	};
}

export function policyAuditFromRow(row: PolicyAuditRow): PolicyAuditRecord {
	return {
		workspaceId: asUuidString(row.workspace_id),
		auditDay: row.audit_day,
		// `ts` is a `timestamp` column — astra-db-ts decodes it as a
		// JS `Date`. The audit slice sorts the merged two-day result
		// set with `localeCompare`, which throws on `Date`. Coerce here.
		ts: asIsoString(row.ts),
		decisionId: asUuidString(row.decision_id),
		principalId: row.principal_id ?? null,
		knowledgeBaseId: asUuidString(row.knowledge_base_id),
		resourceId: row.resource_id,
		action: coercePolicyAction(row.action),
		decision: coercePolicyDecision(row.decision),
		reason: row.reason,
		compiledFilterJson: row.compiled_filter_json ?? null,
	};
}
