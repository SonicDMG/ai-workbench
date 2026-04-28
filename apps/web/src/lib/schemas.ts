import { z } from "zod";

// Mirror of the runtime's schemas (see
// runtimes/typescript/src/openapi/schemas.ts). Keep in sync when the
// contract changes — the runtime tests will catch shifts in the
// backend, but the UI is on its own to track them here.

export const WorkspaceKindSchema = z.enum(["astra", "hcd", "openrag", "mock"]);
export type WorkspaceKind = z.infer<typeof WorkspaceKindSchema>;

export const SecretRefSchema = z
	.string()
	.regex(/^[a-z][a-z0-9]*:.+$/, "Expected '<provider>:<path>', e.g. 'env:FOO'");

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

export const ApiKeyRecordSchema = z.object({
	workspaceId: z.string().uuid(),
	keyId: z.string().uuid(),
	prefix: z.string(),
	label: z.string(),
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
});
export type CreateApiKeyInput = z.infer<typeof CreateApiKeyInputSchema>;

export const CreatedApiKeyResponseSchema = z.object({
	plaintext: z.string(),
	key: ApiKeyRecordSchema,
});
export type CreatedApiKeyResponse = z.infer<typeof CreatedApiKeyResponseSchema>;

export const SearchHitSchema = z.object({
	id: z.string(),
	score: z.number(),
	payload: z.record(z.string(), z.unknown()).optional(),
	vector: z.array(z.number()).optional(),
});
export type SearchHit = z.infer<typeof SearchHitSchema>;

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
	lexical: LexicalConfigSchema,
	createdAt: z.string(),
	updatedAt: z.string(),
});
export type KnowledgeBaseRecord = z.infer<typeof KnowledgeBaseRecordSchema>;
export const KnowledgeBasePageSchema = paginatedSchema(
	KnowledgeBaseRecordSchema,
);

export const CreateKnowledgeBaseInputSchema = z.object({
	name: z.string().min(1, "Name is required"),
	description: z.string().or(z.literal("")).nullable().optional(),
	embeddingServiceId: z.string().uuid("Pick an embedding service"),
	chunkingServiceId: z.string().uuid("Pick a chunking service"),
	rerankingServiceId: z.string().uuid().nullable().optional(),
	language: z.string().or(z.literal("")).nullable().optional(),
});
export type CreateKnowledgeBaseInput = z.infer<
	typeof CreateKnowledgeBaseInputSchema
>;

export const UpdateKnowledgeBaseInputSchema = z.object({
	name: z.string().min(1).optional(),
	description: z.string().or(z.literal("")).nullable().optional(),
	status: KnowledgeBaseStatusSchema.optional(),
	rerankingServiceId: z.string().uuid().nullable().optional(),
	language: z.string().or(z.literal("")).nullable().optional(),
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
});
export type KbIngestRequest = z.infer<typeof KbIngestRequestSchema>;

export const KbAsyncIngestResponseSchema = z.object({
	job: JobRecordSchema,
	document: RagDocumentRecordSchema,
});
export type KbAsyncIngestResponse = z.infer<typeof KbAsyncIngestResponseSchema>;

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
