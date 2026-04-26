import { z } from "zod";

// Mirror of the runtime's schemas (see
// runtimes/typescript/src/openapi/schemas.ts). Keep in sync when the
// contract changes — the drift-guard conformance tests will catch
// backend shifts, but the UI is on its own to track them here.

export const WorkspaceKindSchema = z.enum(["astra", "hcd", "openrag", "mock"]);
export type WorkspaceKind = z.infer<typeof WorkspaceKindSchema>;

export const SecretRefSchema = z
	.string()
	.regex(/^[a-z][a-z0-9]*:.+/i, "Expected '<provider>:<path>', e.g. 'env:FOO'");

// `endpoint` accepts either a URL or a SecretRef; the runtime
// detects the form by prefix-matching the SecretResolver.
const EndpointInputSchema = z
	.union([z.string().url(), SecretRefSchema, z.literal("")])
	.nullable()
	.optional();

export const WorkspaceRecordSchema = z.object({
	uid: z.string().uuid(),
	name: z.string(),
	endpoint: z.string().nullable(),
	kind: WorkspaceKindSchema,
	credentialsRef: z.record(z.string(), z.string()),
	keyspace: z.string().nullable(),
	createdAt: z.string(),
	updatedAt: z.string(),
});
export type Workspace = z.infer<typeof WorkspaceRecordSchema>;

export const CreateWorkspaceSchema = z.object({
	name: z.string().min(1, "Name is required"),
	kind: WorkspaceKindSchema,
	endpoint: EndpointInputSchema,
	keyspace: z.string().or(z.literal("")).nullable().optional(),
	credentialsRef: z.record(z.string(), SecretRefSchema).optional(),
});
export type CreateWorkspaceInput = z.infer<typeof CreateWorkspaceSchema>;

