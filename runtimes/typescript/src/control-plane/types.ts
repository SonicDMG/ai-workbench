/**
 * Canonical record types for the control plane.
 *
 * These types are backend-agnostic: the CQL tables in
 * `src/control-plane/astra/migrations/0001_init.cql` are one physical
 * realization, but `memory` and `file` backends hold the same logical shape
 * in process memory / on disk. Any new backend implements
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
	 * Data-plane endpoint for this workspace's backend. For `astra` /
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
	readonly endpoint: string | null;
	readonly kind: WorkspaceKind;
	/** Map of credential name → secret ref. Never holds raw secrets. */
	readonly credentialsRef: Readonly<Record<string, SecretRef>>;
	readonly keyspace: string | null;
	readonly createdAt: string;
	readonly updatedAt: string;
}

/** A named, declarative grouping of documents bound to one vector store. */
export interface CatalogRecord {
	readonly workspace: string;
	readonly uid: string;
	readonly name: string;
	readonly description: string | null;
	/** UUID of the vector store this catalog writes into. */
	readonly vectorStore: string | null;
	readonly createdAt: string;
	readonly updatedAt: string;
}

/** Metadata about an ingested document. */
export interface DocumentRecord {
	readonly workspace: string;
	readonly catalogUid: string;
	readonly documentUid: string;
	readonly sourceDocId: string | null;
	readonly sourceFilename: string | null;
	readonly fileType: string | null;
	readonly fileSize: number | null;
	readonly md5Hash: string | null;
	readonly chunkTotal: number | null;
	readonly ingestedAt: string | null;
	readonly updatedAt: string;
	readonly status: DocumentStatus;
	readonly errorMessage: string | null;
	readonly metadata: Readonly<Record<string, string>>;
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

/** A vector store (collection) owned by a workspace. */
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
