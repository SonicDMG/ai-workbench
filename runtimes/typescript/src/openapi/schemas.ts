/**
 * Shared Zod + OpenAPI schemas for the AI Workbench HTTP surface.
 *
 * Every response / request body reaches the wire through one of these.
 * Keeping them in a single module means the generated OpenAPI doc at
 * `/api/v1/openapi.json` stays coherent — field names are declared
 * once, referenced everywhere.
 */

import { z } from "@hono/zod-openapi";

/* ---------------- Operational ---------------- */

export const BannerSchema = z
	.object({
		name: z.string().openapi({ example: "ai-workbench" }),
		version: z.string().openapi({ example: "0.0.0" }),
		commit: z.string().openapi({ example: "abc1234" }),
		docs: z.string().openapi({ example: "/docs" }),
	})
	.openapi("Banner");

export const HealthSchema = z
	.object({ status: z.literal("ok") })
	.openapi("Health");

export const ReadySchema = z
	.object({
		status: z.literal("ready"),
		workspaces: z.number().int().openapi({ example: 3 }),
	})
	.openapi("Ready");

export const VersionSchema = z
	.object({
		version: z.string().openapi({ example: "0.0.0" }),
		commit: z.string().openapi({ example: "abc1234" }),
		buildTime: z.string().openapi({ example: "2026-04-21T10:30:00Z" }),
		node: z.string().openapi({ example: "v22.11.0" }),
	})
	.openapi("Version");

/* ---------------- Errors ---------------- */

export const ErrorEnvelopeSchema = z
	.object({
		error: z.object({
			code: z.string().openapi({ example: "workspace_not_found" }),
			message: z.string(),
			requestId: z.string().openapi({ example: "01HY2Z..." }),
		}),
	})
	.openapi("ErrorEnvelope");

/* ---------------- Enums ---------------- */

const WorkspaceKind = z.enum(["astra", "hcd", "openrag", "mock"]);

/** `<provider>:<path>` — e.g. `env:OPENAI_API_KEY`, `file:/etc/secret`. */
const SecretRefSchema = z
	.string()
	.regex(/^[a-z][a-z0-9]*:.+/i, "expected '<provider>:<path>', e.g. 'env:FOO'")
	.openapi("SecretRef", { example: "env:ASTRA_DB_APPLICATION_TOKEN" });
const VectorSimilarity = z.enum(["cosine", "dot", "euclidean"]);
const DocumentStatusSchema = z
	.enum(["pending", "chunking", "embedding", "writing", "ready", "failed"])
	.openapi("DocumentStatus");

/* ---------------- Workspace ---------------- */

/**
 * Data-plane endpoint for a workspace. Accepts either:
 *   - a literal URL (`https://<db>-<region>.apps.astra.datastax.com`), or
 *   - a {@link SecretRef} (`env:ASTRA_DB_API_ENDPOINT`, `file:/path`).
 *
 * The astra driver detects refs by prefix-matching a registered
 * {@link SecretProvider} and resolves them at dial time.
 */
const EndpointSchema = z
	.union([z.string().url(), SecretRefSchema])
	.openapi("Endpoint", { example: "env:ASTRA_DB_API_ENDPOINT" });

export const WorkspaceRecordSchema = z
	.object({
		uid: z.string().uuid(),
		name: z.string(),
		endpoint: z.string().nullable(),
		kind: WorkspaceKind,
		credentialsRef: z.record(z.string(), SecretRefSchema),
		keyspace: z.string().nullable(),
		createdAt: z.string(),
		updatedAt: z.string(),
	})
	.openapi("Workspace");

export const CreateWorkspaceInputSchema = z
	.object({
		uid: z.string().uuid().optional(),
		name: z.string().min(1),
		endpoint: EndpointSchema.nullable().optional(),
		kind: WorkspaceKind,
		credentialsRef: z.record(z.string(), SecretRefSchema).optional(),
		keyspace: z.string().nullable().optional(),
	})
	.openapi("CreateWorkspaceInput");

