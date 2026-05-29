import { z } from "zod";
import type { components } from "./api-types.generated";

// Mirror of the runtime's schemas (see
// runtimes/typescript/src/openapi/schemas.ts). The TS *types* below
// are derived from `api-types.generated.ts` (run `npm run gen:types`
// to refresh from the live OpenAPI spec); the *Zod schemas* are kept
// hand-written because the UI uses them for runtime parsing of
// network responses, where openapi-typescript is types-only.
//
// The drift-detection test in `lib/schemas.test.ts` compares the
// hand-written Zod enums to the generated types so a backend change
// breaks CI even if a developer forgets to rerun `gen:types`.

/**
 * Source of truth for the workspace-kind union, derived from the
 * generated OpenAPI types. The Zod enum below is kept in sync via
 * the schemas.test.ts drift check.
 */
export type WorkspaceKind = components["schemas"]["Workspace"]["kind"];

// No `: z.ZodType<WorkspaceKind>` annotation here — narrowing the
// type erases `.options` from the surface, which the drift test in
// `schemas.test.ts` reads to compare the enum against the generated
// OpenAPI type. The `satisfies` check below preserves the safety
// without shadowing the more-specific `ZodEnum` shape.
export const WorkspaceKindSchema = z.enum([
	"astra",
	"hcd",
	"openrag",
	"mock",
]) satisfies z.ZodType<WorkspaceKind>;

// Provider portion follows RFC 3986 URI-scheme syntax — lowercase letter
// followed by lowercase letters, digits, `+`, `-`, or `.`. The path is
// everything after the FIRST colon, so providers like
// `astra-cli:<profile>:<dbId>:token` are accepted (`-` in the provider,
// further colons inside the path).
export const SecretRefSchema = z
	.string()
	.regex(
		/^[a-z][a-z0-9+.-]*:.+$/,
		"Expected '<provider>:<path>', e.g. 'env:FOO'",
	);

const EndpointInputSchema = z
	.union([z.string().url(), SecretRefSchema, z.literal("")])
	.nullable()
	.optional();

// `nullish()` and `default({})` are deliberate: older runtime rows
// (Astra control plane in particular) sometimes omit url/keyspace
// or credentials entirely, and JSON serialization drops `undefined`,
// so the UI sees the field missing. Treat missing the same as null
// here — the runtime test pins what the runtime *should* send,
// while the UI is robust to anything in the wild.
export const WorkspaceRecordSchema = z.object({
	workspaceId: z.string().uuid(),
	name: z.string(),
	url: z
		.string()
		.nullish()
		.transform((v) => v ?? null),
	kind: WorkspaceKindSchema,
	credentials: z.record(z.string(), z.string()).default({}),
	keyspace: z
		.string()
		.nullish()
		.transform((v) => v ?? null),
	// RLAC master switch. Legacy rows back-compat to `false`.
	rlacEnabled: z.boolean().default(false),
	createdAt: z.string(),
	updatedAt: z.string(),
});
export type Workspace = z.infer<typeof WorkspaceRecordSchema>;
export const WorkspacePageSchema = paginatedSchema(WorkspaceRecordSchema);

export const CreateWorkspaceSchema = z.object({
	name: z.string().min(1, "Name is required"),
	kind: WorkspaceKindSchema,
	url: EndpointInputSchema,
	keyspace: z.string().or(z.literal("")).nullable().optional(),
	credentials: z.record(z.string(), SecretRefSchema).optional(),
});
export type CreateWorkspaceInput = z.infer<typeof CreateWorkspaceSchema>;

export const UpdateWorkspaceSchema = z.object({
	name: z.string().min(1, "Name is required").optional(),
	url: EndpointInputSchema,
	keyspace: z.string().or(z.literal("")).nullable().optional(),
	credentials: z.record(z.string(), SecretRefSchema).optional(),
	rlacEnabled: z.boolean().optional(),
});
export type UpdateWorkspaceInput = z.infer<typeof UpdateWorkspaceSchema>;

export const ErrorEnvelopeSchema = z.object({
	error: z.object({
		code: z.string(),
		message: z.string(),
		requestId: z.string(),
	}),
});
export type ErrorEnvelope = z.infer<typeof ErrorEnvelopeSchema>;

function paginatedSchema<T extends z.ZodTypeAny>(item: T) {
	return z.object({
		items: z.array(item),
		nextCursor: z.string().nullable(),
	});
}

export const TestConnectionResultSchema = z.object({
	ok: z.boolean(),
	kind: WorkspaceKindSchema,
	details: z.string(),
});
export type TestConnectionResult = z.infer<typeof TestConnectionResultSchema>;

// Kept in sync with the generated OpenAPI `ApiKeyScope` enum via the
// drift check in `schemas.test.ts`. `manage` (0.4.0) is the admin tier
// — keys minted with it can hit API-key / principal / RLAC routes.
export const ApiKeyScopeSchema = z.enum(["read", "write", "manage"]);
export type ApiKeyScope = z.infer<typeof ApiKeyScopeSchema>;

export const ApiKeyRecordSchema = z.object({
	workspaceId: z.string().uuid(),
	keyId: z.string().uuid(),
	prefix: z.string(),
	label: z.string(),
	// Server back-compats older rows to `["read","write"]`, so this is
	// always populated on the wire. UI renders one badge per entry.
	scopes: z.array(ApiKeyScopeSchema).default(["read", "write"]),
	createdAt: z.string(),
	lastUsedAt: z.string().nullable(),
	revokedAt: z.string().nullable(),
	expiresAt: z.string().nullable(),
});
export type ApiKeyRecord = z.infer<typeof ApiKeyRecordSchema>;
export const ApiKeyPageSchema = paginatedSchema(ApiKeyRecordSchema);

export const CreateApiKeyInputSchema = z.object({
	label: z
		.string()
		.min(1, "Label is required")
		.max(120, "Label must be at most 120 characters"),
	expiresAt: z.string().datetime().nullable().optional(),
	scopes: z
		.array(ApiKeyScopeSchema)
		.min(1, "Pick at least one scope when supplying the field")
		.optional(),
});
export type CreateApiKeyInput = z.infer<typeof CreateApiKeyInputSchema>;

export const CreatedApiKeyResponseSchema = z.object({
	plaintext: z.string(),
	key: ApiKeyRecordSchema,
});
export type CreatedApiKeyResponse = z.infer<typeof CreatedApiKeyResponseSchema>;

