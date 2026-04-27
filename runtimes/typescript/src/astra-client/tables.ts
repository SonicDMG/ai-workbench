/**
 * Narrow structural interfaces over the subset of `@datastax/astra-db-ts`
 * surface we actually call.
 *
 * Two goals:
 *
 * 1. **Testability.** Unit tests inject a fake `TablesBundle` backed by
 *    in-memory maps, and the whole astra control-plane store runs
 *    against it unchanged.
 *
 * 2. **Stable upgrade path.** If astra-db-ts renames a method or
 *    adjusts a type, the blast radius is confined to this file plus
 *    {@link ./client.ts} where we adapt a real `Db` to this shape.
 */

import type {
	SomeRow,
	TableFilter,
	TableUpdateFilter,
} from "@datastax/astra-db-ts";
import type {
	AgentRow,
	ApiKeyLookupRow,
	ApiKeyRow,
	ChunkingServiceRow,
	ConfigWorkspaceRow,
	ConversationRow,
	EmbeddingServiceRow,
	JobRow,
	KnowledgeBaseRow,
	LlmServiceRow,
	McpToolRow,
	MessageRow,
	RagDocumentByContentHashRow,
	RagDocumentByStatusRow,
	RagDocumentRow,
	RerankingServiceRow,
	WorkspaceRow,
} from "./row-types.js";

export interface TableLike<Row extends SomeRow> {
	insertOne(row: Row): Promise<unknown>;
	findOne(filter: TableFilter<Row>): Promise<Row | null>;
	find(filter: TableFilter<Row>): Cursor<Row>;
	updateOne(
		filter: TableFilter<Row>,
		update: TableUpdateFilter<Row>,
	): Promise<void>;
	deleteOne(filter: TableFilter<Row>): Promise<void>;
	deleteMany(filter: TableFilter<Row>): Promise<void>;
}

export interface Cursor<Row extends SomeRow> {
	toArray(): Promise<Row[]>;
}

/**
 * The set of tables the control-plane store needs. Wired up once by
 * {@link ./client.openAstraClient} (real) or a test harness (fake).
 */
export interface TablesBundle {
	readonly workspaces: TableLike<WorkspaceRow>;
	readonly jobs: TableLike<JobRow>;
	readonly apiKeys: TableLike<ApiKeyRow>;
	readonly apiKeyLookup: TableLike<ApiKeyLookupRow>;
	/* ---- knowledge-base schema (issue #98) ---- */
	readonly configWorkspaces: TableLike<ConfigWorkspaceRow>;
	readonly knowledgeBases: TableLike<KnowledgeBaseRow>;
	readonly chunkingServices: TableLike<ChunkingServiceRow>;
	readonly embeddingServices: TableLike<EmbeddingServiceRow>;
	readonly rerankingServices: TableLike<RerankingServiceRow>;
	readonly llmServices: TableLike<LlmServiceRow>;
	readonly mcpTools: TableLike<McpToolRow>;
	readonly ragDocuments: TableLike<RagDocumentRow>;
	readonly ragDocumentsByStatus: TableLike<RagDocumentByStatusRow>;
	readonly ragDocumentsByHash: TableLike<RagDocumentByContentHashRow>;
	readonly agents: TableLike<AgentRow>;
	readonly conversations: TableLike<ConversationRow>;
	readonly messages: TableLike<MessageRow>;
}