export const UpdateWorkspaceSchema = z.object({
	name: z.string().min(1, "Name is required").optional(),
	endpoint: EndpointInputSchema,
	keyspace: z.string().or(z.literal("")).nullable().optional(),
	credentialsRef: z.record(z.string(), SecretRefSchema).optional(),
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

export const TestConnectionResultSchema = z.object({
	ok: z.boolean(),
	kind: WorkspaceKindSchema,
	details: z.string(),
});
export type TestConnectionResult = z.infer<typeof TestConnectionResultSchema>;

export const ApiKeyRecordSchema = z.object({
	workspace: z.string().uuid(),
	keyId: z.string().uuid(),
	prefix: z.string(),
	label: z.string(),
	createdAt: z.string(),
	lastUsedAt: z.string().nullable(),
	revokedAt: z.string().nullable(),
	expiresAt: z.string().nullable(),
});
export type ApiKeyRecord = z.infer<typeof ApiKeyRecordSchema>;

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

export const EmbeddingConfigSchema = z.object({
	provider: z.string(),
	model: z.string(),
	endpoint: z.string().nullable(),
	dimension: z.number().int().positive(),
	secretRef: z.string().nullable(),
});
export type EmbeddingConfig = z.infer<typeof EmbeddingConfigSchema>;

export const VectorSimilaritySchema = z.enum(["cosine", "dot", "euclidean"]);
export type VectorSimilarity = z.infer<typeof VectorSimilaritySchema>;

export const CreateVectorStoreInputSchema = z.object({
	name: z.string().min(1, "Name is required"),
	vectorDimension: z
		.number()
		.int()
		.positive("Dimension must be a positive integer"),
	vectorSimilarity: VectorSimilaritySchema.default("cosine"),
	embedding: z.object({
		provider: z.string().min(1, "Provider is required"),
		model: z.string().min(1, "Model is required"),
		endpoint: z.string().nullable(),
		dimension: z.number().int().positive(),
		secretRef: z
			.string()
			.regex(/^[a-z][a-z0-9]*:.+/i, "Expected '<provider>:<path>'")
			.nullable(),
	}),
});
export type CreateVectorStoreInput = z.infer<
	typeof CreateVectorStoreInputSchema
>;

export const VectorStoreRecordSchema = z.object({
	workspace: z.string().uuid(),
	uid: z.string().uuid(),
	name: z.string(),
	vectorDimension: z.number().int().positive(),
	vectorSimilarity: z.enum(["cosine", "dot", "euclidean"]),
	embedding: EmbeddingConfigSchema,
	lexical: z.object({
		enabled: z.boolean(),
		analyzer: z.string().nullable(),
		options: z.record(z.string(), z.string()),
	}),
	reranking: z.object({
		enabled: z.boolean(),
		provider: z.string().nullable(),
		model: z.string().nullable(),
		endpoint: z.string().nullable(),
		secretRef: z.string().nullable(),
	}),
	createdAt: z.string(),
	updatedAt: z.string(),
});
export type VectorStoreRecord = z.infer<typeof VectorStoreRecordSchema>;

export const SearchHitSchema = z.object({
	id: z.string(),
	score: z.number(),
	payload: z.record(z.string(), z.unknown()).optional(),
	vector: z.array(z.number()).optional(),
});
export type SearchHit = z.infer<typeof SearchHitSchema>;

/* ---------------- Catalogs ---------------- */

export const CatalogRecordSchema = z.object({
	workspace: z.string().uuid(),
	uid: z.string().uuid(),
	name: z.string(),
	description: z.string().nullable(),
	vectorStore: z.string().uuid().nullable(),
	createdAt: z.string(),
	updatedAt: z.string(),
});
export type CatalogRecord = z.infer<typeof CatalogRecordSchema>;

export const CreateCatalogInputSchema = z.object({
	name: z.string().min(1, "Name is required"),
	description: z.string().or(z.literal("")).nullable().optional(),
	vectorStore: z.string().uuid().nullable().optional(),
});
export type CreateCatalogInput = z.infer<typeof CreateCatalogInputSchema>;

/* ---------------- Documents ---------------- */

export const DocumentStatusSchema = z.enum([
	"pending",
	"chunking",
	"embedding",
	"writing",
	"ready",
	"failed",
]);
export type DocumentStatus = z.infer<typeof DocumentStatusSchema>;

export const DocumentRecordSchema = z.object({
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
});
export type DocumentRecord = z.infer<typeof DocumentRecordSchema>;

/* ---------------- Jobs ---------------- */

export const JobStatusSchema = z.enum([
	"pending",
	"running",
	"succeeded",
	"failed",
]);
export type JobStatus = z.infer<typeof JobStatusSchema>;

export const JobRecordSchema = z.object({
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
});
export type JobRecord = z.infer<typeof JobRecordSchema>;

/* ---------------- Ingest ---------------- */

export const IngestChunkerOptionsSchema = z.object({
	maxChars: z.number().int().positive().optional(),
	minChars: z.number().int().nonnegative().optional(),
	overlapChars: z.number().int().nonnegative().optional(),
});
export type IngestChunkerOptions = z.infer<typeof IngestChunkerOptionsSchema>;

export const DocumentChunkSchema = z.object({
	id: z.string(),
	chunkIndex: z.number().int().nonnegative().nullable(),
	text: z.string().nullable(),
	payload: z.record(z.string(), z.unknown()),
});
export type DocumentChunk = z.infer<typeof DocumentChunkSchema>;

export const AdoptableCollectionSchema = z.object({
	name: z.string(),
	vectorDimension: z.number().int().positive(),
	vectorSimilarity: z.enum(["cosine", "dot", "euclidean"]),
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
});
export type AdoptableCollection = z.infer<typeof AdoptableCollectionSchema>;

export const IngestRequestSchema = z.object({
	text: z.string().min(1, "Content is required"),
	sourceFilename: z.string().nullable().optional(),
	fileType: z.string().nullable().optional(),
	fileSize: z.number().int().nonnegative().nullable().optional(),
	metadata: z.record(z.string(), z.string()).optional(),
	chunker: IngestChunkerOptionsSchema.optional(),
});
export type IngestRequest = z.infer<typeof IngestRequestSchema>;

/**
 * Response from `POST /ingest?async=true` — the 202 envelope that
 * ties together the job to poll and the document row to watch.
 */
export const AsyncIngestResponseSchema = z.object({
	job: JobRecordSchema,
	document: DocumentRecordSchema,
});
export type AsyncIngestResponse = z.infer<typeof AsyncIngestResponseSchema>;

/* ---------------- Saved queries ---------------- */

export const SavedQueryRecordSchema = z.object({
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
});
export type SavedQueryRecord = z.infer<typeof SavedQueryRecordSchema>;

export const CreateSavedQueryInputSchema = z.object({
	name: z.string().min(1, "Name is required"),
	description: z.string().or(z.literal("")).nullable().optional(),
	text: z.string().min(1, "Text is required"),
	topK: z.number().int().positive().max(1000).nullable().optional(),
	filter: z.record(z.string(), z.unknown()).nullable().optional(),
});
export type CreateSavedQueryInput = z.infer<typeof CreateSavedQueryInputSchema>;

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