export const PlaygroundCommandNameSchema = z.enum([
	"findCollections",
	"createCollection",
	"deleteCollection",
	"listTables",
	"createTable",
	"dropTable",
	"createIndex",
	"createTextIndex",
	"createVectorIndex",
	"listIndexes",
	"dropIndex",
	"find",
	"findOne",
	"distinct",
	"insertOne",
	"insertMany",
	"updateOne",
	"updateMany",
	"deleteOne",
	"deleteMany",
	"countDocuments",
]);
export type PlaygroundCommandName = z.infer<typeof PlaygroundCommandNameSchema>;

export const PlaygroundTargetKindSchema = z.enum(["collection", "table"]);
export type PlaygroundTargetKind = z.infer<typeof PlaygroundTargetKindSchema>;

export const PlaygroundCommandInputSchema = z.object({
	commandName: PlaygroundCommandNameSchema,
	targetKind: PlaygroundTargetKindSchema.optional(),
	collection: z.string().min(1).max(128).nullable().optional(),
	table: z.string().min(1).max(128).nullable().optional(),
	command: z.record(z.string(), z.unknown()),
});
export type PlaygroundCommandInput = z.infer<
	typeof PlaygroundCommandInputSchema
>;

export const PlaygroundCommandResponseSchema = z.object({
	ok: z.literal(true),
	commandName: PlaygroundCommandNameSchema,
	targetKind: PlaygroundTargetKindSchema,
	targetName: z.string().nullable(),
	collection: z.string().nullable(),
	table: z.string().nullable(),
	keyspace: z.string().nullable(),
	command: z.record(z.string(), z.unknown()),
	result: z.unknown(),
	elapsedMs: z.number().int().nonnegative(),
});
export type PlaygroundCommandResponse = z.infer<
	typeof PlaygroundCommandResponseSchema
>;

/* ---------------- Knowledge bases ---------------- */

export const KnowledgeBaseStatusSchema = z.enum([
	"active",
	"draft",
	"deprecated",
]);
export type KnowledgeBaseStatus = z.infer<typeof KnowledgeBaseStatusSchema>;

export const ServiceStatusSchema = z.enum([
	"active",
	"deprecated",
	"experimental",
]);
export type ServiceStatus = z.infer<typeof ServiceStatusSchema>;

export const DistanceMetricSchema = z.enum(["cosine", "dot", "euclidean"]);
export type DistanceMetric = z.infer<typeof DistanceMetricSchema>;

export const AuthTypeSchema = z.enum(["none", "api_key", "oauth2", "mTLS"]);
export type AuthType = z.infer<typeof AuthTypeSchema>;

export const LexicalConfigSchema = z.object({
	enabled: z.boolean(),
	analyzer: z.string().nullable(),
	options: z.record(z.string(), z.string()),
});
export type LexicalConfig = z.infer<typeof LexicalConfigSchema>;

export const KnowledgeBaseRecordSchema = z.object({
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
	owned: z.boolean(),
	lexical: LexicalConfigSchema,
	// RLAC fields. Nullable for legacy KBs that were created before
	// the prototype landed.
	policyDsl: z.string().nullable(),
	policyEnabled: z.boolean(),
	createdAt: z.string(),
	updatedAt: z.string(),
});
export type KnowledgeBaseRecord = z.infer<typeof KnowledgeBaseRecordSchema>;
export const KnowledgeBasePageSchema = paginatedSchema(
	KnowledgeBaseRecordSchema,
);

// Mirrors the server-side KB-name rule (Astra collection-name regex).
// Owned KBs use the name as the underlying collection identifier.
const KB_NAME_REGEX = /^[A-Za-z][A-Za-z0-9_]{0,47}$/;

export const CreateKnowledgeBaseInputSchema = z.object({
	name: z
		.string()
		.min(1, "Name is required")
		.regex(
			KB_NAME_REGEX,
			"Use letters, digits, and underscores only (start with a letter, max 48 chars)",
		),
	description: z.string().or(z.literal("")).nullable().optional(),
	embeddingServiceId: z.string().uuid("Pick an embedding service"),
	chunkingServiceId: z.string().uuid("Pick a chunking service"),
	rerankingServiceId: z.string().uuid().nullable().optional(),
	language: z.string().or(z.literal("")).nullable().optional(),
	attach: z.boolean().optional(),
	vectorCollection: z.string().nullable().optional(),
});
export type CreateKnowledgeBaseInput = z.infer<
	typeof CreateKnowledgeBaseInputSchema
>;

export const AdoptableCollectionSchema = z.object({
	name: z.string(),
	vectorDimension: z.number().int().positive(),
	vectorSimilarity: DistanceMetricSchema,
	vectorService: z
		.object({ provider: z.string(), modelName: z.string() })
		.nullable(),
	lexicalEnabled: z.boolean(),
	rerankEnabled: z.boolean(),
	attached: z.boolean(),
});
export type AdoptableCollection = z.infer<typeof AdoptableCollectionSchema>;
export const AdoptableCollectionListSchema = z.object({
	items: z.array(AdoptableCollectionSchema),
});

// `name` is intentionally absent — it doubles as the underlying
// collection identifier on owned KBs and Astra collections cannot be
// renamed.
export const UpdateKnowledgeBaseInputSchema = z.object({
	description: z.string().or(z.literal("")).nullable().optional(),
	status: KnowledgeBaseStatusSchema.optional(),
	rerankingServiceId: z.string().uuid().nullable().optional(),
	language: z.string().or(z.literal("")).nullable().optional(),
	policyDsl: z.string().nullable().optional(),
	policyEnabled: z.boolean().optional(),
});
export type UpdateKnowledgeBaseInput = z.infer<
	typeof UpdateKnowledgeBaseInputSchema
>;

export const KnowledgeFilterRecordSchema = z.object({
	workspaceId: z.string().uuid(),
	knowledgeBaseId: z.string().uuid(),
	knowledgeFilterId: z.string().uuid(),
	name: z.string(),
	description: z.string().nullable(),
	filter: z.record(z.string(), z.unknown()),
	createdAt: z.string(),
	updatedAt: z.string(),
});
export type KnowledgeFilterRecord = z.infer<typeof KnowledgeFilterRecordSchema>;
export const KnowledgeFilterPageSchema = paginatedSchema(
	KnowledgeFilterRecordSchema,
);

export const CreateKnowledgeFilterInputSchema = z.object({
	name: z.string().min(1, "Name is required"),
	description: z.string().or(z.literal("")).nullable().optional(),
	filter: z.record(z.string(), z.unknown()),
});
export type CreateKnowledgeFilterInput = z.infer<
	typeof CreateKnowledgeFilterInputSchema
