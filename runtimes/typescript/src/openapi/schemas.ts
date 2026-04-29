/**
 * Shared Zod + OpenAPI schemas for the AI Workbench HTTP surface.
 *
 * Every response / request body reaches the wire through one of these.
 * Keeping them in a single module means the generated OpenAPI doc at
 * `/api/v1/openapi.json` stays coherent — field names are declared
 * once, referenced everywhere.
 */

import { z } from "@hono/zod-openapi";
import {
	MAX_CHAT_MESSAGE_CHARS,
	MAX_INGEST_TEXT_CHARS,
	MAX_QUERY_TEXT_CHARS,
	MAX_VECTOR_RECORD_TEXT_CHARS,
	MAX_VECTOR_VALUES,
} from "../lib/limits.js";
import { MAX_PAGE_LIMIT } from "../lib/pagination.js";

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
		buildTime: z
			.string()
			.datetime()
			.openapi({ example: "2026-04-21T10:30:00Z" }),
		node: z.string().openapi({ example: "v22.11.0" }),
	})
	.openapi("Version");

/**
 * Public shape of `astra-cli` auto-detection at runtime startup.
 * Whether the runtime resolved a profile/database from the `astra`
 * CLI, and which one. The token is never exposed on the wire — the
 * UI uses this to suggest sensible defaults in the workspace
 * onboarding form, and to confirm to the user that the env vars
 * they're about to use point at a real database.
 */
export const AstraCliDatabaseInfoSchema = z
	.object({
		id: z.string().openapi({ example: "00000000-0000-0000-0000-000000000000" }),
		name: z.string().openapi({ example: "mydb" }),
		region: z.string().openapi({ example: "us-east-2" }),
		endpoint: z.string().url().openapi({
			example:
				"https://00000000-0000-0000-0000-000000000000-us-east-2.apps.astra.datastax.com",
		}),
		keyspace: z.string().nullable().openapi({ example: "default_keyspace" }),
	})
	.openapi("AstraCliDatabaseInfo");

export const AstraCliInfoSchema = z
	.discriminatedUnion("detected", [
		z.object({
			detected: z.literal(true),
			profile: z.string().openapi({ example: "workbench-dev" }),
			database: AstraCliDatabaseInfoSchema,
		}),
		z.object({
			detected: z.literal(false),
			reason: z.enum([
				"already-configured",
				"disabled",
				"binary-not-found",
				"no-profiles",
				"no-databases",
				"ambiguous-profile-non-interactive",
				"ambiguous-database-non-interactive",
				"user-aborted",
				"cli-error",
			]),
		}),
	])
	.openapi("AstraCliInfo");

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

/* ---------------- Pagination ---------------- */

export const PaginationQuerySchema = z
	.object({
		limit: z.coerce
			.number()
			.int()
			.min(1)
			.max(MAX_PAGE_LIMIT)
			.optional()
			.openapi({
				param: { name: "limit", in: "query" },
				example: 50,
				description: `Maximum number of items to return (max ${MAX_PAGE_LIMIT}).`,
			}),
		cursor: z
			.string()
			.min(1)
			.optional()
			.openapi({
				param: { name: "cursor", in: "query" },
				description:
					"Opaque cursor returned as `nextCursor` from the previous page.",
			}),
	})
	.openapi("PaginationQuery");

function pageSchema<T extends z.ZodTypeAny>(name: string, item: T) {
	return z
		.object({
			items: z.array(item),
			nextCursor: z.string().nullable(),
		})
		.openapi(name);
}

/* ---------------- Enums ---------------- */

const WorkspaceKind = z.enum(["astra", "hcd", "openrag", "mock"]);

/** `<provider>:<path>` — e.g. `env:OPENAI_API_KEY`, `file:/etc/secret`. */
const SecretRefSchema = z
	.string()
	.regex(/^[a-z][a-z0-9]*:.+$/, "expected '<provider>:<path>', e.g. 'env:FOO'")
	.openapi("SecretRef", { example: "env:ASTRA_DB_APPLICATION_TOKEN" });
