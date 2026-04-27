/**
 * Canonical record types for the control plane.
 *
 * These types are backend-agnostic: the Astra backend stores the same
 * logical shape in Data API Tables, while `memory` and `file` keep it in
 * process memory / on disk. Any new backend implements
 * {@link ControlPlaneStore} against this vocabulary.
 *
 * Conventions:
 * - All timestamps are ISO-8601 strings (UTC). Backends convert to/from
 *   their native types (e.g. CQL `timestamp`) at the boundary.
 * - All identifiers are RFC 4122 UUIDs rendered as lowercase strings.
 * - Secrets are never stored by value. `*Ref` fields hold a secret
 *   reference of the form `"<provider>:<path>"` (e.g. `"env:ASTRA_TOKEN"`).
 *   The active {@link ../secrets/provider.SecretProvider} resolves these
 *   lazily at use time.
 */

/** A pointer to a secret, resolved at use time. Format: `<provider>:<path>`. */
export type SecretRef = string;

/** Which backend drives a workspace's data plane. */
export type WorkspaceKind = "astra" | "hcd" | "openrag" | "mock";

/** Distance function used for vector similarity search. */
export type VectorSimilarity = "cosine" | "dot" | "euclidean";

/** Lifecycle state of an ingested document. */
export type DocumentStatus =
	| "pending"
	| "chunking"
	| "embedding"
	| "writing"
	| "ready"
	| "failed";

/** A workspace — the top-level tenant boundary. */
export interface WorkspaceRecord {
	readonly uid: string;
	readonly name: string;
	/**
	 * Data-plane URL for this workspace's backend. For `astra` /
	 * `hcd` workspaces this is the Astra Data API URL the driver dials.
	 * Accepts two shapes:
	 *   - A literal URL: `https://<db>-<region>.apps.astra.datastax.com`
	 *   - A {@link SecretRef}: `env:ASTRA_DB_API_ENDPOINT`,
	 *     `file:/path`
	 * Literal URLs are used as-is; refs are resolved through the
	 * {@link ../secrets/provider.SecretResolver} at dial time. Detection
	 * is prefix-based: a string whose `<prefix>` segment matches a
	 * registered secret provider is treated as a ref, otherwise as a
	 * literal URL.
	 *
	 * `mock` / `openrag` workspaces don't dial anything and leave this
	 * `null`.
	 */
	readonly url: string | null;
	readonly kind: WorkspaceKind;
	/** Map of credential name → secret ref. Never holds raw secrets. */
	readonly credentials: Readonly<Record<string, SecretRef>>;
	/** Astra/HCD keyspace targeted by the workspace. */
	readonly keyspace: string | null;
	readonly createdAt: string;
	readonly updatedAt: string;
}

/**
 * Workspace-scoped API key. Persisted on create, looked up by
 * `prefix` on every authenticated request, compared by
 * constant-time digest against `hash`.
 *
 * Token wire format (spoken by clients):
 *   `wb_live_<prefix>_<secret>`
 * where `prefix` is a 12-char base36 lookup token (non-secret,
 * logged, used as the bulk index) and `secret` is a 32-char
 * random (secret, never stored in plaintext).
 *
 * The `keyId` is a stable UUID used in the URL path
 * (`/api-keys/{keyId}`). Separate from the wire prefix because
 * UUIDs aren't URL-friendly-enough for a prefix while also being
 * fast to look up.
 */
export interface ApiKeyRecord {
	readonly workspace: string;
	readonly keyId: string;
	/** 12-char base36 lookup token. Unique across all workspaces. */
	readonly prefix: string;
	/** scrypt digest of the full token. Never leaves the runtime. */
	readonly hash: string;
	/** Human-readable name shown in the workspace's key list. */
	readonly label: string;
	readonly createdAt: string;
	readonly lastUsedAt: string | null;
	readonly revokedAt: string | null;
	readonly expiresAt: string | null;
}

