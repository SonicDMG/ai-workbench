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

export const VectorRecordSchema = z
	.object({
		id: z.string().min(1),
		vector: z.array(z.number()).min(1),
		payload: z.record(z.string(), z.unknown()).optional(),
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

export const SearchRequestSchema = z
	.object({
		vector: z.array(z.number()).min(1),
		topK: z.number().int().positive().max(1000).optional(),
		filter: z.record(z.string(), z.unknown()).optional(),
		includeEmbeddings: z.boolean().optional(),
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

export { DocumentStatusSchema };