// `kind` is intentionally excluded — a workspace's backend cannot
// change after creation. Any vector-store descriptors would point at
// the old backend's collections; switching kinds would silently orphan
// them. Delete-and-recreate if the workspace needs a different kind.
export const UpdateWorkspaceInputSchema = z
	.object({
		name: z.string().min(1).optional(),
		endpoint: EndpointSchema.nullable().optional(),
		credentialsRef: z.record(z.string(), SecretRefSchema).optional(),
		keyspace: z.string().nullable().optional(),
	})
	.strict()
	.openapi("UpdateWorkspaceInput");

/* ---------------- Catalog ---------------- */

export const CatalogRecordSchema = z
	.object({
		workspace: z.string().uuid(),
		uid: z.string().uuid(),
		name: z.string(),
		description: z.string().nullable(),
		vectorStore: z.string().uuid().nullable(),
		createdAt: z.string(),
		updatedAt: z.string(),
	})
	.openapi("Catalog");

export const CreateCatalogInputSchema = z
	.object({
		uid: z.string().uuid().optional(),
		name: z.string().min(1),
		description: z.string().nullable().optional(),
		vectorStore: z.string().uuid().nullable().optional(),
	})
	.openapi("CreateCatalogInput");

export const UpdateCatalogInputSchema = z
	.object({
		name: z.string().min(1).optional(),
		description: z.string().nullable().optional(),
		vectorStore: z.string().uuid().nullable().optional(),
	})
	.openapi("UpdateCatalogInput");

/* ---------------- Workspace actions ---------------- */

export const TestConnectionResponseSchema = z
	.object({
		ok: z.boolean(),
		kind: WorkspaceKind,
		details: z.string().openapi({
			example:
				"2 credentials resolved; this verifies refs only, not the backend token.",
		}),
	})
	.openapi("TestConnectionResponse");

/* ---------------- Document ---------------- */

export const DocumentRecordSchema = z
	.object({
		workspace: z.string().uuid(),
		catalogUid: z.string().uuid(),
		documentUid: z.string().uuid(),
		sourceDocId: z.string().nullable(),
		sourceFilename: z.string().nullable(),
		fileType: z.string().nullable(),
		fileSize: z.number().int().nonnegative().nullable(),
		md5Hash: z.string().nullable(),
		chunkTotal: z.number().int().nonnegative().nullable(),
		ingestedAt: z.string().nullable(),
		updatedAt: z.string(),
		status: DocumentStatusSchema,
		errorMessage: z.string().nullable(),
		metadata: z.record(z.string(), z.string()),
	})
	.openapi("Document");

export const CreateDocumentInputSchema = z
	.object({
		uid: z.string().uuid().optional(),
		sourceDocId: z.string().nullable().optional(),
		sourceFilename: z.string().nullable().optional(),
		fileType: z.string().nullable().optional(),
		fileSize: z.number().int().nonnegative().nullable().optional(),
		md5Hash: z.string().nullable().optional(),
		chunkTotal: z.number().int().nonnegative().nullable().optional(),
		ingestedAt: z.string().nullable().optional(),
		status: DocumentStatusSchema.optional(),
		errorMessage: z.string().nullable().optional(),
		metadata: z.record(z.string(), z.string()).optional(),
	})
	.openapi("CreateDocumentInput");

export const UpdateDocumentInputSchema = z
	.object({
		sourceDocId: z.string().nullable().optional(),
		sourceFilename: z.string().nullable().optional(),
		fileType: z.string().nullable().optional(),
		fileSize: z.number().int().nonnegative().nullable().optional(),
		md5Hash: z.string().nullable().optional(),
		chunkTotal: z.number().int().nonnegative().nullable().optional(),
		ingestedAt: z.string().nullable().optional(),
		status: DocumentStatusSchema.optional(),
		errorMessage: z.string().nullable().optional(),
		metadata: z.record(z.string(), z.string()).optional(),
	})
	.openapi("UpdateDocumentInput");

/* ---------------- Vector store ---------------- */

const EmbeddingConfigSchema = z
	.object({
		provider: z.string(),
		model: z.string(),
		endpoint: z.string().url().nullable(),
		dimension: z.number().int().positive(),
		secretRef: z.string().nullable(),
	})
	.openapi("EmbeddingConfig");

const LexicalConfigSchema = z
	.object({
		enabled: z.boolean(),
		analyzer: z.string().nullable(),
		options: z.record(z.string(), z.string()),
	})
	.openapi("LexicalConfig");

