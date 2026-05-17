/**
 * Shared response shapes for `aiw` commands.
 *
 * The runtime's OpenAPI document is the source of truth; here we
 * only declare the fields the CLI renders or pivots on. Anything
 * extra is preserved via `.passthrough()` so a runtime upgrade
 * that adds new fields doesn't break the CLI.
 */
import { z } from "zod";

export const WorkspaceSchema = z
	.object({
		id: z.string(),
		name: z.string(),
		kind: z.string().optional(),
		backend: z.string().optional(),
		createdAt: z.string().optional(),
		rlacEnabled: z.boolean().optional(),
	})
	.passthrough();
export type Workspace = z.infer<typeof WorkspaceSchema>;

export const WorkspaceListSchema = z
	.object({ data: z.array(WorkspaceSchema) })
	.passthrough();

export const KnowledgeBaseSchema = z
	.object({
		id: z.string(),
		name: z.string(),
		workspaceId: z.string().optional(),
		collectionName: z.string().optional(),
		createdAt: z.string().optional(),
	})
	.passthrough();
export type KnowledgeBase = z.infer<typeof KnowledgeBaseSchema>;

export const KnowledgeBaseListSchema = z
	.object({ data: z.array(KnowledgeBaseSchema) })
	.passthrough();

export const AgentSchema = z
	.object({
		id: z.string(),
		name: z.string(),
		persona: z.string().optional(),
		workspaceId: z.string().optional(),
	})
	.passthrough();
export type Agent = z.infer<typeof AgentSchema>;

export const AgentListSchema = z
	.object({ data: z.array(AgentSchema) })
	.passthrough();

export const DocumentSchema = z
	.object({
		id: z.string(),
		title: z.string().optional(),
		sourceUri: z.string().optional(),
		status: z.string().optional(),
		createdAt: z.string().optional(),
	})
	.passthrough();
export type Document = z.infer<typeof DocumentSchema>;

export const JobSchema = z
	.object({
		id: z.string(),
		kind: z.string().optional(),
		state: z.string().optional(),
		status: z.string().optional(),
		progress: z.number().optional(),
		createdAt: z.string().optional(),
		completedAt: z.string().optional(),
		error: z.string().optional(),
	})
	.passthrough();
export type Job = z.infer<typeof JobSchema>;

export const SearchResultSchema = z
	.object({
		documentId: z.string().optional(),
		score: z.number().optional(),
		snippet: z.string().optional(),
		text: z.string().optional(),
	})
	.passthrough();
export type SearchResult = z.infer<typeof SearchResultSchema>;

export const SearchResponseSchema = z
	.object({ data: z.array(SearchResultSchema) })
	.passthrough();

export const WhoAmISchema = z
	.object({
		subject: z.unknown().optional(),
		scopes: z.array(z.string()).optional(),
	})
	.passthrough();