/** Embedding configuration for a vector store. */
export interface EmbeddingConfig {
	readonly provider: string;
	readonly model: string;
	readonly endpoint: string | null;
	readonly dimension: number;
	readonly secretRef: SecretRef | null;
}

/** Lexical / BM25 configuration for a vector store. */
export interface LexicalConfig {
	readonly enabled: boolean;
	readonly analyzer: string | null;
	readonly options: Readonly<Record<string, string>>;
}

/** Reranker configuration for a vector store. */
export interface RerankingConfig {
	readonly enabled: boolean;
	readonly provider: string | null;
	readonly model: string | null;
	readonly endpoint: string | null;
	readonly secretRef: SecretRef | null;
}

/**
 * Driver-facing descriptor of a vector collection. The control plane
 * doesn't persist these directly — they're synthesised on demand from
 * a {@link KnowledgeBaseRecord} plus its bound embedding/reranking
 * services. Drivers and the search/upsert dispatch layers consume this
 * shape so they don't need to know KBs exist.
 */
export interface VectorStoreRecord {
	readonly workspace: string;
	readonly uid: string;
	readonly name: string;
	readonly vectorDimension: number;
	readonly vectorSimilarity: VectorSimilarity;
	readonly embedding: EmbeddingConfig;
	readonly lexical: LexicalConfig;
	readonly reranking: RerankingConfig;
	readonly createdAt: string;
	readonly updatedAt: string;
}

/* ================================================================== */
/*                                                                    */
/* Knowledge-Base records (issue #98).                                */
/*                                                                    */
/* Mirror the `wb_config_*` / `wb_rag_*` / `wb_agentic_*` tables in   */
/* camelCase.                                                         */
/*                                                                    */
/* ================================================================== */

/** Lifecycle of an execution service (chunking / embedding / reranking / LLM). */
export type ServiceStatus = "active" | "deprecated" | "experimental";

/** Lifecycle of a Knowledge Base. */
export type KnowledgeBaseStatus = "active" | "draft" | "deprecated";

/** Distance metric used by an embedding service / vector collection. */
export type DistanceMetric = "cosine" | "dot" | "euclidean";

/** Authentication scheme for a service endpoint. */
export type AuthType = "none" | "api_key" | "oauth2" | "mTLS";

/** Three-letter language hint for a Knowledge Base. */
export type KnowledgeBaseLanguage = "en" | "fr" | "multi" | (string & {});

/** Speaker role on an agent message. */
export type AgentRole = "user" | "agent" | "tool" | "system";

/** Backward-compatible type alias for older converter/test imports. */
export type ConfigWorkspaceRecord = WorkspaceRecord;

/** A Knowledge Base — replaces `CatalogRecord` + (most of) `VectorStoreRecord`. */
export interface KnowledgeBaseRecord {
	readonly workspaceId: string;
	readonly knowledgeBaseId: string;
	readonly name: string;
	readonly description: string | null;
	readonly status: KnowledgeBaseStatus;
	readonly embeddingServiceId: string;
	readonly chunkingServiceId: string;
	readonly rerankingServiceId: string | null;
	readonly language: KnowledgeBaseLanguage | null;
	/** Auto-provisioned Astra collection name backing this KB. Set on
	 * create from the bound embedding service's dimension/metric;
	 * surfaced read-only to callers. */
	readonly vectorCollection: string | null;
	readonly lexical: LexicalConfig;
	readonly createdAt: string;
	readonly updatedAt: string;
}

/** A saved payload filter scoped to one Knowledge Base. */
export interface KnowledgeFilterRecord {
	readonly workspaceId: string;
	readonly knowledgeBaseId: string;
	readonly knowledgeFilterId: string;
	readonly name: string;
	readonly description: string | null;
	/** JSON object merged into/searchable as the KB payload filter. */
	readonly filter: Readonly<Record<string, unknown>>;
	readonly createdAt: string;
	readonly updatedAt: string;
}