const RerankingConfigSchema = z
	.object({
		enabled: z.boolean(),
		provider: z.string().nullable(),
		model: z.string().nullable(),
		endpoint: z.string().url().nullable(),
		secretRef: z.string().nullable(),
	})
	.openapi("RerankingConfig");

export const VectorStoreRecordSchema = z
	.object({
		workspace: z.string().uuid(),
		uid: z.string().uuid(),
		name: z.string(),
		vectorDimension: z.number().int().positive(),
		vectorSimilarity: VectorSimilarity,
		embedding: EmbeddingConfigSchema,
		lexical: LexicalConfigSchema,
		reranking: RerankingConfigSchema,
		createdAt: z.string(),
		updatedAt: z.string(),
	})
	.openapi("VectorStore");

export const CreateVectorStoreInputSchema = z
	.object({
		uid: z.string().uuid().optional(),
		name: z.string().min(1),
		vectorDimension: z.number().int().positive(),
		vectorSimilarity: VectorSimilarity.optional(),
		embedding: EmbeddingConfigSchema,
		lexical: LexicalConfigSchema.optional(),
		reranking: RerankingConfigSchema.optional(),
	})
	.openapi("CreateVectorStoreInput");

/**
 * One row in `GET .../vector-stores/discoverable`. Mirrors the
 * driver-layer `AdoptableCollection` minus filtering — the route
 * already strips collections that are present in the descriptor table.
 */
export const AdoptableCollectionSchema = z
	.object({
		name: z.string(),
		vectorDimension: z.number().int().positive(),
		vectorSimilarity: VectorSimilarity,
		embedding: z
			.object({
				provider: z.string(),
				model: z.string(),
			})
			.nullable(),
		lexicalEnabled: z.boolean(),
		rerankEnabled: z.boolean(),
		rerankProvider: z.string().nullable(),
		rerankModel: z.string().nullable(),
	})
	.openapi("AdoptableCollection");

/**
 * Body of `POST .../vector-stores/adopt`. The descriptor's `name`
 * must match the data-plane collection name on adoption — the
 * existing `collectionName(descriptor)` mapping returns
 * `descriptor.name` when it satisfies Astra's identifier rules
 * (which it does by construction since the value came from Astra).
 */
export const AdoptCollectionInputSchema = z
	.object({
		collectionName: z.string().min(1),
	})
	.openapi("AdoptCollectionInput");

export const UpdateVectorStoreInputSchema = z
	.object({
		name: z.string().min(1).optional(),
		vectorDimension: z.number().int().positive().optional(),
		vectorSimilarity: VectorSimilarity.optional(),
		embedding: EmbeddingConfigSchema.optional(),
		lexical: LexicalConfigSchema.optional(),
		reranking: RerankingConfigSchema.optional(),
	})
	.openapi("UpdateVectorStoreInput");

/* ---------------- Vector-store data plane ---------------- */

/**
 * Input shape for upsert. Each record carries either a `vector` OR
 * a `text` (not both, not neither). Text records trigger the same
 * server-side-or-client-side dispatch as the search route — drivers
 * that support `$vectorize` (Astra with a `service` block) take
 * them natively; others fall back to the runtime's Embedder.
 */
export const VectorRecordSchema = z
	.object({
		id: z.string().min(1),
		vector: z.array(z.number()).min(1).optional(),
		text: z.string().min(1).optional(),
		payload: z.record(z.string(), z.unknown()).optional(),
	})
	.refine((r) => (r.vector === undefined) !== (r.text === undefined), {
		message: "exactly one of 'vector' or 'text' must be provided per record",
	})
	.openapi("VectorRecord");

export const UpsertRequestSchema = z
	.object({
		records: z.array(VectorRecordSchema).min(1).max(500),
	})
	.openapi("UpsertRequest");

export const UpsertResponseSchema = z
	.object({
		upserted: z.number().int().nonnegative(),
	})
	.openapi("UpsertResponse");

export const DeleteRecordResponseSchema = z
	.object({
		deleted: z.boolean(),
	})
	.openapi("DeleteRecordResponse");

/**
 * Data-plane search input.
 *
 * Either `vector` OR `text` must be present, not both. `text`
 * triggers the driver's server-side embedding path when the
 * collection supports it (e.g. Astra `$vectorize`); otherwise the
 * runtime embeds client-side via the vector store's declared
 * `embedding` config and falls back to a vector search. The route
 * layer handles the dispatch — drivers never see both fields.
 */