>;

export const UpdateKnowledgeFilterInputSchema =
	CreateKnowledgeFilterInputSchema.partial();
export type UpdateKnowledgeFilterInput = z.infer<
	typeof UpdateKnowledgeFilterInputSchema
>;

/* ---------------- Execution services ---------------- */

const ServiceEndpointFields = {
	endpointBaseUrl: z.string().nullable(),
	endpointPath: z.string().nullable(),
	requestTimeoutMs: z.number().int().nonnegative().nullable(),
	authType: AuthTypeSchema,
	credentialRef: z.string().nullable(),
};

export const ChunkingServiceRecordSchema = z.object({
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
	maxPayloadSizeKb: z.number().int().nullable(),
	enableOcr: z.boolean().nullable(),
	extractTables: z.boolean().nullable(),
	extractFigures: z.boolean().nullable(),
	readingOrder: z.string().nullable(),
	...ServiceEndpointFields,
	createdAt: z.string(),
	updatedAt: z.string(),
});
export type ChunkingServiceRecord = z.infer<typeof ChunkingServiceRecordSchema>;
export const ChunkingServicePageSchema = paginatedSchema(
	ChunkingServiceRecordSchema,
);

export const CreateChunkingServiceInputSchema = z.object({
	name: z.string().min(1),
	description: z.string().or(z.literal("")).nullable().optional(),
	engine: z.string().min(1, "Engine is required"),
	engineVersion: z.string().or(z.literal("")).nullable().optional(),
	strategy: z.string().or(z.literal("")).nullable().optional(),
	maxChunkSize: z.number().int().positive().nullable().optional(),
	minChunkSize: z.number().int().nonnegative().nullable().optional(),
	chunkUnit: z.string().or(z.literal("")).nullable().optional(),
	overlapSize: z.number().int().nonnegative().nullable().optional(),
	overlapUnit: z.string().or(z.literal("")).nullable().optional(),
	preserveStructure: z.boolean().nullable().optional(),
	language: z.string().or(z.literal("")).nullable().optional(),
});
export type CreateChunkingServiceInput = z.infer<
	typeof CreateChunkingServiceInputSchema
>;

export const UpdateChunkingServiceInputSchema =
	CreateChunkingServiceInputSchema.partial().strict();
export type UpdateChunkingServiceInput = z.infer<
	typeof UpdateChunkingServiceInputSchema
>;

export const EmbeddingServiceRecordSchema = z.object({
	workspaceId: z.string().uuid(),
	embeddingServiceId: z.string().uuid(),
	name: z.string(),
	description: z.string().nullable(),
	status: ServiceStatusSchema,
	provider: z.string(),
	modelName: z.string(),
	embeddingDimension: z.number().int().positive(),
	distanceMetric: DistanceMetricSchema,
	maxBatchSize: z.number().int().nullable(),
	maxInputTokens: z.number().int().nullable(),
	supportedLanguages: z.array(z.string()),
	supportedContent: z.array(z.string()),
	...ServiceEndpointFields,
	createdAt: z.string(),
	updatedAt: z.string(),
});
export type EmbeddingServiceRecord = z.infer<
	typeof EmbeddingServiceRecordSchema
>;
export const EmbeddingServicePageSchema = paginatedSchema(
	EmbeddingServiceRecordSchema,
);

export const CreateEmbeddingServiceInputSchema = z.object({
	name: z.string().min(1),
	description: z.string().or(z.literal("")).nullable().optional(),
	provider: z.string().min(1),
	modelName: z.string().min(1),
	embeddingDimension: z.number().int().positive(),
	distanceMetric: DistanceMetricSchema.optional(),
	endpointBaseUrl: z.string().or(z.literal("")).nullable().optional(),
	authType: AuthTypeSchema.optional(),
	credentialRef: z.string().or(z.literal("")).nullable().optional(),
});
export type CreateEmbeddingServiceInput = z.infer<
	typeof CreateEmbeddingServiceInputSchema
>;

export const UpdateEmbeddingServiceInputSchema =
	CreateEmbeddingServiceInputSchema.partial().strict();
export type UpdateEmbeddingServiceInput = z.infer<
	typeof UpdateEmbeddingServiceInputSchema
>;

export const RerankingServiceRecordSchema = z.object({
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
	maxBatchSize: z.number().int().nullable(),
	supportedLanguages: z.array(z.string()),
	supportedContent: z.array(z.string()),
	...ServiceEndpointFields,
	createdAt: z.string(),
	updatedAt: z.string(),
});
export type RerankingServiceRecord = z.infer<
	typeof RerankingServiceRecordSchema
>;
export const RerankingServicePageSchema = paginatedSchema(
	RerankingServiceRecordSchema,
);

export const CreateRerankingServiceInputSchema = z.object({
	name: z.string().min(1),
	description: z.string().or(z.literal("")).nullable().optional(),
	provider: z.string().min(1),
	modelName: z.string().min(1),
});
export type CreateRerankingServiceInput = z.infer<
	typeof CreateRerankingServiceInputSchema
>;

export const UpdateRerankingServiceInputSchema =
	CreateRerankingServiceInputSchema.partial().strict();
export type UpdateRerankingServiceInput = z.infer<
	typeof UpdateRerankingServiceInputSchema
>;

/* ---------------- RAG documents (KB-scoped) ---------------- */

export const DocumentStatusSchema = z.enum([
	"pending",
	"chunking",
	"embedding",
	"writing",
	"ready",
	"failed",
]);
export type DocumentStatus = z.infer<typeof DocumentStatusSchema>;

export const RagDocumentRecordSchema = z.object({
	workspaceId: z.string().uuid(),
	knowledgeBaseId: z.string().uuid(),
	documentId: z.string().uuid(),
	sourceDocId: z.string().nullable(),
	sourceFilename: z.string().nullable(),
	fileType: z.string().nullable(),
	fileSize: z.number().int().nonnegative().nullable(),
	contentHash: z.string().nullable(),
	chunkTotal: z.number().int().nonnegative().nullable(),
	ingestedAt: z.string().nullable(),
	updatedAt: z.string(),
	status: DocumentStatusSchema,
	errorMessage: z.string().nullable(),
	metadata: z.record(z.string(), z.string()),
	// RLAC fields. Nullable for legacy / pre-RLAC rows.
	visibleTo: z.array(z.string()).nullable(),
	ownerPrincipalId: z.string().nullable(),
});
export type RagDocumentRecord = z.infer<typeof RagDocumentRecordSchema>;
export const RagDocumentPageSchema = paginatedSchema(RagDocumentRecordSchema);