interface ServiceEndpointConfig {
	readonly endpointBaseUrl: string | null;
	readonly endpointPath: string | null;
	readonly requestTimeoutMs: number | null;
	readonly authType: AuthType;
	readonly credentialRef: SecretRef | null;
}

/** A chunking executor — describes *how* to call a chunking engine. */
export interface ChunkingServiceRecord extends ServiceEndpointConfig {
	readonly workspaceId: string;
	readonly chunkingServiceId: string;
	readonly name: string;
	readonly description: string | null;
	readonly status: ServiceStatus;
	readonly engine: string;
	readonly engineVersion: string | null;
	readonly strategy: string | null;
	readonly maxChunkSize: number | null;
	readonly minChunkSize: number | null;
	readonly chunkUnit: string | null;
	readonly overlapSize: number | null;
	readonly overlapUnit: string | null;
	readonly preserveStructure: boolean | null;
	readonly language: string | null;
	readonly maxPayloadSizeKb: number | null;
	readonly enableOcr: boolean | null;
	readonly extractTables: boolean | null;
	readonly extractFigures: boolean | null;
	readonly readingOrder: string | null;
	readonly createdAt: string;
	readonly updatedAt: string;
}

/** An embedding executor — describes *how* to call an embedding model. */
export interface EmbeddingServiceRecord extends ServiceEndpointConfig {
	readonly workspaceId: string;
	readonly embeddingServiceId: string;
	readonly name: string;
	readonly description: string | null;
	readonly status: ServiceStatus;
	readonly provider: string;
	readonly modelName: string;
	readonly embeddingDimension: number;
	readonly distanceMetric: DistanceMetric;
	readonly maxBatchSize: number | null;
	readonly maxInputTokens: number | null;
	/** Sorted, deduplicated. Backed by `SET<TEXT>` in CQL but exposed
	 * here as a list so the wire form (JSON) is the same as the
	 * in-memory shape. */
	readonly supportedLanguages: readonly string[];
	readonly supportedContent: readonly string[];
	readonly createdAt: string;
	readonly updatedAt: string;
}

/** A reranking executor — describes *how* to call a reranking model. */
export interface RerankingServiceRecord extends ServiceEndpointConfig {
	readonly workspaceId: string;
	readonly rerankingServiceId: string;
	readonly name: string;
	readonly description: string | null;
	readonly status: ServiceStatus;
	readonly provider: string;
	readonly engine: string | null;
	readonly modelName: string;
	readonly modelVersion: string | null;
	readonly maxCandidates: number | null;
	readonly scoringStrategy: string | null;
	readonly scoreNormalized: boolean | null;
	readonly returnScores: boolean | null;
	readonly maxBatchSize: number | null;
	readonly supportedLanguages: readonly string[];
	readonly supportedContent: readonly string[];
	readonly createdAt: string;
	readonly updatedAt: string;
}

/** An LLM executor — describes *how* to call a chat/generation model. */
export interface LlmServiceRecord extends ServiceEndpointConfig {
	readonly workspaceId: string;
	readonly llmServiceId: string;
	readonly name: string;
	readonly description: string | null;
	readonly status: ServiceStatus;
	readonly provider: string;
	readonly engine: string | null;
	readonly modelName: string;
	readonly modelVersion: string | null;
	readonly contextWindowTokens: number | null;
	readonly maxOutputTokens: number | null;
	readonly temperatureMin: number | null;
	readonly temperatureMax: number | null;
	readonly supportsStreaming: boolean | null;
	readonly supportsTools: boolean | null;
	readonly maxBatchSize: number | null;
	readonly supportedLanguages: readonly string[];
	readonly supportedContent: readonly string[];
	readonly createdAt: string;
	readonly updatedAt: string;
}