const DateTimeSchema = z.string().datetime();
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
		workspaceId: z.string().uuid(),
		name: z.string(),
		url: z.string().nullable(),
		kind: WorkspaceKind,
		keyspace: z.string().nullable(),
		credentials: z.record(z.string(), SecretRefSchema).openapi({
			description:
				"Secret references only. Resolved credential values are never returned.",
		}),
		createdAt: DateTimeSchema,
		updatedAt: DateTimeSchema,
	})
	.openapi("Workspace");

export const WorkspacePageSchema = pageSchema(
	"WorkspacePage",
	WorkspaceRecordSchema,
);

export const CreateWorkspaceInputSchema = z
	.object({
		workspaceId: z.string().uuid().optional(),
		name: z.string().min(1),
		url: EndpointSchema.nullable().optional(),
		kind: WorkspaceKind,
		keyspace: z.string().nullable().optional(),
		credentials: z.record(z.string(), SecretRefSchema).optional(),
	})
	.openapi("CreateWorkspaceInput");

// `kind` is intentionally excluded — a workspace's backend cannot
// change after creation. Any vector-store descriptors would point at
// the old backend's collections; switching kinds would silently orphan
// them. Delete-and-recreate if the workspace needs a different kind.
export const UpdateWorkspaceInputSchema = z
	.object({
		name: z.string().min(1).optional(),
		url: EndpointSchema.nullable().optional(),
		keyspace: z.string().nullable().optional(),
		credentials: z.record(z.string(), SecretRefSchema).optional(),
	})
	.strict()
	.openapi("UpdateWorkspaceInput");

/* ---------------- Workspace actions ---------------- */

export const TestConnectionResponseSchema = z
	.object({
		ok: z.boolean(),
		kind: WorkspaceKind,
		details: z.string().openapi({
			example: "Astra Data API responded to listCollections.",
		}),
	})
	.openapi("TestConnectionResponse");

/* ---------------- Driver descriptor (internal — no longer wire-facing) ---------------- */

const LexicalConfigSchema = z
	.object({
		enabled: z.boolean(),
		analyzer: z.string().nullable(),
		options: z.record(z.string(), z.string()),
	})
	.openapi("LexicalConfig");

/**
 * One chunk listed under a document by
 * `GET .../knowledge-bases/{kb}/documents/{d}/chunks`. The route
 * reads raw records out of the KB's vector collection, filters by
 * `documentId`, and surfaces a flat list. Text comes from the
 * `chunkText` payload key the ingest pipeline stamps.
 */
export const DocumentChunkSchema = z
	.object({
		id: z.string(),
		chunkIndex: z.number().int().nonnegative().nullable(),
		text: z.string().nullable(),
		payload: z.record(z.string(), z.unknown()),
	})
	.openapi("DocumentChunk");

/* ---------------- KB data plane (upsert + search) ---------------- */

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
		vector: z.array(z.number()).min(1).max(MAX_VECTOR_VALUES).optional(),
		text: z.string().min(1).max(MAX_VECTOR_RECORD_TEXT_CHARS).optional(),
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
		vector: z.array(z.number()).min(1).max(MAX_VECTOR_VALUES).optional(),
		text: z.string().min(1).max(MAX_QUERY_TEXT_CHARS).optional(),
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

/* ---------------- Ingest ---------------- */

export const IngestChunkerOptionsSchema = z
	.object({
		maxChars: z.number().int().positive().optional(),
		minChars: z.number().int().nonnegative().optional(),
		overlapChars: z.number().int().nonnegative().optional(),
	})
	.openapi("IngestChunkerOptions");

/** Lifecycle of a background job. */
export const JobStatusSchema = z
	.enum(["pending", "running", "succeeded", "failed"])
	.openapi("JobStatus");

export const JobRecordSchema = z
	.object({
		workspaceId: z.string().uuid(),
		jobId: z.string().uuid(),
		kind: z.enum(["ingest"]),
		knowledgeBaseId: z.string().uuid().nullable(),
		documentId: z.string().uuid().nullable(),
		status: JobStatusSchema,
		processed: z.number().int().nonnegative(),
		total: z.number().int().nonnegative().nullable(),
		result: z.record(z.string(), z.unknown()).nullable(),
		errorMessage: z.string().nullable(),
		createdAt: DateTimeSchema,
		updatedAt: DateTimeSchema,
	})
	.openapi("Job");

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