export const SearchRequestSchema = z
	.object({
		vector: z.array(z.number()).min(1).optional(),
		text: z.string().min(1).optional(),
		topK: z.number().int().positive().max(1000).optional(),
		filter: z.record(z.string(), z.unknown()).optional(),
		includeEmbeddings: z.boolean().optional(),
		/** Opt into the hybrid (vector + lexical) lane. Default follows
		 * the bound store's `lexical.enabled` flag. Requires `text`
		 * (the lexical lane can't operate without it). */
		hybrid: z.boolean().optional(),
		/** Weight of the lexical score in the hybrid combination,
		 * `[0, 1]`. Only consulted when `hybrid: true`. Default 0.5. */
		lexicalWeight: z.number().min(0).max(1).optional(),
		/** Opt into the driver's reranker after the initial retrieval.
		 * Default follows the bound store's `reranking.enabled` flag. */
		rerank: z.boolean().optional(),
	})
	.refine((v) => (v.vector === undefined) !== (v.text === undefined), {
		message: "exactly one of 'vector' or 'text' must be provided",
	})
	.openapi("SearchRequest");

export const SearchHitSchema = z
	.object({
		id: z.string(),
		score: z.number(),
		payload: z.record(z.string(), z.unknown()).optional(),
		vector: z.array(z.number()).optional(),
	})
	.openapi("SearchHit");

/* ---------------- Saved query ---------------- */

export const SavedQueryRecordSchema = z
	.object({
		workspace: z.string().uuid(),
		catalogUid: z.string().uuid(),
		queryUid: z.string().uuid(),
		name: z.string(),
		description: z.string().nullable(),
		text: z.string(),
		topK: z.number().int().positive().max(1000).nullable(),
		filter: z.record(z.string(), z.unknown()).nullable(),
		createdAt: z.string(),
		updatedAt: z.string(),
	})
	.openapi("SavedQuery");

export const CreateSavedQueryInputSchema = z
	.object({
		uid: z.string().uuid().optional(),
		name: z.string().min(1),
		description: z.string().nullable().optional(),
		text: z.string().min(1),
		topK: z.number().int().positive().max(1000).nullable().optional(),
		filter: z.record(z.string(), z.unknown()).nullable().optional(),
	})
	.openapi("CreateSavedQueryInput");

export const UpdateSavedQueryInputSchema = z
	.object({
		name: z.string().min(1).optional(),
		description: z.string().nullable().optional(),
		text: z.string().min(1).optional(),
		topK: z.number().int().positive().max(1000).nullable().optional(),
		filter: z.record(z.string(), z.unknown()).nullable().optional(),
	})
	.openapi("UpdateSavedQueryInput");

/* ---------------- Ingest ---------------- */

export const IngestChunkerOptionsSchema = z
	.object({
		maxChars: z.number().int().positive().optional(),
		minChars: z.number().int().nonnegative().optional(),
		overlapChars: z.number().int().nonnegative().optional(),
	})
	.openapi("IngestChunkerOptions");

/**
 * Ingest one document's worth of raw text. The runtime chunks the text,
 * embeds each chunk (server-side via `$vectorize` if the vector store
 * supports it, otherwise client-side), and upserts the chunks into the
 * catalog's bound vector store. A {@link Document} metadata row is
 * created alongside — caller can omit `uid` to have one generated.
 */
export const IngestRequestSchema = z
	.object({
		/** Raw text to chunk. Required; empty strings are rejected. */
		text: z.string().min(1),
		/** Optional UID for the created document — generated if omitted. */
		uid: z.string().uuid().optional(),
		sourceDocId: z.string().nullable().optional(),
		sourceFilename: z.string().nullable().optional(),
		fileType: z.string().nullable().optional(),
		fileSize: z.number().int().nonnegative().nullable().optional(),
		md5Hash: z.string().nullable().optional(),
		/** Merged onto every chunk record's payload. `catalogUid` and
		 * `documentUid` are reserved and always overridden by the runtime. */
		metadata: z.record(z.string(), z.string()).optional(),
		/** Override the default chunker options. */
		chunker: IngestChunkerOptionsSchema.optional(),
	})
	.openapi("IngestRequest");