/** A tool an agent may invoke — MCP, plain HTTP, builtin, or function. */
export interface McpToolRecord {
	readonly workspaceId: string;
	readonly toolId: string;
	readonly name: string;
	readonly description: string | null;
	readonly toolType: string;
	readonly endpointBaseUrl: string | null;
	readonly endpointPath: string | null;
	readonly httpMethod: string | null;
	/** JSON-Schema as a record, deserialized by the converter. */
	readonly inputSchema: Readonly<Record<string, unknown>> | null;
	/** JSON-Schema as a record, deserialized by the converter. */
	readonly outputSchema: Readonly<Record<string, unknown>> | null;
	readonly authType: AuthType;
	readonly credentialRef: SecretRef | null;
	readonly tags: readonly string[];
	readonly createdAt: string;
	readonly updatedAt: string;
}

/** Document under the new schema. Replaces `DocumentRecord`. */
export interface RagDocumentRecord {
	readonly workspaceId: string;
	readonly knowledgeBaseId: string;
	readonly documentId: string;
	readonly sourceDocId: string | null;
	readonly sourceFilename: string | null;
	readonly fileType: string | null;
	readonly fileSize: number | null;
	/** Content hash (was `md5Hash`). Algorithm is implementation-defined
	 * but the value is opaque and used for dedup only. */
	readonly contentHash: string | null;
	readonly chunkTotal: number | null;
	readonly status: DocumentStatus;
	readonly errorMessage: string | null;
	readonly ingestedAt: string | null;
	readonly updatedAt: string;
	readonly metadata: Readonly<Record<string, string>>;
}

/** Index row in `wb_rag_documents_by_knowledge_base_and_status`. */
export interface RagDocumentStatusEntry {
	readonly workspaceId: string;
	readonly knowledgeBaseId: string;
	readonly status: DocumentStatus;
	readonly documentId: string;
	readonly sourceFilename: string | null;
	readonly ingestedAt: string | null;
}

/** Index row in `wb_rag_documents_by_content_hash`. */
export interface RagDocumentHashEntry {
	readonly contentHash: string;
	readonly workspaceId: string;
	readonly knowledgeBaseId: string;
	readonly documentId: string;
}

/** An agent — orchestrates LLM + tools + KBs. */
export interface AgentRecord {
	readonly workspaceId: string;
	readonly agentId: string;
	readonly name: string;
	readonly description: string | null;
	readonly systemPrompt: string | null;
	readonly userPrompt: string | null;
	readonly toolIds: readonly string[];
	readonly ragEnabled: boolean;
	readonly knowledgeBaseIds: readonly string[];
	readonly ragMaxResults: number | null;
	readonly ragMinScore: number | null;
	readonly rerankEnabled: boolean;
	/** Agent-level reranking override. When set, takes precedence over
	 * the KB-level `rerankingServiceId` (gap #3 resolution). */
	readonly rerankingServiceId: string | null;
	readonly rerankMaxResults: number | null;
	readonly createdAt: string;
	readonly updatedAt: string;
}

/** A conversation between a user and an agent. */
export interface ConversationRecord {
	readonly workspaceId: string;
	readonly agentId: string;
	readonly conversationId: string;
	readonly createdAt: string;
	readonly title: string | null;
}

/** A single message in a conversation. */
export interface MessageRecord {
	readonly workspaceId: string;
	readonly conversationId: string;
	readonly messageTs: string;
	readonly messageId: string;
	readonly role: AgentRole;
	readonly authorId: string | null;
	readonly content: string | null;
	readonly toolId: string | null;
	/** Tool-call arguments, parsed from JSON. */
	readonly toolCallPayload: Readonly<Record<string, unknown>> | null;
	/** Tool response, parsed from JSON. */
	readonly toolResponse: Readonly<Record<string, unknown>> | null;
	readonly tokenCount: number | null;
	readonly metadata: Readonly<Record<string, string>>;
}

/* ================================================================== */
/* End knowledge-base records.                                        */
/* ================================================================== */