export const DocumentChunkSchema = z.object({
	id: z.string(),
	chunkIndex: z.number().int().nonnegative().nullable(),
	text: z.string().nullable(),
	payload: z.record(z.string(), z.unknown()),
});
export type DocumentChunk = z.infer<typeof DocumentChunkSchema>;

/* ---------------- Jobs ---------------- */

export const JobStatusSchema = z.enum([
	"pending",
	"running",
	"succeeded",
	"failed",
]);
export type JobStatus = z.infer<typeof JobStatusSchema>;

export const JobRecordSchema = z.object({
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
	createdAt: z.string(),
	updatedAt: z.string(),
});
export type JobRecord = z.infer<typeof JobRecordSchema>;

/* ---------------- Ingest ---------------- */

export const IngestChunkerOptionsSchema = z.object({
	maxChars: z.number().int().positive().optional(),
	minChars: z.number().int().nonnegative().optional(),
	overlapChars: z.number().int().nonnegative().optional(),
});
export type IngestChunkerOptions = z.infer<typeof IngestChunkerOptionsSchema>;

export const KbIngestRequestSchema = z.object({
	text: z.string().min(1, "Content is required"),
	sourceFilename: z.string().nullable().optional(),
	fileType: z.string().nullable().optional(),
	fileSize: z.number().int().nonnegative().nullable().optional(),
	contentHash: z.string().nullable().optional(),
	metadata: z.record(z.string(), z.string()).optional(),
	chunker: IngestChunkerOptionsSchema.optional(),
	/**
	 * When true, an existing document with the same `sourceFilename`
	 * but a different content hash is cascade-deleted before this
	 * ingest runs. The queue UI sets this on the retry call after the
	 * user picks "Overwrite" in the name-conflict prompt; omit (or
	 * `false`) for the initial pass so the server can detect the
	 * conflict and surface a 200 `name_conflict` response for the
	 * client to prompt on.
	 */
	overwriteOnNameConflict: z.boolean().optional(),
});
export type KbIngestRequest = z.infer<typeof KbIngestRequestSchema>;

/* ---------------- Astra Data API call snapshots ----------------
 *
 * Defined here (above the ingest + KB-create response schemas)
 * because those schemas embed `AstraQuerySnapshotSchema` in their
 * shape; Zod's `z.object({...})` is evaluated eagerly so the union
 * has to exist by the time the consumers are constructed.
 *
 * See the source-of-truth `runtimes/typescript/src/snapshots/types.ts`
 * for the documented intent of each kind — this block keeps the Zod
 * shape in lockstep.
 */
const AstraSnapshotEnvelopeShape = {
	knowledgeBaseId: z.string(),
	kbName: z.string(),
	collection: z.string(),
	keyspace: z.string().nullable(),
} as const;

const AstraVectorSearchSnapshotSchema = z.object({
	kind: z.literal("vector_search"),
	...AstraSnapshotEnvelopeShape,
	query: z.object({
		text: z.string(),
		topK: z.number().int().positive(),
	}),
});

const AstraListChunksSnapshotSchema = z.object({
	kind: z.literal("list_chunks"),
	...AstraSnapshotEnvelopeShape,
	query: z.object({
		documentId: z.string(),
		limit: z.number().int().positive(),
		offset: z.number().int().nonnegative(),
	}),
});

const AstraCreateCollectionSnapshotSchema = z.object({
	kind: z.literal("create_collection"),
	...AstraSnapshotEnvelopeShape,
	options: z.object({
		vectorDimension: z.number().int().positive(),
		vectorMetric: z.enum(["cosine", "dot_product", "euclidean"]),
		vectorize: z
			.object({
				provider: z.string(),
				modelName: z.string(),
			})
			.nullable(),
		lexical: z
			.object({
				enabled: z.literal(true),
				analyzer: z.string(),
			})
			.nullable(),
		rerank: z
			.object({
				enabled: z.literal(true),
				provider: z.string(),
				modelName: z.string(),
			})
			.nullable(),
	}),
});

const AstraInsertChunksSnapshotSchema = z.object({
	kind: z.literal("insert_chunks"),
	...AstraSnapshotEnvelopeShape,
	batch: z.object({
		documentId: z.string(),
		batchSize: z.number().int().positive(),
	}),
});

const AstraDeleteByDocumentSnapshotSchema = z.object({
	kind: z.literal("delete_by_document"),
	...AstraSnapshotEnvelopeShape,
	filter: z.object({
		documentId: z.string(),
	}),
});

const AstraDeleteChunkSnapshotSchema = z.object({
	kind: z.literal("delete_chunk"),
	...AstraSnapshotEnvelopeShape,
	filter: z.object({
		chunkId: z.string(),
	}),
});

export const AstraQuerySnapshotSchema = z.discriminatedUnion("kind", [
	AstraVectorSearchSnapshotSchema,
	AstraListChunksSnapshotSchema,
	AstraCreateCollectionSnapshotSchema,
	AstraInsertChunksSnapshotSchema,
	AstraDeleteByDocumentSnapshotSchema,
	AstraDeleteChunkSnapshotSchema,
]);
export type AstraQuerySnapshot = z.infer<typeof AstraQuerySnapshotSchema>;
export type AstraVectorSearchSnapshot = z.infer<
	typeof AstraVectorSearchSnapshotSchema
>;
export type AstraListChunksSnapshot = z.infer<
	typeof AstraListChunksSnapshotSchema
>;
export type AstraCreateCollectionSnapshot = z.infer<
	typeof AstraCreateCollectionSnapshotSchema
>;
export type AstraInsertChunksSnapshot = z.infer<
	typeof AstraInsertChunksSnapshotSchema
>;
export type AstraDeleteByDocumentSnapshot = z.infer<
	typeof AstraDeleteByDocumentSnapshotSchema
>;
export type AstraDeleteChunkSnapshot = z.infer<
	typeof AstraDeleteChunkSnapshotSchema
>;

