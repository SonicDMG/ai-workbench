/**
 * Backend-agnostic contract for the workbench control plane.
 *
 * Implementations:
 *  - {@link ./memory/store.MemoryControlPlaneStore} — in-process, default.
 *  - {@link ./file/store.FileControlPlaneStore} — JSON on disk, single-node.
 *  - `AstraControlPlaneStore` (Phase 1a.2) — CQL via secure-connect-bundle.
 *
 * Every method is async to allow any backend to be I/O-bound. Synchronous
 * backends simply resolve immediately.
 *
 * Error contract: methods throw {@link ./errors} classes for predictable
 * conditions (not-found, conflict, unavailable). Other thrown errors are
 * treated as internal errors by the route layer.
 */

import type {
	CatalogRecord,
	DocumentRecord,
	DocumentStatus,
	EmbeddingConfig,
	LexicalConfig,
	RerankingConfig,
	SecretRef,
	VectorSimilarity,
	VectorStoreRecord,
	WorkspaceKind,
	WorkspaceRecord,
} from "./types.js";

/* ------------------------------------------------------------------ */
/* Workspace                                                          */
/* ------------------------------------------------------------------ */

export interface CreateWorkspaceInput {
	/** Optional — generated if omitted. */
	readonly uid?: string;
	readonly name: string;
	readonly url?: string | null;
	readonly kind: WorkspaceKind;
	readonly credentialsRef?: Readonly<Record<string, SecretRef>>;
	readonly keyspace?: string | null;
}

export interface UpdateWorkspaceInput {
	readonly name?: string;
	readonly url?: string | null;
	readonly kind?: WorkspaceKind;
	readonly credentialsRef?: Readonly<Record<string, SecretRef>>;
	readonly keyspace?: string | null;
}

/* ------------------------------------------------------------------ */
/* Catalog                                                            */
/* ------------------------------------------------------------------ */

export interface CreateCatalogInput {
	readonly uid?: string;
	readonly name: string;
	readonly description?: string | null;
	readonly vectorStore?: string | null;
}

export interface UpdateCatalogInput {
	readonly name?: string;
	readonly description?: string | null;
	readonly vectorStore?: string | null;
}

/* ------------------------------------------------------------------ */
/* Document                                                           */
/* ------------------------------------------------------------------ */

export interface CreateDocumentInput {
	readonly uid?: string;
	readonly sourceDocId?: string | null;
	readonly sourceFilename?: string | null;
	readonly fileType?: string | null;
	readonly fileSize?: number | null;
	readonly md5Hash?: string | null;
	readonly chunkTotal?: number | null;
	readonly ingestedAt?: string | null;
	readonly status?: DocumentStatus;
	readonly errorMessage?: string | null;
	readonly metadata?: Readonly<Record<string, string>>;
}

export interface UpdateDocumentInput {
	readonly sourceDocId?: string | null;
	readonly sourceFilename?: string | null;
	readonly fileType?: string | null;
	readonly fileSize?: number | null;
	readonly md5Hash?: string | null;
	readonly chunkTotal?: number | null;
	readonly ingestedAt?: string | null;
	readonly status?: DocumentStatus;
	readonly errorMessage?: string | null;
	readonly metadata?: Readonly<Record<string, string>>;
}

/* ------------------------------------------------------------------ */
/* Vector store                                                       */
/* ------------------------------------------------------------------ */

export interface CreateVectorStoreInput {
	readonly uid?: string;
	readonly name: string;
	readonly vectorDimension: number;
	readonly vectorSimilarity?: VectorSimilarity;
	readonly embedding: EmbeddingConfig;
	readonly lexical?: LexicalConfig;
	readonly reranking?: RerankingConfig;
}

export interface UpdateVectorStoreInput {
	readonly name?: string;
	readonly vectorDimension?: number;
	readonly vectorSimilarity?: VectorSimilarity;
	readonly embedding?: EmbeddingConfig;
	readonly lexical?: LexicalConfig;
	readonly reranking?: RerankingConfig;
}

/* ------------------------------------------------------------------ */
/* Store                                                              */
/* ------------------------------------------------------------------ */

/**
 * Canonical control-plane interface. All methods MUST behave identically
 * across backends modulo durability — a record written must be visible
 * to subsequent reads on the same store instance.
 */
export interface ControlPlaneStore {
	/* Workspaces */
	listWorkspaces(): Promise<readonly WorkspaceRecord[]>;
	getWorkspace(uid: string): Promise<WorkspaceRecord | null>;
	createWorkspace(input: CreateWorkspaceInput): Promise<WorkspaceRecord>;
	updateWorkspace(
		uid: string,
		patch: UpdateWorkspaceInput,
	): Promise<WorkspaceRecord>;
	deleteWorkspace(uid: string): Promise<{ deleted: boolean }>;

	/* Catalogs */
	listCatalogs(workspace: string): Promise<readonly CatalogRecord[]>;
	getCatalog(workspace: string, uid: string): Promise<CatalogRecord | null>;
	createCatalog(
		workspace: string,
		input: CreateCatalogInput,
	): Promise<CatalogRecord>;
	updateCatalog(
		workspace: string,
		uid: string,
		patch: UpdateCatalogInput,
	): Promise<CatalogRecord>;
	deleteCatalog(workspace: string, uid: string): Promise<{ deleted: boolean }>;

	/* Vector stores */
	listVectorStores(workspace: string): Promise<readonly VectorStoreRecord[]>;
	getVectorStore(
		workspace: string,
		uid: string,
	): Promise<VectorStoreRecord | null>;
	createVectorStore(
		workspace: string,
		input: CreateVectorStoreInput,
	): Promise<VectorStoreRecord>;
	updateVectorStore(
		workspace: string,
		uid: string,
		patch: UpdateVectorStoreInput,
	): Promise<VectorStoreRecord>;
	deleteVectorStore(
		workspace: string,
		uid: string,
	): Promise<{ deleted: boolean }>;

	/* Documents */
	listDocuments(
		workspace: string,
		catalog: string,
	): Promise<readonly DocumentRecord[]>;
	getDocument(
		workspace: string,
		catalog: string,
		uid: string,
	): Promise<DocumentRecord | null>;
	createDocument(
		workspace: string,
		catalog: string,
		input: CreateDocumentInput,
	): Promise<DocumentRecord>;
	updateDocument(
		workspace: string,
		catalog: string,
		uid: string,
		patch: UpdateDocumentInput,
	): Promise<DocumentRecord>;
	deleteDocument(
		workspace: string,
		catalog: string,
		uid: string,
	): Promise<{ deleted: boolean }>;

	/** Optional: run migrations, open connections, etc. Idempotent. */
	init?(): Promise<void>;

	/** Optional: release connections and flush buffers. Idempotent. */
	close?(): Promise<void>;
}
