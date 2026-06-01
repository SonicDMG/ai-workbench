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

export const ApiKeyRecordSchema = z
	.object({
		workspaceId: z.string().optional(),
		keyId: z.string(),
		prefix: z.string(),
		label: z.string(),
		// Privilege scopes — coarse tiers and/or 0.5.0 fine grants. Kept as
		// open strings so a newly-added server scope doesn't break the CLI.
		scopes: z.array(z.string()),
		createdAt: z.string().optional(),
		lastUsedAt: z.string().nullable().optional(),
		revokedAt: z.string().nullable().optional(),
		expiresAt: z.string().nullable().optional(),
	})
	.passthrough();
export type ApiKey = z.infer<typeof ApiKeyRecordSchema>;

export const ApiKeyListSchema = paginated(ApiKeyRecordSchema);

/** Mint response: the plaintext token is returned exactly once. */
export const CreateApiKeyResponseSchema = z
	.object({
		plaintext: z.string(),
		key: ApiKeyRecordSchema,
	})
	.passthrough();
export type CreateApiKeyResponse = z.infer<typeof CreateApiKeyResponseSchema>;

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
		label: z.string().nullable().optional(),
		type: z.string().optional(),
		workspaceScopes: z.array(z.string()).nullable().optional(),
		// RBAC (0.4.0): the runtime's `/auth/me` now reports the caller's
		// effective role + privilege scopes. Both are nullable — an OIDC
		// subject with no role mapping carries every scope and reports
		// `null` for each.
		role: z.string().nullable().optional(),
		scopes: z.array(z.string()).nullable().optional(),
	})
	.passthrough();

/**
 * RLAC sub-workspace identity. Principal IDs are workspace-scoped
 * strings (typically OIDC `sub`, an email, or an operator-chosen
 * handle) — not UUIDs. See `docs/rlac.md`.
 */
export const PrincipalSchema = z
	.object({
		workspaceId: z.string().optional(),
		principalId: z.string(),
		label: z.string().nullable().optional(),
		attributes: z.record(z.string(), z.string()).optional(),
		createdAt: z.string().optional(),
		updatedAt: z.string().optional(),
	})
	.passthrough();
export type Principal = z.infer<typeof PrincipalSchema>;

export const PrincipalListSchema = paginated(PrincipalSchema);

export const PolicyValidationIssueSchema = z
	.object({
		code: z.string(),
		message: z.string(),
		hint: z.string().optional(),
	})
	.passthrough();
export type PolicyValidationIssue = z.infer<typeof PolicyValidationIssueSchema>;

export const PolicyCompilePreviewSchema = z
	.object({
		ok: z.boolean(),
		parseError: z.string().nullable(),
		issues: z.array(PolicyValidationIssueSchema),
		compiledFilter: z.unknown().nullable(),
		principalId: z.string().nullable(),
	})
	.passthrough();
export type PolicyCompilePreview = z.infer<typeof PolicyCompilePreviewSchema>;

export const PolicyAuditRecordSchema = z
	.object({
		workspaceId: z.string().optional(),
		auditDay: z.string().optional(),
		ts: z.string(),
		decisionId: z.string().optional(),
		principalId: z.string().nullable(),
		knowledgeBaseId: z.string().optional(),
		resourceId: z.string().optional(),
		action: z.string(),
		decision: z.string(),
		reason: z.string(),
		compiledFilterJson: z.string().nullable().optional(),
	})
	.passthrough();
export type PolicyAuditRecord = z.infer<typeof PolicyAuditRecordSchema>;

export const PolicyAuditListSchema = paginated(PolicyAuditRecordSchema);