export const KbAsyncIngestResponseSchema = z.object({
	job: JobRecordSchema,
	document: RagDocumentRecordSchema,
	/** One `insert_chunks` snapshot for Astra/HCD workspaces — the
	 * representative `coll.insertMany(...)` call the background
	 * pipeline runs once per chunk batch. Empty for non-Astra
	 * workspaces. Surfaced eagerly at queue-time so the queue dialog
	 * can show the call before the job finishes. Defaults to `[]` so
	 * clients on older runtimes that don't return the field keep
	 * working through `.parse()`. */
	astraQueries: z.array(AstraQuerySnapshotSchema).default([]),
});
export type KbAsyncIngestResponse = z.infer<typeof KbAsyncIngestResponseSchema>;

/**
 * Response when an ingest call's content (SHA-256 of the body text)
 * matches an existing document in the same KB. Pipeline does NOT
 * run; the existing document comes back verbatim. Distinguished from
 * `KbAsyncIngestResponse` by the literal `outcome: "duplicate"` field
 * + the absence of `job` — discriminated unions all the way through
 * the queue UI.
 */
export const KbIngestDuplicateResponseSchema = z.object({
	document: RagDocumentRecordSchema,
	outcome: z.literal("duplicate"),
});
export type KbIngestDuplicateResponse = z.infer<
	typeof KbIngestDuplicateResponseSchema
>;

/**
 * Response when an ingest's `sourceFilename` matches an existing
 * document but the content hash differs and the caller did NOT set
 * `overwriteOnNameConflict: true`. The pipeline did not run; the
 * existing document comes back so the queue UI can show the user
 * what's about to be replaced. Expected client follow-up: prompt
 * the user, then either re-call with the overwrite flag set or
 * skip the file.
 */
export const KbIngestNameConflictResponseSchema = z.object({
	document: RagDocumentRecordSchema,
	outcome: z.literal("name_conflict"),
});
export type KbIngestNameConflictResponse = z.infer<
	typeof KbIngestNameConflictResponseSchema
>;

/**
 * Discriminated union of every shape `POST .../ingest` (sync or
 * async) can return. Three arms:
 *   - 202 / 201 success: `{ job, document }` — pipeline running
 *     (async) or just finished (sync).
 *   - 200 duplicate: `{ document, outcome: "duplicate" }` — content
 *     hash collision, the existing doc is returned.
 *   - 200 name_conflict: `{ document, outcome: "name_conflict" }`
 *     — filename collision with different content; client must
 *     prompt and re-issue with `overwriteOnNameConflict: true` to
 *     replace, or skip.
 */
export const KbIngestAsyncOrDuplicateSchema = z.union([
	KbAsyncIngestResponseSchema,
	KbIngestDuplicateResponseSchema,
	KbIngestNameConflictResponseSchema,
]);
export type KbIngestAsyncOrDuplicate = z.infer<
	typeof KbIngestAsyncOrDuplicateSchema
>;

/* ---------------- Agents + conversations (workspace-scoped) ---------------- */

// Use `.nullish()` (= nullable + optional) on every nullable field so
// agent rows persisted before this branch (file driver, legacy Bobbie
// rows) don't fail validation when fields haven't been backfilled.
// JSON.stringify drops `undefined`, so a missing-column path lands here
// as the field being absent rather than explicitly null.
export const AgentRecordSchema = z.object({
	workspaceId: z.string().uuid(),
	agentId: z.string().uuid(),
	name: z.string(),
	description: z.string().nullish(),
	systemPrompt: z.string().nullish(),
	userPrompt: z.string().nullish(),
	llmServiceId: z.string().uuid().nullish(),
	knowledgeBaseIds: z.array(z.string().uuid()).default([]),
	// Per-agent tool allow-list (0.4.0). Empty → all built-in tools
	// (grandfathered). `default([])` keeps older wire records (pre-toolIds)
	// parsing cleanly.
	toolIds: z.array(z.string()).default([]),
	rerankEnabled: z.boolean(),
	rerankingServiceId: z.string().uuid().nullish(),
	rerankMaxResults: z.number().int().nullish(),
	createdAt: z.string(),
	updatedAt: z.string(),
});
export type AgentRecord = z.infer<typeof AgentRecordSchema>;
export const AgentPageSchema = paginatedSchema(AgentRecordSchema);

export const CreateAgentInputSchema = z.object({
	agentId: z.string().uuid().optional(),
	name: z.string().min(1, "Name is required"),
	description: z.string().nullable().optional(),
	systemPrompt: z.string().nullable().optional(),
	userPrompt: z.string().nullable().optional(),
	llmServiceId: z.string().uuid().nullable().optional(),
	knowledgeBaseIds: z.array(z.string().uuid()).optional(),
	toolIds: z.array(z.string().min(1)).optional(),
	rerankEnabled: z.boolean().optional(),
	rerankingServiceId: z.string().uuid().nullable().optional(),
	rerankMaxResults: z.number().int().positive().nullable().optional(),
});
export type CreateAgentInput = z.infer<typeof CreateAgentInputSchema>;

export const UpdateAgentInputSchema = z
	.object({
		name: z.string().min(1).optional(),
		description: z.string().nullable().optional(),
		systemPrompt: z.string().nullable().optional(),
		userPrompt: z.string().nullable().optional(),
		llmServiceId: z.string().uuid().nullable().optional(),
		knowledgeBaseIds: z.array(z.string().uuid()).optional(),
		toolIds: z.array(z.string().min(1)).optional(),
		rerankEnabled: z.boolean().optional(),
		rerankingServiceId: z.string().uuid().nullable().optional(),
		rerankMaxResults: z.number().int().positive().nullable().optional(),
	})
	.strict();
export type UpdateAgentInput = z.infer<typeof UpdateAgentInputSchema>;

/**
 * Source of a selectable tool, derived from the generated OpenAPI type.
 * The Zod enum below is kept in sync via the schemas.test.ts drift check
 * (mirrors the WorkspaceKind / ApiKeyScope pattern).
 */
export type ToolSource = components["schemas"]["AvailableTool"]["source"];

export const ToolSourceSchema = z.enum([
	"builtin",
	"native",
	"astra",
	"mcp",
]) satisfies z.ZodType<ToolSource>;

/**
 * One selectable entry in the agent-form tool picker, from
 * `GET .../available-tools`. `id` is the namespaced tool id an agent
 * lists in its `toolIds` allow-list.
 */
export const AvailableToolSchema = z.object({
	id: z.string(),
	description: z.string(),
	source: ToolSourceSchema,
});
export type AvailableTool = z.infer<typeof AvailableToolSchema>;

export const AvailableToolListSchema = z.object({
	items: z.array(AvailableToolSchema),
});

