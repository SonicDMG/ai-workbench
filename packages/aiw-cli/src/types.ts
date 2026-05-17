/**
 * Shared response shapes for `aiw` commands.
 *
 * The runtime's OpenAPI document is the source of truth; here we
 * only declare the fields the CLI renders or pivots on. Anything
 * extra is preserved via `.passthrough()` so a runtime upgrade
 * that adds new fields doesn't break the CLI.
 *
 * Wire conventions (matched against
 * `runtimes/typescript/src/lib/pagination.ts` and
 * `runtimes/typescript/src/openapi/schemas.ts`):
 *   - List envelopes are `{ items: [...], nextCursor: string | null }`.
 *   - Resource ids are resource-specific (`workspaceId`,
 *     `knowledgeBaseId`, `agentId`, `documentId`, `jobId`) — there's
 *     no generic `id` on the wire.
 */
import { z } from "zod";

const PaginationCursor = z.string().nullable().optional();

function paginated<T extends z.ZodTypeAny>(item: T) {
	return z
		.object({
			items: z.array(item),
			nextCursor: PaginationCursor,
		})
		.passthrough();
}

export const WorkspaceSchema = z
	.object({
		workspaceId: z.string(),
		name: z.string(),
		kind: z.string().optional(),
		url: z.string().nullable().optional(),
		keyspace: z.string().nullable().optional(),
		rlacEnabled: z.boolean().optional(),
		createdAt: z.string().optional(),
		updatedAt: z.string().optional(),
	})
	.passthrough();
export type Workspace = z.infer<typeof WorkspaceSchema>;

export const WorkspaceListSchema = paginated(WorkspaceSchema);

export const KnowledgeBaseSchema = z
	.object({
		workspaceId: z.string().optional(),
		knowledgeBaseId: z.string(),
		name: z.string(),
		description: z.string().nullable().optional(),
		status: z.string().optional(),
		vectorCollection: z.string().nullable().optional(),
		language: z.string().nullable().optional(),
		owned: z.boolean().optional(),
		createdAt: z.string().optional(),
	})
	.passthrough();
export type KnowledgeBase = z.infer<typeof KnowledgeBaseSchema>;

export const KnowledgeBaseListSchema = paginated(KnowledgeBaseSchema);

export const AgentSchema = z
	.object({
		workspaceId: z.string().optional(),
		agentId: z.string(),
		name: z.string(),
		description: z.string().nullable().optional(),
		llmServiceId: z.string().nullable().optional(),
	})
	.passthrough();
export type Agent = z.infer<typeof AgentSchema>;

export const AgentListSchema = paginated(AgentSchema);

export const DocumentSchema = z
	.object({
		documentId: z.string().optional(),
		sourceFilename: z.string().optional(),
		status: z.string().optional(),
		contentHash: z.string().optional(),
		chunkTotal: z.number().optional(),
		ingestedAt: z.string().optional(),
	})
	.passthrough();
export type Document = z.infer<typeof DocumentSchema>;

export const JobSchema = z
	.object({
		jobId: z.string(),
		workspaceId: z.string().optional(),
		kind: z.string().optional(),
		status: z.string().optional(),
		knowledgeBaseId: z.string().nullable().optional(),
		documentId: z.string().nullable().optional(),
		processed: z.number().optional(),
		total: z.number().nullable().optional(),
		errorMessage: z.string().nullable().optional(),
		createdAt: z.string().optional(),
		updatedAt: z.string().optional(),
	})
	.passthrough();
export type Job = z.infer<typeof JobSchema>;

export const SearchHitSchema = z
	.object({
		id: z.string(),
		score: z.number(),
		payload: z.record(z.string(), z.unknown()).optional(),
		vector: z.array(z.number()).optional(),
	})
	.passthrough();
export type SearchHit = z.infer<typeof SearchHitSchema>;

/**
 * The search endpoint returns a bare array — no envelope. Keep the
 * schema accordingly so we don't reach for a missing `items` key.
 */
export const SearchResponseSchema = z.array(SearchHitSchema);

export const WhoAmISchema = z
	.object({
		id: z.string().optional(),
		label: z.string().optional(),
		type: z.string().optional(),
		workspaceScopes: z.array(z.string()).nullable().optional(),
		scopes: z.array(z.string()).optional(),
	})
	.passthrough();
