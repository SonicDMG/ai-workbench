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
const VectorSimilarity = z.enum(["cosine", "dot", "euclidean"]);
const DocumentStatus = z.enum([
	"pending",
	"chunking",
	"embedding",
	"writing",
	"ready",
	"failed",
]);

/* ---------------- Workspace ---------------- */

export const WorkspaceRecordSchema = z
	.object({
		uid: z.string().uuid(),
		name: z.string(),
		url: z.string().nullable(),
		kind: WorkspaceKind,
		credentialsRef: z.record(z.string(), z.string()),
		keyspace: z.string().nullable(),
		createdAt: z.string(),
		updatedAt: z.string(),
	})
	.openapi("Workspace");

export const CreateWorkspaceInputSchema = z
	.object({
		uid: z.string().uuid().optional(),
		name: z.string().min(1),
		url: z.string().url().nullable().optional(),
		kind: WorkspaceKind,
		credentialsRef: z.record(z.string(), z.string()).optional(),
		keyspace: z.string().nullable().optional(),
	})
	.openapi("CreateWorkspaceInput");

export const UpdateWorkspaceInputSchema = z
	.object({
		name: z.string().min(1).optional(),
		url: z.string().url().nullable().optional(),
		kind: WorkspaceKind.optional(),
		credentialsRef: z.record(z.string(), z.string()).optional(),
		keyspace: z.string().nullable().optional(),
	})
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

/* ---------------- Compat stubs (unused by new routes; kept until old routes go) ---------------- */

// Left behind for no-one — the former /v1/workspaces surface is dropped
// in this PR. If a consumer still imports these, TypeScript will surface
// it at build time.

// Document status re-exported in case downstream routes want to validate
// the enum before it ships in Phase 2.
export { DocumentStatus };