/**
 * Agent template catalog entry. Static runtime data — `templateId` is
 * a stable lowercase-kebab slug, not a UUID. Backed by ADR 0003 on
 * the runtime side.
 */
export const AgentTemplateSchema = z.object({
	templateId: z.string().min(1),
	name: z.string().min(1),
	description: z.string(),
	persona: z.string(),
	systemPrompt: z.string(),
	defaultOnNewWorkspace: z.boolean(),
});
export type AgentTemplate = z.infer<typeof AgentTemplateSchema>;

export const AgentTemplateListSchema = z.object({
	items: z.array(AgentTemplateSchema),
});

export const CreateAgentFromTemplateInputSchema = z
	.object({
		templateId: z.string().min(1),
	})
	.strict();
export type CreateAgentFromTemplateInput = z.infer<
	typeof CreateAgentFromTemplateInputSchema
>;

export const ConversationRecordSchema = z.object({
	workspaceId: z.string().uuid(),
	agentId: z.string().uuid(),
	conversationId: z.string().uuid(),
	title: z.string().nullable(),
	knowledgeBaseIds: z.array(z.string().uuid()),
	createdAt: z.string(),
});
export type ConversationRecord = z.infer<typeof ConversationRecordSchema>;
export const ConversationPageSchema = paginatedSchema(ConversationRecordSchema);

export const CreateConversationInputSchema = z.object({
	conversationId: z.string().uuid().optional(),
	title: z.string().min(1).nullable().optional(),
	knowledgeBaseIds: z.array(z.string().uuid()).optional(),
});
export type CreateConversationInput = z.infer<
	typeof CreateConversationInputSchema
>;

export const UpdateConversationInputSchema = z
	.object({
		title: z.string().min(1).nullable().optional(),
		knowledgeBaseIds: z.array(z.string().uuid()).optional(),
	})
	.strict();
export type UpdateConversationInput = z.infer<
	typeof UpdateConversationInputSchema
>;

/* ---------------- Chat messages (agent-conversation-scoped) ---------------- */

// Note: the wire field is still named `chatId` — it carries the
// conversationId (see runtime `toChatMessageWire`). The UI keeps the
// `chatId` field name on the wire shape to match the backend, but
// every reference is to a conversation, not a Bobbie chat row.

export const ChatMessageRoleSchema = z.enum(["user", "agent", "system"]);
export type ChatMessageRole = z.infer<typeof ChatMessageRoleSchema>;

export const ChatMessageRecordSchema = z.object({
	workspaceId: z.string().uuid(),
	chatId: z.string().uuid(),
	messageId: z.string().uuid(),
	messageTs: z.string(),
	role: ChatMessageRoleSchema,
	content: z.string().nullable(),
	tokenCount: z.number().int().nullable(),
	metadata: z.record(z.string(), z.string()).default({}),
});
export type ChatMessage = z.infer<typeof ChatMessageRecordSchema>;
export const ChatMessagePageSchema = paginatedSchema(ChatMessageRecordSchema);

/**
 * KB-create response. Sibling `astraQueries` field carries the
 * `create_collection` snapshot the runtime made on the user's behalf
 * (empty for attach mode and non-Astra workspaces). The dialog
 * surfaces it on the post-create success state so the user can copy
 * the actual Data API call.
 *
 * Defined here (rather than next to `KnowledgeBaseRecordSchema`)
 * because it composes the snapshot union declared above; Zod schema
 * declarations are eagerly evaluated, so the order matters.
 */
export const KnowledgeBaseCreateResponseSchema =
	KnowledgeBaseRecordSchema.extend({
		astraQueries: z.array(AstraQuerySnapshotSchema),
	});
export type KnowledgeBaseCreateResponse = z.infer<
	typeof KnowledgeBaseCreateResponseSchema
>;

export const SendChatMessageSchema = z.object({
	content: z.string().min(1, "Type a message"),
});
export type SendChatMessageInput = z.infer<typeof SendChatMessageSchema>;

/** Response shape: both turns persisted by the runtime. */
export const SendChatMessageResponseSchema = z.object({
	user: ChatMessageRecordSchema,
	assistant: ChatMessageRecordSchema,
});
export type SendChatMessageResponse = z.infer<
	typeof SendChatMessageResponseSchema
>;

/* ---------------- LLM services (workspace-scoped) ---------------- */

export const LlmServiceRecordSchema = z.object({
	workspaceId: z.string().uuid(),
	llmServiceId: z.string().uuid(),
	name: z.string(),
	description: z.string().nullable(),
	status: ServiceStatusSchema,
	provider: z.string(),
	engine: z.string().nullable(),
	modelName: z.string(),
	modelVersion: z.string().nullable(),
	contextWindowTokens: z.number().int().nullable(),
	maxOutputTokens: z.number().int().nullable(),
	temperatureMin: z.number().nullable(),
	temperatureMax: z.number().nullable(),
	supportsStreaming: z.boolean().nullable(),
	supportsTools: z.boolean().nullable(),
	endpointBaseUrl: z.string().nullable(),
	endpointPath: z.string().nullable(),
	requestTimeoutMs: z.number().int().nullable(),
	maxBatchSize: z.number().int().nullable(),
	authType: AuthTypeSchema,
	credentialRef: z.string().nullable(),
	supportedLanguages: z.array(z.string()),
	supportedContent: z.array(z.string()),
	createdAt: z.string(),
	updatedAt: z.string(),
});
export type LlmServiceRecord = z.infer<typeof LlmServiceRecordSchema>;

/** One selectable chat model from `GET /api/v1/llm-models`. */
export const LlmModelSchema = z.object({
	id: z.string(),
	name: z.string(),
	supportsTools: z.boolean().nullable(),
	recommended: z.boolean(),
});
export type LlmModel = z.infer<typeof LlmModelSchema>;

/** Response of `GET /api/v1/llm-models`. */
export const LlmModelListSchema = z.object({
	provider: z.string(),
	source: z.enum(["live", "fallback"]),
	models: z.array(LlmModelSchema),
});
export type LlmModelList = z.infer<typeof LlmModelListSchema>;
export const LlmServicePageSchema = paginatedSchema(LlmServiceRecordSchema);

