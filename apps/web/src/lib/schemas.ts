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
	owned: z.boolean(),
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
	ragEnabled: z.boolean(),
	ragMaxResults: z.number().int().nullish(),
	ragMinScore: z.number().nullish(),
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
	ragEnabled: z.boolean().optional(),
	ragMaxResults: z.number().int().positive().nullable().optional(),
	ragMinScore: z.number().nullable().optional(),
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
		ragEnabled: z.boolean().optional(),
		ragMaxResults: z.number().int().positive().nullable().optional(),
		ragMinScore: z.number().nullable().optional(),
		rerankEnabled: z.boolean().optional(),
		rerankingServiceId: z.string().uuid().nullable().optional(),
		rerankMaxResults: z.number().int().positive().nullable().optional(),
	})
	.strict();
export type UpdateAgentInput = z.infer<typeof UpdateAgentInputSchema>;

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

/* ---------------- runtime feature flags ---------------- */

export const FeaturesSchema = z.object({
	mcp: z.object({
		enabled: z.boolean(),
		baseUrl: z.string().url().nullable(),
	}),
});
export type Features = z.infer<typeof FeaturesSchema>;

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
