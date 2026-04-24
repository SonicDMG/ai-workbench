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