export const CreateLlmServiceInputSchema = z.object({
	llmServiceId: z.string().uuid().optional(),
	name: z.string().min(1, "Name is required"),
	description: z.string().nullable().optional(),
	status: ServiceStatusSchema.optional(),
	provider: z.string().min(1, "Provider is required"),
	engine: z.string().nullable().optional(),
	modelName: z.string().min(1, "Model name is required"),
	modelVersion: z.string().nullable().optional(),
	contextWindowTokens: z.number().int().positive().nullable().optional(),
	maxOutputTokens: z.number().int().positive().nullable().optional(),
	temperatureMin: z.number().nullable().optional(),
	temperatureMax: z.number().nullable().optional(),
	supportsStreaming: z.boolean().nullable().optional(),
	supportsTools: z.boolean().nullable().optional(),
	endpointBaseUrl: z.string().nullable().optional(),
	endpointPath: z.string().nullable().optional(),
	requestTimeoutMs: z.number().int().positive().nullable().optional(),
	maxBatchSize: z.number().int().positive().nullable().optional(),
	authType: AuthTypeSchema.optional(),
	credentialRef: z.string().nullable().optional(),
	supportedLanguages: z.array(z.string()).optional(),
	supportedContent: z.array(z.string()).optional(),
});
export type CreateLlmServiceInput = z.infer<typeof CreateLlmServiceInputSchema>;

export const UpdateLlmServiceInputSchema = CreateLlmServiceInputSchema.partial()
	.omit({ llmServiceId: true })
	.strict();
export type UpdateLlmServiceInput = z.infer<typeof UpdateLlmServiceInputSchema>;

/* ---------------- astra-cli auto-detection ---------------- */

export const AstraCliInfoSchema = z.discriminatedUnion("detected", [
	z.object({
		detected: z.literal(true),
		profile: z.string(),
		database: z.object({
			id: z.string(),
			name: z.string(),
			region: z.string(),
			endpoint: z.string().url(),
			keyspace: z.string().nullable(),
		}),
	}),
	z.object({
		detected: z.literal(false),
		reason: z.string(),
	}),
]);
export type AstraCliInfo = z.infer<typeof AstraCliInfoSchema>;

const AstraCliDatabaseInfoSchema = z.object({
	id: z.string(),
	name: z.string(),
	region: z.string(),
	endpoint: z.string().url(),
	keyspace: z.string().nullable(),
});
export type AstraCliDatabaseInfo = z.infer<typeof AstraCliDatabaseInfoSchema>;

const AstraCliProfileEntrySchema = z.object({
	name: z.string(),
	env: z.string(),
	isUsedAsDefault: z.boolean(),
	databases: z.array(AstraCliDatabaseInfoSchema),
});
export type AstraCliProfileEntry = z.infer<typeof AstraCliProfileEntrySchema>;

export const AstraCliInventorySchema = z.discriminatedUnion("available", [
	z.object({
		available: z.literal(true),
		profiles: z.array(AstraCliProfileEntrySchema),
	}),
	z.object({
		available: z.literal(false),
		reason: z.string(),
	}),
]);
export type AstraCliInventory = z.infer<typeof AstraCliInventorySchema>;

/* ---------------- runtime feature flags ---------------- */

export const FeaturesSchema = z.object({
	mcp: z.object({
		enabled: z.boolean(),
		baseUrl: z.string().url().nullable(),
	}),
});
export type Features = z.infer<typeof FeaturesSchema>;

/* ---------------- Connect (pluggability) ---------------- */

// Order MUST stay in sync with the server registry in
// `runtimes/typescript/src/connect/snippets/index.ts`. Customers
// screenshot the tab order into slide decks; reordering is a
// wire-break.
export const ConnectTargetIdSchema = z.enum([
	"langgraph",
	"crewai",
	"google-adk",
	"microsoft-agent-framework",
	"watsonx",
	"mcp-raw",
]);
export type ConnectTargetId = z.infer<typeof ConnectTargetIdSchema>;

export const ConnectSnippetLanguageSchema = z.enum([
	"python",
	"typescript",
	"bash",
	"text",
]);
export type ConnectSnippetLanguage = z.infer<
	typeof ConnectSnippetLanguageSchema
>;

export const ConnectSnippetTransportSchema = z.enum(["mcp", "rest", "manual"]);
export type ConnectSnippetTransport = z.infer<
	typeof ConnectSnippetTransportSchema
>;

export const ConnectSnippetSchema = z.object({
	id: ConnectTargetIdSchema,
	displayName: z.string(),
	tagline: z.string(),
	language: ConnectSnippetLanguageSchema,
	transport: ConnectSnippetTransportSchema,
	install: z.string().nullable(),
	code: z.string(),
	requiresMcp: z.boolean(),
	docsUrl: z.string().url(),
	notes: z.string().nullable(),
});
export type ConnectSnippet = z.infer<typeof ConnectSnippetSchema>;

export const ConnectSnippetsResponseSchema = z.object({
	workspaceId: z.string(),
	knowledgeBaseId: z.string().nullable(),
	publicBaseUrl: z.string().url(),
	mcpUrl: z.string().url(),
	restBaseUrl: z.string().url(),
	mcpEnabled: z.boolean(),
	apiKeyEnvVar: z.string(),
	targets: z.array(ConnectSnippetSchema),
});
export type ConnectSnippetsResponse = z.infer<
	typeof ConnectSnippetsResponseSchema
>;

// Always 200 from the server. Inspect `ok` + `mcpEnabled` + `error`
// to pick a UI badge state (green / amber / red).
export const ConnectVerifyResponseSchema = z.object({
	ok: z.boolean(),
	mcpEnabled: z.boolean(),
	toolCount: z.number().int().nonnegative(),
	tools: z.array(z.string()),
	latencyMs: z.number().int().nonnegative(),
	error: z
		.object({
			code: z.string(),
			message: z.string(),
		})
		.nullable(),
});
export type ConnectVerifyResponse = z.infer<typeof ConnectVerifyResponseSchema>;

export const ConnectTrafficEntrySchema = z.object({
	at: z.string(),
	toolName: z.string(),
	outcome: z.enum(["success", "failure", "denied"]),
	subjectType: z.enum(["apiKey", "oidc", "bootstrap", "anonymous", "system"]),
	subjectLabel: z.string().nullable(),
	reason: z.string().nullable(),
});
export type ConnectTrafficEntry = z.infer<typeof ConnectTrafficEntrySchema>;

export const ConnectTrafficResponseSchema = z.object({
	workspaceId: z.string(),
	mcpEnabled: z.boolean(),
	entries: z.array(ConnectTrafficEntrySchema),
	summary: z.object({
		total: z.number().int().nonnegative(),
		successes: z.number().int().nonnegative(),
		failures: z.number().int().nonnegative(),
	}),
});
export type ConnectTrafficResponse = z.infer<
	typeof ConnectTrafficResponseSchema