export const IngestResponseSchema = z
	.object({
		document: DocumentRecordSchema,
		/** Number of chunks produced and upserted. Equals
		 * `document.chunkTotal` on success. */
		chunks: z.number().int().nonnegative(),
	})
	.openapi("IngestResponse");

/** Lifecycle of a background job. */
export const JobStatusSchema = z
	.enum(["pending", "running", "succeeded", "failed"])
	.openapi("JobStatus");

export const JobRecordSchema = z
	.object({
		workspace: z.string().uuid(),
		jobId: z.string().uuid(),
		kind: z.enum(["ingest"]),
		catalogUid: z.string().uuid().nullable(),
		documentUid: z.string().uuid().nullable(),
		status: JobStatusSchema,
		processed: z.number().int().nonnegative(),
		total: z.number().int().nonnegative().nullable(),
		result: z.record(z.string(), z.unknown()).nullable(),
		errorMessage: z.string().nullable(),
		createdAt: z.string(),
		updatedAt: z.string(),
	})
	.openapi("Job");

/**
 * 202 envelope for `POST /ingest?async=true`. Returns both the
 * freshly-created job and the document row — callers can track
 * either; they stay in sync as the pipeline progresses.
 */
export const AsyncIngestResponseSchema = z
	.object({
		job: JobRecordSchema,
		document: DocumentRecordSchema,
	})
	.openapi("AsyncIngestResponse");

export const JobIdParamSchema = z
	.string()
	.uuid()
	.openapi({
		param: { name: "jobId", in: "path" },
		example: "00000000-0000-0000-0000-000000000000",
	});

/* ---------------- Params ---------------- */

export const WorkspaceIdParamSchema = z
	.string()
	.uuid()
	.openapi({
		param: { name: "workspaceId", in: "path" },
		example: "00000000-0000-0000-0000-000000000000",
	});

export const CatalogIdParamSchema = z
	.string()
	.uuid()
	.openapi({
		param: { name: "catalogId", in: "path" },
		example: "00000000-0000-0000-0000-000000000000",
	});

export const DocumentIdParamSchema = z
	.string()
	.uuid()
	.openapi({
		param: { name: "documentId", in: "path" },
		example: "00000000-0000-0000-0000-000000000000",
	});

export const VectorStoreIdParamSchema = z
	.string()
	.uuid()
	.openapi({
		param: { name: "vectorStoreId", in: "path" },
		example: "00000000-0000-0000-0000-000000000000",
	});

export const RecordIdParamSchema = z
	.string()
	.min(1)
	.openapi({
		param: { name: "recordId", in: "path" },
		example: "doc-1",
	});

export const ApiKeyIdParamSchema = z
	.string()
	.uuid()
	.openapi({
		param: { name: "keyId", in: "path" },
		example: "00000000-0000-0000-0000-000000000000",
	});

export const SavedQueryIdParamSchema = z
	.string()
	.uuid()
	.openapi({
		param: { name: "queryId", in: "path" },
		example: "00000000-0000-0000-0000-000000000000",
	});

/* ---------------- API key ---------------- */

export const ApiKeyRecordSchema = z
	.object({
		workspace: z.string().uuid(),
		keyId: z.string().uuid(),
		prefix: z
			.string()
			.openapi({ description: "Non-secret lookup prefix of the wire token" }),
		label: z.string(),
		createdAt: z.string(),
		lastUsedAt: z.string().nullable(),
		revokedAt: z.string().nullable(),
		expiresAt: z.string().nullable(),
	})
	.openapi("ApiKey");

export const CreateApiKeyInputSchema = z
	.object({
		label: z
			.string()
			.min(1, "label is required")
			.max(120, "label must be at most 120 characters"),
		expiresAt: z.string().datetime().nullable().optional(),
	})
	.openapi("CreateApiKeyInput");

export const CreatedApiKeyResponseSchema = z
	.object({
		/** Returned ONCE on create; never retrievable again. */
		plaintext: z.string().openapi({ example: "wb_live_abc123xyz789_…" }),
		key: ApiKeyRecordSchema,
	})
	.openapi("CreatedApiKeyResponse");

export { DocumentStatusSchema };