export const DocumentIdParamSchema = z
	.string()
	.uuid()
	.openapi({
		param: { name: "documentId", in: "path" },
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

/* ---------------- API key ---------------- */

export const ApiKeyRecordSchema = z
	.object({
		workspaceId: z.string().uuid(),
		keyId: z.string().uuid(),
		prefix: z
			.string()
			.openapi({ description: "Non-secret lookup prefix of the wire token" }),
		label: z.string(),
		createdAt: DateTimeSchema,
		lastUsedAt: DateTimeSchema.nullable(),
		revokedAt: DateTimeSchema.nullable(),
		expiresAt: DateTimeSchema.nullable(),
	})
	.openapi("ApiKey");

export const ApiKeyPageSchema = pageSchema("ApiKeyPage", ApiKeyRecordSchema);

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

/* ================================================================== */
/*                                                                    */
/*  Knowledge-Base schema (issue #98) — additive in phase 1b.         */
/*                                                                    */
/*  These schemas describe the new API surface that coexists with     */
/*  the legacy `/catalogs` and `/vector-stores` endpoints. Phase 1c   */
/*  drops the legacy schemas above.                                   */
/*                                                                    */
/* ================================================================== */

const ServiceStatusSchema = z
	.enum(["active", "deprecated", "experimental"])
	.openapi("ServiceStatus");

const KnowledgeBaseStatusSchema = z
	.enum(["active", "draft", "deprecated"])
	.openapi("KnowledgeBaseStatus");

const DistanceMetricSchema = z
	.enum(["cosine", "dot", "euclidean"])
	.openapi("DistanceMetric");

const AuthTypeSchema = z
	.enum(["none", "api_key", "oauth2", "mTLS"])
	.openapi("AuthType");

/* ---------- Knowledge base ---------- */

export const KnowledgeBaseRecordSchema = z
	.object({
		workspaceId: z.string().uuid(),
		knowledgeBaseId: z.string().uuid(),
		name: z.string(),
		description: z.string().nullable(),
		status: KnowledgeBaseStatusSchema,
		embeddingServiceId: z.string().uuid(),
		chunkingServiceId: z.string().uuid(),
		rerankingServiceId: z.string().uuid().nullable(),
		language: z.string().nullable(),
		vectorCollection: z.string().nullable(),
		lexical: LexicalConfigSchema,
		createdAt: DateTimeSchema,
		updatedAt: DateTimeSchema,
	})
	.openapi("KnowledgeBase");

export const KnowledgeBasePageSchema = pageSchema(
	"KnowledgeBasePage",
	KnowledgeBaseRecordSchema,
);

export const CreateKnowledgeBaseInputSchema = z
	.object({
		knowledgeBaseId: z.string().uuid().optional(),
		name: z.string().min(1),
		description: z.string().nullable().optional(),
		status: KnowledgeBaseStatusSchema.optional(),
		embeddingServiceId: z.string().uuid(),
		chunkingServiceId: z.string().uuid(),
		rerankingServiceId: z.string().uuid().nullable().optional(),
		language: z.string().nullable().optional(),
		lexical: LexicalConfigSchema.optional(),
		vectorCollection: z.string().nullable().optional(),
	})
	.openapi("CreateKnowledgeBaseInput");

// `embeddingServiceId` and `chunkingServiceId` are intentionally absent
// — they're immutable after creation because vectors / chunks on disk
// are bound to the model that produced them.
export const UpdateKnowledgeBaseInputSchema = z
	.object({
		name: z.string().min(1).optional(),
		description: z.string().nullable().optional(),
		status: KnowledgeBaseStatusSchema.optional(),
		rerankingServiceId: z.string().uuid().nullable().optional(),
		language: z.string().nullable().optional(),
		lexical: LexicalConfigSchema.optional(),
	})
	.strict()
	.openapi("UpdateKnowledgeBaseInput");

/* ---------- Knowledge filter ---------- */

export const KnowledgeFilterRecordSchema = z
	.object({
		workspaceId: z.string().uuid(),
		knowledgeBaseId: z.string().uuid(),
		knowledgeFilterId: z.string().uuid(),
		name: z.string(),
		description: z.string().nullable(),
		filter: z.record(z.string(), z.unknown()),
		createdAt: DateTimeSchema,
		updatedAt: DateTimeSchema,
	})
	.openapi("KnowledgeFilter");

export const KnowledgeFilterPageSchema = pageSchema(
	"KnowledgeFilterPage",
	KnowledgeFilterRecordSchema,
);

export const CreateKnowledgeFilterInputSchema = z
	.object({
		knowledgeFilterId: z.string().uuid().optional(),
		name: z.string().min(1),
		description: z.string().nullable().optional(),
		filter: z.record(z.string(), z.unknown()),
	})
	.openapi("CreateKnowledgeFilterInput");

export const UpdateKnowledgeFilterInputSchema =
	CreateKnowledgeFilterInputSchema.partial()
		.omit({ knowledgeFilterId: true })
		.openapi("UpdateKnowledgeFilterInput");

/* ---------- Chunking service ---------- */

export const ChunkingServiceRecordSchema = z
	.object({
		workspaceId: z.string().uuid(),
		chunkingServiceId: z.string().uuid(),
		name: z.string(),
		description: z.string().nullable(),
		status: ServiceStatusSchema,
		engine: z.string(),
		engineVersion: z.string().nullable(),
		strategy: z.string().nullable(),
		maxChunkSize: z.number().int().nullable(),
		minChunkSize: z.number().int().nullable(),
		chunkUnit: z.string().nullable(),
		overlapSize: z.number().int().nullable(),
		overlapUnit: z.string().nullable(),
		preserveStructure: z.boolean().nullable(),
		language: z.string().nullable(),
		endpointBaseUrl: z.string().nullable(),
		endpointPath: z.string().nullable(),
		requestTimeoutMs: z.number().int().nullable(),
		maxPayloadSizeKb: z.number().int().nullable(),
		authType: AuthTypeSchema,
		credentialRef: z.string().nullable(),
		enableOcr: z.boolean().nullable(),
		extractTables: z.boolean().nullable(),
		extractFigures: z.boolean().nullable(),
		readingOrder: z.string().nullable(),
		createdAt: DateTimeSchema,
		updatedAt: DateTimeSchema,
	})
	.openapi("ChunkingService");

export const ChunkingServicePageSchema = pageSchema(
	"ChunkingServicePage",
	ChunkingServiceRecordSchema,
);

export const CreateChunkingServiceInputSchema = z
	.object({
		chunkingServiceId: z.string().uuid().optional(),
		name: z.string().min(1),
		description: z.string().nullable().optional(),
		status: ServiceStatusSchema.optional(),
		engine: z.string().min(1),
		engineVersion: z.string().nullable().optional(),
		strategy: z.string().nullable().optional(),
		maxChunkSize: z.number().int().positive().nullable().optional(),
		minChunkSize: z.number().int().nonnegative().nullable().optional(),
		chunkUnit: z.string().nullable().optional(),
		overlapSize: z.number().int().nonnegative().nullable().optional(),
		overlapUnit: z.string().nullable().optional(),
		preserveStructure: z.boolean().nullable().optional(),
		language: z.string().nullable().optional(),
		endpointBaseUrl: z.string().nullable().optional(),
		endpointPath: z.string().nullable().optional(),
		requestTimeoutMs: z.number().int().positive().nullable().optional(),
		maxPayloadSizeKb: z.number().int().positive().nullable().optional(),
		authType: AuthTypeSchema.optional(),
		credentialRef: z.string().nullable().optional(),
		enableOcr: z.boolean().nullable().optional(),
		extractTables: z.boolean().nullable().optional(),
		extractFigures: z.boolean().nullable().optional(),
		readingOrder: z.string().nullable().optional(),
	})
	.openapi("CreateChunkingServiceInput");

export const UpdateChunkingServiceInputSchema =
	CreateChunkingServiceInputSchema.partial()
		.omit({ chunkingServiceId: true })
		.openapi("UpdateChunkingServiceInput");

/* ---------- Embedding service ---------- */

export const EmbeddingServiceRecordSchema = z
	.object({
		workspaceId: z.string().uuid(),
		embeddingServiceId: z.string().uuid(),
		name: z.string(),
		description: z.string().nullable(),
		status: ServiceStatusSchema,
		provider: z.string(),
		modelName: z.string(),
		embeddingDimension: z.number().int().positive(),
		distanceMetric: DistanceMetricSchema,
		endpointBaseUrl: z.string().nullable(),
		endpointPath: z.string().nullable(),
		requestTimeoutMs: z.number().int().nullable(),
		maxBatchSize: z.number().int().nullable(),
		maxInputTokens: z.number().int().nullable(),
		authType: AuthTypeSchema,
		credentialRef: z.string().nullable(),
		supportedLanguages: z.array(z.string()),
		supportedContent: z.array(z.string()),
		createdAt: DateTimeSchema,
		updatedAt: DateTimeSchema,
	})
	.openapi("EmbeddingService");

export const EmbeddingServicePageSchema = pageSchema(
	"EmbeddingServicePage",
	EmbeddingServiceRecordSchema,
);

export const CreateEmbeddingServiceInputSchema = z
	.object({
		embeddingServiceId: z.string().uuid().optional(),
		name: z.string().min(1),
		description: z.string().nullable().optional(),
		status: ServiceStatusSchema.optional(),
		provider: z.string().min(1),
		modelName: z.string().min(1),
		embeddingDimension: z.number().int().positive(),
		distanceMetric: DistanceMetricSchema.optional(),
		endpointBaseUrl: z.string().nullable().optional(),
		endpointPath: z.string().nullable().optional(),
		requestTimeoutMs: z.number().int().positive().nullable().optional(),
		maxBatchSize: z.number().int().positive().nullable().optional(),
		maxInputTokens: z.number().int().positive().nullable().optional(),
		authType: AuthTypeSchema.optional(),
		credentialRef: z.string().nullable().optional(),
		supportedLanguages: z.array(z.string()).optional(),
		supportedContent: z.array(z.string()).optional(),
	})
	.openapi("CreateEmbeddingServiceInput");

export const UpdateEmbeddingServiceInputSchema =
	CreateEmbeddingServiceInputSchema.partial()
		.omit({ embeddingServiceId: true })
		.openapi("UpdateEmbeddingServiceInput");

/* ---------- Reranking service ---------- */

export const RerankingServiceRecordSchema = z
	.object({
		workspaceId: z.string().uuid(),
		rerankingServiceId: z.string().uuid(),
		name: z.string(),
		description: z.string().nullable(),
		status: ServiceStatusSchema,
		provider: z.string(),
		engine: z.string().nullable(),
		modelName: z.string(),
		modelVersion: z.string().nullable(),
		maxCandidates: z.number().int().nullable(),
		scoringStrategy: z.string().nullable(),
		scoreNormalized: z.boolean().nullable(),
		returnScores: z.boolean().nullable(),
		endpointBaseUrl: z.string().nullable(),
		endpointPath: z.string().nullable(),
		requestTimeoutMs: z.number().int().nullable(),
		maxBatchSize: z.number().int().nullable(),
		authType: AuthTypeSchema,
		credentialRef: z.string().nullable(),
		supportedLanguages: z.array(z.string()),
		supportedContent: z.array(z.string()),
		createdAt: DateTimeSchema,
		updatedAt: DateTimeSchema,
	})
	.openapi("RerankingService");

export const RerankingServicePageSchema = pageSchema(
	"RerankingServicePage",
	RerankingServiceRecordSchema,
);

export const CreateRerankingServiceInputSchema = z
	.object({
		rerankingServiceId: z.string().uuid().optional(),
		name: z.string().min(1),
		description: z.string().nullable().optional(),
		status: ServiceStatusSchema.optional(),
		provider: z.string().min(1),
		engine: z.string().nullable().optional(),
		modelName: z.string().min(1),
		modelVersion: z.string().nullable().optional(),
		maxCandidates: z.number().int().positive().nullable().optional(),
		scoringStrategy: z.string().nullable().optional(),
		scoreNormalized: z.boolean().nullable().optional(),
		returnScores: z.boolean().nullable().optional(),
		endpointBaseUrl: z.string().nullable().optional(),
		endpointPath: z.string().nullable().optional(),
		requestTimeoutMs: z.number().int().positive().nullable().optional(),
		maxBatchSize: z.number().int().positive().nullable().optional(),
		authType: AuthTypeSchema.optional(),
		credentialRef: z.string().nullable().optional(),
		supportedLanguages: z.array(z.string()).optional(),
		supportedContent: z.array(z.string()).optional(),
	})
	.openapi("CreateRerankingServiceInput");

export const UpdateRerankingServiceInputSchema =
	CreateRerankingServiceInputSchema.partial()
		.omit({ rerankingServiceId: true })
		.openapi("UpdateRerankingServiceInput");

/* ---------- URL params ---------- */

export const KnowledgeBaseIdParamSchema = z
	.string()
	.uuid()
	.openapi({
		param: { name: "knowledgeBaseId", in: "path" },
		example: "11111111-2222-3333-4444-555555555555",
	});

export const KnowledgeFilterIdParamSchema = z
	.string()
	.uuid()
	.openapi({
		param: { name: "knowledgeFilterId", in: "path" },
		example: "11111111-2222-3333-4444-555555555555",
	});

export const ChunkingServiceIdParamSchema = z
	.string()
	.uuid()
	.openapi({
		param: { name: "chunkingServiceId", in: "path" },
		example: "11111111-2222-3333-4444-555555555555",
	});

export const ChatIdParamSchema = z
	.string()
	.uuid()
	.openapi({
		param: { name: "chatId", in: "path" },
		example: "11111111-2222-3333-4444-555555555555",
	});

export const AgentIdParamSchema = z
	.string()
	.uuid()
	.openapi({
		param: { name: "agentId", in: "path" },
		example: "11111111-2222-3333-4444-555555555555",
	});

export const ConversationIdParamSchema = z
	.string()
	.uuid()
	.openapi({
		param: { name: "conversationId", in: "path" },
		example: "11111111-2222-3333-4444-555555555555",
	});

export const ChatMessageIdParamSchema = z
	.string()
	.uuid()
	.openapi({
		param: { name: "messageId", in: "path" },
		example: "11111111-2222-3333-4444-555555555555",
	});

/* ---------- Chat (workspace-scoped) ---------- */

/**
 * Wire-shape for a chat conversation. Backed by the
 * `wb_agentic_conversations_by_agent` table; routes never expose the
 * agent_id since v0 has exactly one agent per workspace (Bobbie) and
 * surfacing it would invite premature agent-management UX.
 */
export const ChatRecordSchema = z
	.object({
		workspaceId: z.string().uuid(),
		chatId: z.string().uuid(),
		title: z.string().nullable(),
		knowledgeBaseIds: z.array(z.string().uuid()),
		createdAt: DateTimeSchema,
	})
	.openapi("Chat");

export const ChatPageSchema = pageSchema("ChatPage", ChatRecordSchema);

export const CreateChatInputSchema = z
	.object({
		chatId: z.string().uuid().optional(),
		title: z.string().min(1).nullable().optional(),
		knowledgeBaseIds: z.array(z.string().uuid()).optional(),
	})
	.openapi("CreateChatInput");

export const UpdateChatInputSchema = z
	.object({
		title: z.string().min(1).nullable().optional(),
		knowledgeBaseIds: z.array(z.string().uuid()).optional(),
	})
	.strict()
	.openapi("UpdateChatInput");

/**
 * Wire-shape for a chat message. Mirrors `MessageRecord` minus the
 * Stage-2 tool fields that aren't used in the v0 chat surface (Bobbie
 * doesn't have tools yet). RAG provenance lives in `metadata.context_document_ids`
 * as a comma-separated string for v0; future rev can promote it to
 * a typed array.
 */
export const ChatMessageRecordSchema = z
	.object({
		workspaceId: z.string().uuid(),
		chatId: z.string().uuid(),
		messageId: z.string().uuid(),
		messageTs: DateTimeSchema,
		role: z.enum(["user", "agent", "system"]),
		content: z.string().nullable(),
		tokenCount: z.number().int().nullable(),
		metadata: z.record(z.string(), z.string()),
	})
	.openapi("ChatMessage");

export const ChatMessagePageSchema = pageSchema(
	"ChatMessagePage",
	ChatMessageRecordSchema,
);

/**
 * Body of `POST .../chats/{chatId}/messages`. The runtime always
 * authors the assistant turn (Bobbie); the only thing the caller
 * supplies is the user-typed content.
 */
export const SendChatMessageInputSchema = z
	.object({
		content: z.string().min(1).max(MAX_CHAT_MESSAGE_CHARS),
	})
	.openapi("SendChatMessageInput");

/**
 * Response of `POST .../chats/{chatId}/messages`. Both turns are
 * returned so the UI can replace any optimistic user-message stub
 * with the canonical persisted version, and append Bobbie's reply
 * in one render pass. When the model errors, `assistant.metadata`
 * contains `finish_reason: "error"` and the body is the human-
 * readable failure message.
 */
export const SendChatMessageResponseSchema = z
	.object({
		user: ChatMessageRecordSchema,
		assistant: ChatMessageRecordSchema,
	})
	.openapi("SendChatMessageResponse");

/* ---------- Agents (workspace-scoped) ---------- */

/**
 * Wire-shape for an agent. Mirrors the
 * `wb_agentic_agents_by_workspace` row, minus the `tool_ids` set
 * (no tools are wired in v0; the column stays as future-proofing).
 *
 * The deterministic Bobbie row appears in `listAgents`; clients can
 * recognise it by `name === "Bobbie"` (or by recomputing the
 * deterministic id) and choose to suppress it from "user agents"
 * UIs.
 */
export const AgentRecordSchema = z
	.object({
		workspaceId: z.string().uuid(),
		agentId: z.string().uuid(),
		name: z.string(),
		description: z.string().nullable(),
		systemPrompt: z.string().nullable(),
		userPrompt: z.string().nullable(),
		knowledgeBaseIds: z.array(z.string().uuid()),
		ragEnabled: z.boolean(),
		ragMaxResults: z.number().int().nullable(),
		ragMinScore: z.number().nullable(),
		rerankEnabled: z.boolean(),
		rerankingServiceId: z.string().uuid().nullable(),
		rerankMaxResults: z.number().int().nullable(),
		createdAt: DateTimeSchema,
		updatedAt: DateTimeSchema,
	})
	.openapi("Agent");

export const AgentPageSchema = pageSchema("AgentPage", AgentRecordSchema);

export const CreateAgentInputSchema = z
	.object({
		agentId: z.string().uuid().optional(),
		name: z.string().min(1),
		description: z.string().nullable().optional(),
		systemPrompt: z.string().nullable().optional(),
		userPrompt: z.string().nullable().optional(),
		knowledgeBaseIds: z.array(z.string().uuid()).optional(),
		ragEnabled: z.boolean().optional(),
		ragMaxResults: z.number().int().positive().nullable().optional(),
		ragMinScore: z.number().nullable().optional(),
		rerankEnabled: z.boolean().optional(),
		rerankingServiceId: z.string().uuid().nullable().optional(),
		rerankMaxResults: z.number().int().positive().nullable().optional(),
	})
	.openapi("CreateAgentInput");

export const UpdateAgentInputSchema = z
	.object({
		name: z.string().min(1).optional(),
		description: z.string().nullable().optional(),
		systemPrompt: z.string().nullable().optional(),
		userPrompt: z.string().nullable().optional(),
		knowledgeBaseIds: z.array(z.string().uuid()).optional(),
		ragEnabled: z.boolean().optional(),
		ragMaxResults: z.number().int().positive().nullable().optional(),
		ragMinScore: z.number().nullable().optional(),
		rerankEnabled: z.boolean().optional(),
		rerankingServiceId: z.string().uuid().nullable().optional(),
		rerankMaxResults: z.number().int().positive().nullable().optional(),
	})
	.strict()
	.openapi("UpdateAgentInput");

/* ---------- Conversations (agent-scoped) ---------- */

/**
 * Wire-shape for an agent-scoped conversation. The `/chats` surface
 * uses {@link ChatRecordSchema} (which hides agent_id); the agents
 * surface includes it because callers picked the agent themselves.
 */
export const ConversationRecordSchema = z
	.object({
		workspaceId: z.string().uuid(),
		agentId: z.string().uuid(),
		conversationId: z.string().uuid(),
		title: z.string().nullable(),
		knowledgeBaseIds: z.array(z.string().uuid()),
		createdAt: DateTimeSchema,
	})
	.openapi("Conversation");

export const ConversationPageSchema = pageSchema(
	"ConversationPage",
	ConversationRecordSchema,
);

export const CreateConversationInputSchema = z
	.object({
		conversationId: z.string().uuid().optional(),
		title: z.string().min(1).nullable().optional(),
		knowledgeBaseIds: z.array(z.string().uuid()).optional(),
	})
	.openapi("CreateConversationInput");

export const UpdateConversationInputSchema = z
	.object({
		title: z.string().min(1).nullable().optional(),
		knowledgeBaseIds: z.array(z.string().uuid()).optional(),
	})
	.strict()
	.openapi("UpdateConversationInput");

export const EmbeddingServiceIdParamSchema = z
	.string()
	.uuid()
	.openapi({
		param: { name: "embeddingServiceId", in: "path" },
		example: "11111111-2222-3333-4444-555555555555",
	});

export const RerankingServiceIdParamSchema = z
	.string()
	.uuid()
	.openapi({
		param: { name: "rerankingServiceId", in: "path" },
		example: "11111111-2222-3333-4444-555555555555",
	});

/* ---------- RAG document (KB-scoped) ---------- */

export const RagDocumentRecordSchema = z
	.object({
		workspaceId: z.string().uuid(),
		knowledgeBaseId: z.string().uuid(),
		documentId: z.string().uuid(),
		sourceDocId: z.string().nullable(),
		sourceFilename: z.string().nullable(),
		fileType: z.string().nullable(),
		fileSize: z.number().int().nonnegative().nullable(),
		contentHash: z.string().nullable(),
		chunkTotal: z.number().int().nonnegative().nullable(),
		ingestedAt: DateTimeSchema.nullable(),
		updatedAt: DateTimeSchema,
		status: DocumentStatusSchema,
		errorMessage: z.string().nullable(),
		metadata: z.record(z.string(), z.string()),
	})
	.openapi("RagDocument");

export const RagDocumentPageSchema = pageSchema(
	"RagDocumentPage",
	RagDocumentRecordSchema,
);

export const CreateRagDocumentInputSchema = z
	.object({
		documentId: z.string().uuid().optional(),
		sourceDocId: z.string().nullable().optional(),
		sourceFilename: z.string().nullable().optional(),
		fileType: z.string().nullable().optional(),
		fileSize: z.number().int().nonnegative().nullable().optional(),
		contentHash: z.string().nullable().optional(),
		chunkTotal: z.number().int().nonnegative().nullable().optional(),
		ingestedAt: DateTimeSchema.nullable().optional(),
		status: DocumentStatusSchema.optional(),
		errorMessage: z.string().nullable().optional(),
		metadata: z.record(z.string(), z.string()).optional(),
	})
	.openapi("CreateRagDocumentInput");

export const UpdateRagDocumentInputSchema =
	CreateRagDocumentInputSchema.partial()
		.omit({ documentId: true })
		.openapi("UpdateRagDocumentInput");

/**
 * KB-scoped ingest request. `metadata` reserves `knowledgeBaseId` /
 * `documentId` (the runtime overrides any caller-supplied values
 * with the path-resolved KB and the freshly created document row).
 */
export const KbIngestRequestSchema = z
	.object({
		text: z.string().min(1).max(MAX_INGEST_TEXT_CHARS),
		documentId: z.string().uuid().optional(),
		sourceDocId: z.string().nullable().optional(),
		sourceFilename: z.string().nullable().optional(),
		fileType: z.string().nullable().optional(),
		fileSize: z.number().int().nonnegative().nullable().optional(),
		contentHash: z.string().nullable().optional(),
		metadata: z.record(z.string(), z.string()).optional(),
		chunker: IngestChunkerOptionsSchema.optional(),
	})
	.openapi("KbIngestRequest");

export const KbIngestResponseSchema = z
	.object({
		document: RagDocumentRecordSchema,
		chunks: z.number().int().nonnegative(),
	})
	.openapi("KbIngestResponse");

export const KbAsyncIngestResponseSchema = z
	.object({
		job: JobRecordSchema,
		document: RagDocumentRecordSchema,
	})
	.openapi("KbAsyncIngestResponse");