>;

export const KIND_LABELS: Record<WorkspaceKind, string> = {
	astra: "Astra DB",
	hcd: "Hyper-Converged Database",
	openrag: "OpenRAG",
	mock: "Mock (in-memory)",
};

export const KIND_DESCRIPTIONS: Record<WorkspaceKind, string> = {
	astra: "DataStax Astra DB via the Data API. Production-grade managed cloud.",
	hcd: "Hyper-Converged Database — Astra's self-hosted cousin. Routing coming later.",
	openrag: "The OpenRAG project. Routing coming later.",
	mock: "In-memory backend for local development and smoke tests. No persistence, no credentials.",
};

/* ====================================================================== */
/* External MCP servers (0.4.0 A2 backend; A6 settings UI).               */
/*                                                                        */
/* Per-workspace registry of remote MCP servers the agents can reach.     */
/* The runtime discovers each enabled server's tools at turn time and     */
/* exposes them as `mcp:{mcpServerId}:{tool}` agent tools.                */
/* ====================================================================== */

export const McpServerRecordSchema = z.object({
	workspaceId: z.string().uuid(),
	mcpServerId: z.string().uuid(),
	label: z.string(),
	url: z.string(),
	credentialRef: z.string().nullable(),
	enabled: z.boolean(),
	// `null` = expose every tool the server advertises; `[]` = expose none.
	allowedTools: z.array(z.string()).nullable(),
	createdAt: z.string(),
	updatedAt: z.string(),
});
export type McpServerRecord = z.infer<typeof McpServerRecordSchema>;
export const McpServerPageSchema = paginatedSchema(McpServerRecordSchema);

export const CreateMcpServerInputSchema = z.object({
	label: z.string().min(1, "Label is required").max(200),
	// http(s) only; the runtime re-validates (SSRF guard) at dial time.
	url: z
		.string()
		.url("Must be a valid http(s) URL")
		.regex(/^https?:\/\//i, "Must start with http:// or https://"),
	credentialRef: SecretRefSchema.nullable().optional(),
	enabled: z.boolean().optional(),
	allowedTools: z.array(z.string().min(1)).nullable().optional(),
});
export type CreateMcpServerInput = z.infer<typeof CreateMcpServerInputSchema>;

export const UpdateMcpServerInputSchema = z
	.object({
		label: z.string().min(1).max(200).optional(),
		url: z
			.string()
			.url("Must be a valid http(s) URL")
			.regex(/^https?:\/\//i, "Must start with http:// or https://")
			.optional(),
		credentialRef: SecretRefSchema.nullable().optional(),
		enabled: z.boolean().optional(),
		allowedTools: z.array(z.string().min(1)).nullable().optional(),
	})
	.strict();
export type UpdateMcpServerInput = z.infer<typeof UpdateMcpServerInputSchema>;

/**
 * Setup-wizard envelope returned by `GET /setup-status`. Mirrors the
 * runtime's `SetupStatusBody` interface; mirror new fields here in
 * the same PR or the schema parse will silently drop them.
 */
export const SetupBootErrorSchema = z.object({
	code: z.string(),
	message: z.string(),
});
export type SetupBootError = z.infer<typeof SetupBootErrorSchema>;

export const SetupStatusSchema = z.object({
	setupComplete: z.boolean(),
	workspacesCount: z.number(),
	controlPlane: z.object({
		kind: z.string(),
		healthy: z.boolean(),
	}),
	hasChatProvider: z.boolean(),
	hasAstraCreds: z.boolean(),
	managedEnv: z.object({
		path: z.string(),
		writable: z.boolean(),
		present: z.boolean(),
		/**
		 * Allow-listed keys that currently resolve to a non-empty value
		 * (managed file or shell env). Drives the per-field "configured"
		 * indicator on the settings page. Defaulted for back-compat with
		 * runtimes that predate the field.
		 */
		configuredKeys: z.array(z.string()).default([]),
	}),
	/**
	 * Set when the runtime came up in rescue mode (control-plane
	 * init threw). When present, `/api/v1/*` is unavailable; the SPA
	 * should steer the user to `/settings` to fix credentials and
	 * trigger a restart. Absent on a healthy boot.
	 */
	bootError: SetupBootErrorSchema.optional(),
});
export type SetupStatus = z.infer<typeof SetupStatusSchema>;

/** Allow-listed keys the wizard is permitted to persist. */
export const MANAGED_ENV_KEYS = [
	"ASTRA_DB_API_ENDPOINT",
	"ASTRA_DB_APPLICATION_TOKEN",
	"OPENROUTER_API_KEY",
	"OPENAI_API_KEY",
] as const;
export type ManagedEnvKey = (typeof MANAGED_ENV_KEYS)[number];

export const SetupEnvResponseSchema = z.object({
	ok: z.boolean(),
	managedEnv: z.object({
		path: z.string(),
		writable: z.boolean(),
		present: z.boolean(),
	}),
	written: z.array(z.string()),
	restartRequired: z.boolean(),
});
export type SetupEnvResponse = z.infer<typeof SetupEnvResponseSchema>;

/** Result of a single backend probe (`probeControlPlane` / `probeChatProvider`). */
export const ProbeResultSchema = z.object({
	status: z.enum(["ok", "degraded", "down"]),
	detail: z.string(),
	durationMs: z.number(),
});
export type ProbeResult = z.infer<typeof ProbeResultSchema>;

/** Envelope returned by `GET /health/details`. */
export const HealthDetailsSchema = z.object({
	controlPlane: ProbeResultSchema,
	chat: ProbeResultSchema,
	ingest: z
		.object({
			active: z.number(),
			queued: z.number(),
			capacity: z.number(),
		})
		.nullable(),
	recentErrors: z.object({
		capacity: z.number(),
		count: z.number(),
	}),
});
export type HealthDetails = z.infer<typeof HealthDetailsSchema>;

export const RecentErrorEntrySchema = z.object({
	ts: z.string(),
	code: z.string(),
	status: z.number(),
	method: z.string(),
	routePattern: z.string(),
	requestId: z.string(),
});
export type RecentErrorEntry = z.infer<typeof RecentErrorEntrySchema>;

export const RecentErrorsResponseSchema = z.object({
	capacity: z.number(),
	entries: z.array(RecentErrorEntrySchema),
});
export type RecentErrorsResponse = z.infer<typeof RecentErrorsResponseSchema>;
