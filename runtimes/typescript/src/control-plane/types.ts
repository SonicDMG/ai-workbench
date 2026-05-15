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

/**
 * Closed enum of every value {@link DocumentStatus} can take. Kept as a
 * `readonly` tuple so callers can iterate (e.g. fan-out deletes across
 * the partitioned `wb_rag_documents_by_status` index in
 * `astra/store.ts#deleteWorkspace`).
 */
export const DOCUMENT_STATUSES = [
	"pending",
	"chunking",
	"embedding",
	"writing",
	"ready",
	"failed",
] as const;

/** Lifecycle state of an ingested document. */
export type DocumentStatus = (typeof DOCUMENT_STATUSES)[number];

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
	/**
	 * RLAC master switch (workspace-wide). When `false` no row-level
	 * filtering happens anywhere in the workspace and the SPA hides
	 * every RLAC surface (View-as picker, visibility picker, audit
	 * panel, principals panel). When `true` every KB read is filtered
	 * through the canonical visibility-list predicate. Defaults to
	 * `false`; legacy rows that predate the column also back-compat
	 * to `false`.
	 */
	readonly rlacEnabled: boolean;
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
	/**
	 * Privilege tiers this key carries. Empty array means the key can
	 * authenticate but cannot pass any `requireScope(...)` gate — the
	 * verifier still resolves it to a subject so the audit trail is
	 * intact. Persisted rows missing this field back-compat to
	 * {@link DEFAULT_API_KEY_SCOPES} so existing keys keep working.
	 */
	readonly scopes: readonly ApiKeyScope[];
	readonly createdAt: string;
	readonly lastUsedAt: string | null;
	readonly revokedAt: string | null;
	readonly expiresAt: string | null;
}

/**
 * Privilege tiers an issued API key can carry. Two-tier today;
 * splitting `write` into more granular slices (e.g. `write:ingest`
 * vs `write:admin`) is intentionally deferred until the surface that
 * needs the split actually lands. Existing rows persisted before this
 * column was added back-compat to `["read", "write"]` so behavior
 * doesn't change for already-minted keys.
 */
export type ApiKeyScope = "read" | "write";

/**
 * Default for newly-minted keys when the caller omits `scopes`. Keeps
 * the legacy "key grants everything the workspace allows" behavior
 * for callers that don't opt into the picker.
 */
export const DEFAULT_API_KEY_SCOPES: readonly ApiKeyScope[] = ["read", "write"];

/** Type guard for runtime parsing of arbitrary input shapes. */
export function isApiKeyScope(value: unknown): value is ApiKeyScope {
	return value === "read" || value === "write";
}

/**
 * Coerce arbitrary input to a normalized scope set. Filters unknown
 * values silently — the schema validator at the route layer rejects
 * those up front; this helper exists for the store layer where the
 * input is already trusted but may be missing entirely (back-compat
 * read of an old row).
 */
export function normalizeApiKeyScopes(
	input: readonly unknown[] | null | undefined,
): readonly ApiKeyScope[] {
	if (!input || input.length === 0) return DEFAULT_API_KEY_SCOPES;
	const seen = new Set<ApiKeyScope>();
	for (const v of input) if (isApiKeyScope(v)) seen.add(v);
	if (seen.size === 0) return DEFAULT_API_KEY_SCOPES;
	// Deterministic order for stable comparisons + wire shape.
	return (["read", "write"] as const).filter((s) => seen.has(s));
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
	/** Astra collection name backing this KB. Auto-generated on create
	 * (`wb_vectors_<id>`), or the name of a pre-existing collection
	 * when the KB was created via the attach-existing path. */
	readonly vectorCollection: string | null;
	/** True when the runtime provisioned the underlying collection
	 * during create (and therefore owns its lifecycle); false when
	 * the KB attached to a pre-existing collection. Drives whether
	 * `DELETE` drops the collection. */
	readonly owned: boolean;
	readonly lexical: LexicalConfig;
	/**
	 * Row-level access control (RLAC) prototype. `policyDsl` is the
	 * authored SQL-subset predicate; `policyEnabled` gates enforcement.
	 * When `policyEnabled` is false (or `policyDsl` is null), reads
	 * return the legacy unfiltered set. See `runtimes/typescript/src/policy/`.
	 */
	readonly policyDsl: string | null;
	readonly policyEnabled: boolean;
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
	/**
	 * RLAC: principal ids (and/or the special token "*") that may read
	 * this row. The route layer injects a Data API filter equivalent to
	 * `{$or: [{visible_to: "*"}, {visible_to: <caller>}]}` on every read
	 * when the parent KB has `policyEnabled = true`. An empty set means
	 * the row is invisible to every non-admin caller (operator escape
	 * hatches still bypass enforcement). Null preserves legacy behavior
	 * for pre-RLAC rows.
	 */
	readonly visibleTo: string[] | null;
	/** Provenance only; never used for enforcement. */
	readonly ownerPrincipalId: string | null;
}

/**
 * RLAC: a sub-workspace identity that the policy DSL evaluates against.
 * `principalId` is a free-form string — typically an OIDC `sub`, an
 * email address, or an operator-chosen handle. Attribute keys mirror
 * the names available to the DSL as `$principal.<key>`.
 */
export interface PrincipalRecord {
	readonly workspaceId: string;
	readonly principalId: string;
	readonly label: string | null;
	readonly attributes: Readonly<Record<string, string>>;
	readonly createdAt: string;
	readonly updatedAt: string;
}

/** RLAC: outcome of a single policy decision. */
export type PolicyDecision = "allow" | "deny" | "filter";

/** RLAC: action verb captured in the audit log. */
export type PolicyAction =
	| "list"
	| "get"
	| "search"
	| "ingest"
	| "update"
	| "delete";

/**
 * RLAC: a single policy-decision audit record. Persisted append-only to
 * `wb_policy_audit_by_workspace`. The route layer emits one per call
 * via the policy enforcer.
 */
export interface PolicyAuditRecord {
	readonly workspaceId: string;
	readonly auditDay: string; // YYYY-MM-DD
	readonly ts: string;
	readonly decisionId: string;
	readonly principalId: string | null;
	readonly knowledgeBaseId: string;
	readonly resourceId: string;
	readonly action: PolicyAction;
	readonly decision: PolicyDecision;
	readonly reason: string;
	readonly compiledFilterJson: string | null;
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
	/** Optional pointer to an LLM service in the same workspace. When
	 * set, agent send/stream resolves the model + provider from the
	 * service record. When null, the global runtime `chat:` block is
	 * used (transitional). Mutable. */
	readonly llmServiceId: string | null;
	readonly knowledgeBaseIds: readonly string[];
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
	/**
	 * Per-conversation RAG-grounding set. Empty = the conversation's
	 * agent draws from all KBs in the workspace; populated = restricted
	 * to those KBs. Sorted for stable wire output and equality.
	 */
	readonly knowledgeBaseIds: readonly string[];
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
