/**
 * Adapts `@datastax/astra-db-ts` to the {@link TablesBundle} shape used
 * by the astra control-plane store.
 *
 * Creates (idempotently) each of the four `wb_*` tables at init time,
 * then returns a bundle of typed accessors — the rest of the runtime
 * never touches the raw `Db` object.
 */

import { DataAPIClient, type Db } from "@datastax/astra-db-ts";
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
import {
	AGENTS_DEFINITION,
	AGENTS_TABLE,
	API_KEY_LOOKUP_DEFINITION,
	API_KEY_LOOKUP_TABLE,
	API_KEYS_DEFINITION,
	API_KEYS_TABLE,
	CHUNKING_SERVICES_DEFINITION,
	CHUNKING_SERVICES_TABLE,
	CONFIG_WORKSPACES_DEFINITION,
	CONFIG_WORKSPACES_TABLE,
	CONVERSATIONS_DEFINITION,
	CONVERSATIONS_TABLE,
	EMBEDDING_SERVICES_DEFINITION,
	EMBEDDING_SERVICES_TABLE,
	JOBS_DEFINITION,
	JOBS_TABLE,
	KNOWLEDGE_BASES_DEFINITION,
	KNOWLEDGE_BASES_TABLE,
	LLM_SERVICES_DEFINITION,
	LLM_SERVICES_TABLE,
	MCP_TOOLS_DEFINITION,
	MCP_TOOLS_TABLE,
	MESSAGES_DEFINITION,
	MESSAGES_TABLE,
	RAG_DOCUMENTS_BY_HASH_DEFINITION,
	RAG_DOCUMENTS_BY_HASH_TABLE,
	RAG_DOCUMENTS_BY_STATUS_DEFINITION,
	RAG_DOCUMENTS_BY_STATUS_TABLE,
	RAG_DOCUMENTS_DEFINITION,
	RAG_DOCUMENTS_TABLE,
	RERANKING_SERVICES_DEFINITION,
	RERANKING_SERVICES_TABLE,
	WORKSPACES_DEFINITION,
	WORKSPACES_TABLE,
} from "./table-definitions.js";
import type { TablesBundle } from "./tables.js";

export interface AstraClientConfig {
	readonly endpoint: string;
	readonly token: string;
	readonly keyspace: string;
}

/**
 * Open a Data API connection, ensure the four `wb_*` tables exist,
 * and return a {@link TablesBundle} backed by real astra-db-ts tables.
 *
 * Idempotent — safe to call on every process start. Table creation
 * uses `ifNotExists: true` so existing schemas aren't touched.
 */
export async function openAstraClient(
	config: AstraClientConfig,
): Promise<TablesBundle> {
	const client = new DataAPIClient(config.token);
	const db = client.db(config.endpoint, { keyspace: config.keyspace });

	await ensureTables(db);

	return {
		workspaces: db.table<WorkspaceRow>(WORKSPACES_TABLE),
		jobs: db.table<JobRow>(JOBS_TABLE),
		apiKeys: db.table<ApiKeyRow>(API_KEYS_TABLE),
		apiKeyLookup: db.table<ApiKeyLookupRow>(API_KEY_LOOKUP_TABLE),
		// Knowledge-base schema (issue #98).
		configWorkspaces: db.table<ConfigWorkspaceRow>(CONFIG_WORKSPACES_TABLE),
		knowledgeBases: db.table<KnowledgeBaseRow>(KNOWLEDGE_BASES_TABLE),
		chunkingServices: db.table<ChunkingServiceRow>(CHUNKING_SERVICES_TABLE),
		embeddingServices: db.table<EmbeddingServiceRow>(EMBEDDING_SERVICES_TABLE),
		rerankingServices: db.table<RerankingServiceRow>(RERANKING_SERVICES_TABLE),
		llmServices: db.table<LlmServiceRow>(LLM_SERVICES_TABLE),
		mcpTools: db.table<McpToolRow>(MCP_TOOLS_TABLE),
		ragDocuments: db.table<RagDocumentRow>(RAG_DOCUMENTS_TABLE),
		ragDocumentsByStatus: db.table<RagDocumentByStatusRow>(
			RAG_DOCUMENTS_BY_STATUS_TABLE,
		),
		ragDocumentsByHash: db.table<RagDocumentByContentHashRow>(
			RAG_DOCUMENTS_BY_HASH_TABLE,
		),
		agents: db.table<AgentRow>(AGENTS_TABLE),
		conversations: db.table<ConversationRow>(CONVERSATIONS_TABLE),
		messages: db.table<MessageRow>(MESSAGES_TABLE),
	};
}

async function ensureTables(db: Db): Promise<void> {
	await Promise.all([
		db.createTable(WORKSPACES_TABLE, {
			definition: WORKSPACES_DEFINITION,
			ifNotExists: true,
		}),
		db.createTable(JOBS_TABLE, {
			definition: JOBS_DEFINITION,
			ifNotExists: true,
		}),
		db.createTable(API_KEYS_TABLE, {
			definition: API_KEYS_DEFINITION,
			ifNotExists: true,
		}),
		db.createTable(API_KEY_LOOKUP_TABLE, {
			definition: API_KEY_LOOKUP_DEFINITION,
			ifNotExists: true,
		}),
		// Knowledge-base schema (issue #98).
		db.createTable(CONFIG_WORKSPACES_TABLE, {
			definition: CONFIG_WORKSPACES_DEFINITION,
			ifNotExists: true,
		}),
		db.createTable(KNOWLEDGE_BASES_TABLE, {
			definition: KNOWLEDGE_BASES_DEFINITION,
			ifNotExists: true,
		}),
		db.createTable(CHUNKING_SERVICES_TABLE, {
			definition: CHUNKING_SERVICES_DEFINITION,
			ifNotExists: true,
		}),
		db.createTable(EMBEDDING_SERVICES_TABLE, {
			definition: EMBEDDING_SERVICES_DEFINITION,
			ifNotExists: true,
		}),
		db.createTable(RERANKING_SERVICES_TABLE, {
			definition: RERANKING_SERVICES_DEFINITION,
			ifNotExists: true,
		}),
		db.createTable(LLM_SERVICES_TABLE, {
			definition: LLM_SERVICES_DEFINITION,
			ifNotExists: true,
		}),
		db.createTable(MCP_TOOLS_TABLE, {
			definition: MCP_TOOLS_DEFINITION,
			ifNotExists: true,
		}),
		db.createTable(RAG_DOCUMENTS_TABLE, {
			definition: RAG_DOCUMENTS_DEFINITION,
			ifNotExists: true,
		}),
		db.createTable(RAG_DOCUMENTS_BY_STATUS_TABLE, {
			definition: RAG_DOCUMENTS_BY_STATUS_DEFINITION,
			ifNotExists: true,
		}),
		db.createTable(RAG_DOCUMENTS_BY_HASH_TABLE, {
			definition: RAG_DOCUMENTS_BY_HASH_DEFINITION,
			ifNotExists: true,
		}),
		db.createTable(AGENTS_TABLE, {
			definition: AGENTS_DEFINITION,
			ifNotExists: true,
		}),
		db.createTable(CONVERSATIONS_TABLE, {
			definition: CONVERSATIONS_DEFINITION,
			ifNotExists: true,
		}),
		db.createTable(MESSAGES_TABLE, {
			definition: MESSAGES_DEFINITION,
			ifNotExists: true,
		}),
	]);
}
