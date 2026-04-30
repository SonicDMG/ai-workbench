/**
 * Backend-agnostic contract for the workbench control plane.
 *
 * Implementations:
 *  - {@link ./memory/store.MemoryControlPlaneStore} — in-process, default.
 *  - {@link ./file/store.FileControlPlaneStore} — JSON on disk, single-node.
 *  - `AstraControlPlaneStore` — Data API Tables via astra-db-ts.
 *
 * Every method is async to allow any backend to be I/O-bound. Synchronous
 * backends simply resolve immediately.
 *
 * Error contract: methods throw {@link ./errors} classes for predictable
 * conditions (not-found, conflict, unavailable). Other thrown errors are
 * treated as internal errors by the route layer.
 */

import type {
	AgentRecord,
	AgentRole,
	ApiKeyRecord,
	AuthType,
	ChunkingServiceRecord,
	ConversationRecord,
	DistanceMetric,
	DocumentStatus,
	EmbeddingServiceRecord,
	KnowledgeBaseLanguage,
	KnowledgeBaseRecord,
	KnowledgeBaseStatus,
	KnowledgeFilterRecord,
	LexicalConfig,
	LlmServiceRecord,
	MessageRecord,
	RagDocumentRecord,
	RerankingServiceRecord,
	SecretRef,
	ServiceStatus,
	WorkspaceKind,
	WorkspaceRecord,
} from "./types.js";

/* ------------------------------------------------------------------ */
/* Workspace                                                          */
/* ------------------------------------------------------------------ */

export interface CreateWorkspaceInput {
	/** Optional — generated if omitted. */
	readonly uid?: string;
	readonly name: string;
	readonly url?: string | null;
	readonly kind: WorkspaceKind;
	readonly credentials?: Readonly<Record<string, SecretRef>>;
	readonly keyspace?: string | null;
}

/**
 * Patch a workspace. `kind` is intentionally absent — a workspace's
 * backend is immutable after creation (changing it would orphan any
 * vector-store collections that already exist on the old backend).
 * Delete and recreate if the kind needs to change.
 */
export interface UpdateWorkspaceInput {
	readonly name?: string;
	readonly url?: string | null;
	readonly credentials?: Readonly<Record<string, SecretRef>>;
	readonly keyspace?: string | null;
}

/* ------------------------------------------------------------------ */
/* RAG document (KB-scoped — issue #98)                               */
/* ------------------------------------------------------------------ */

export interface CreateRagDocumentInput {
	readonly uid?: string;
	readonly sourceDocId?: string | null;
	readonly sourceFilename?: string | null;
	readonly fileType?: string | null;
	readonly fileSize?: number | null;
	readonly contentHash?: string | null;
	readonly chunkTotal?: number | null;
	readonly ingestedAt?: string | null;
	readonly status?: DocumentStatus;
	readonly errorMessage?: string | null;
	readonly metadata?: Readonly<Record<string, string>>;
}

export type UpdateRagDocumentInput = Partial<
	Omit<CreateRagDocumentInput, "uid">
>;

/* ------------------------------------------------------------------ */
/* API key                                                            */
/* ------------------------------------------------------------------ */

/**
 * Parameters needed to persist an {@link ApiKeyRecord}. The
 * caller is responsible for generating the keyId / prefix / hash
 * and handing the plaintext to the user exactly once.
 */
export interface PersistApiKeyInput {
	readonly keyId: string;
	readonly prefix: string;
	readonly hash: string;
	readonly label: string;
	readonly expiresAt?: string | null;
}

/* ------------------------------------------------------------------ */
/* Knowledge base (issue #98)                                         */
/* ------------------------------------------------------------------ */

export interface CreateKnowledgeBaseInput {
	readonly uid?: string;
	readonly name: string;
	readonly description?: string | null;
	readonly status?: KnowledgeBaseStatus;
	readonly embeddingServiceId: string;
	readonly chunkingServiceId: string;
	readonly rerankingServiceId?: string | null;
	readonly language?: KnowledgeBaseLanguage | null;
	readonly lexical?: LexicalConfig;
	/** Optional override for the auto-provisioned vector collection name.
	 * If omitted the store generates `wb_vectors_<knowledge_base_id>`. */
	readonly vectorCollection?: string | null;
	/** When `false`, the runtime did NOT provision the underlying
	 * collection (KB was attached to a pre-existing one) and `DELETE`
	 * must NOT drop it. Defaults to `true` for backward compatibility. */
	readonly owned?: boolean;
}

/**
 * Patch a Knowledge Base. `embeddingServiceId` and `chunkingServiceId`
 * are intentionally absent — they're immutable after creation because
 * existing vectors / chunks on disk are bound to the model that
 * produced them. Re-embedding is a separate operation.
 */
export interface UpdateKnowledgeBaseInput {
	readonly name?: string;
	readonly description?: string | null;
	readonly status?: KnowledgeBaseStatus;
	readonly rerankingServiceId?: string | null;
	readonly language?: KnowledgeBaseLanguage | null;
	readonly lexical?: LexicalConfig;
}

/* ------------------------------------------------------------------ */
/* Knowledge filters (issue #98)                                      */
/* ------------------------------------------------------------------ */

export interface CreateKnowledgeFilterInput {
	readonly uid?: string;
	readonly name: string;
	readonly description?: string | null;
	readonly filter: Readonly<Record<string, unknown>>;
}

export type UpdateKnowledgeFilterInput = Partial<
	Omit<CreateKnowledgeFilterInput, "uid">
>;

/* ------------------------------------------------------------------ */
/* Execution services (chunking, embedding, reranking)                */
/* ------------------------------------------------------------------ */

interface ServiceEndpointInput {
	readonly endpointBaseUrl?: string | null;
	readonly endpointPath?: string | null;
	readonly requestTimeoutMs?: number | null;
	readonly authType?: AuthType;
	readonly credentialRef?: SecretRef | null;
}

export interface CreateChunkingServiceInput extends ServiceEndpointInput {
	readonly uid?: string;
	readonly name: string;
	readonly description?: string | null;
	readonly status?: ServiceStatus;
	readonly engine: string;
	readonly engineVersion?: string | null;
	readonly strategy?: string | null;
	readonly maxChunkSize?: number | null;
	readonly minChunkSize?: number | null;
	readonly chunkUnit?: string | null;
	readonly overlapSize?: number | null;
	readonly overlapUnit?: string | null;
	readonly preserveStructure?: boolean | null;
	readonly language?: string | null;
	readonly maxPayloadSizeKb?: number | null;
	readonly enableOcr?: boolean | null;
	readonly extractTables?: boolean | null;
	readonly extractFigures?: boolean | null;
	readonly readingOrder?: string | null;
}

export type UpdateChunkingServiceInput = Partial<
	Omit<CreateChunkingServiceInput, "uid">
>;

export interface CreateEmbeddingServiceInput extends ServiceEndpointInput {
	readonly uid?: string;
	readonly name: string;
	readonly description?: string | null;
	readonly status?: ServiceStatus;
	readonly provider: string;
	readonly modelName: string;
	readonly embeddingDimension: number;
	readonly distanceMetric?: DistanceMetric;
	readonly maxBatchSize?: number | null;
	readonly maxInputTokens?: number | null;
	readonly supportedLanguages?: ReadonlySet<string> | readonly string[];
	readonly supportedContent?: ReadonlySet<string> | readonly string[];
}

export type UpdateEmbeddingServiceInput = Partial<
	Omit<CreateEmbeddingServiceInput, "uid">
>;

export interface CreateRerankingServiceInput extends ServiceEndpointInput {
	readonly uid?: string;
	readonly name: string;
	readonly description?: string | null;
	readonly status?: ServiceStatus;
	readonly provider: string;
	readonly engine?: string | null;
	readonly modelName: string;
	readonly modelVersion?: string | null;
	readonly maxCandidates?: number | null;
	readonly scoringStrategy?: string | null;
	readonly scoreNormalized?: boolean | null;
	readonly returnScores?: boolean | null;
	readonly maxBatchSize?: number | null;
	readonly supportedLanguages?: ReadonlySet<string> | readonly string[];
	readonly supportedContent?: ReadonlySet<string> | readonly string[];
}

export type UpdateRerankingServiceInput = Partial<
	Omit<CreateRerankingServiceInput, "uid">
>;

export interface CreateLlmServiceInput extends ServiceEndpointInput {
	readonly uid?: string;
	readonly name: string;
	readonly description?: string | null;
	readonly status?: ServiceStatus;
	readonly provider: string;
	readonly engine?: string | null;
	readonly modelName: string;
	readonly modelVersion?: string | null;
	readonly contextWindowTokens?: number | null;
	readonly maxOutputTokens?: number | null;
	readonly temperatureMin?: number | null;
	readonly temperatureMax?: number | null;
	readonly supportsStreaming?: boolean | null;
	readonly supportsTools?: boolean | null;
	readonly maxBatchSize?: number | null;
	readonly supportedLanguages?: ReadonlySet<string> | readonly string[];
	readonly supportedContent?: ReadonlySet<string> | readonly string[];
}

export type UpdateLlmServiceInput = Partial<Omit<CreateLlmServiceInput, "uid">>;

/* ------------------------------------------------------------------ */
/* Agents (workspace-scoped, agentic-tables-backed)                   */
/* ------------------------------------------------------------------ */

/**
 * Input for {@link ControlPlaneStore.createAgent}. User-defined
 * agents use random UUIDs (or a caller-supplied UUID).
 *
 * `knowledgeBaseIds` here is the **agent's default** — at chat
 * time the conversation row's per-conversation
 * `knowledgeBaseIds` filter takes precedence. Today the chat
 * routes pull from the conversation, not the agent; the agent
 * field is metadata for future per-agent retrieval defaults.
 */
export interface CreateAgentInput {
	readonly agentId?: string;
	readonly name: string;
	readonly description?: string | null;
	readonly systemPrompt?: string | null;
	readonly userPrompt?: string | null;
	readonly knowledgeBaseIds?: readonly string[];
	readonly llmServiceId?: string | null;
	readonly ragEnabled?: boolean;
	readonly ragMaxResults?: number | null;
	readonly ragMinScore?: number | null;
	readonly rerankEnabled?: boolean;
	readonly rerankingServiceId?: string | null;
	readonly rerankMaxResults?: number | null;
}

export type UpdateAgentInput = Partial<Omit<CreateAgentInput, "agentId">>;

/**
 * Input for {@link ControlPlaneStore.createConversation}.
 *
 * `knowledgeBaseIds` is the per-conversation RAG-grounding set.
 * Empty / omitted = the conversation draws from all KBs in the
 * workspace at retrieval time. Populated = restricted to those KBs
 * (must exist; the store does **not** validate KB existence here —
 * the route layer does, so deleted KBs eventually disappear from the
 * set via {@link ControlPlaneStore.deleteKnowledgeBase}'s cascade).
 */
export interface CreateConversationInput {
	readonly conversationId?: string;
	readonly title?: string | null;
	readonly knowledgeBaseIds?: readonly string[];
}

export interface UpdateConversationInput {
	readonly title?: string | null;
	readonly knowledgeBaseIds?: readonly string[];
}

/**
 * Input for {@link ControlPlaneStore.appendChatMessage}. `messageTs`
 * is server-stamped if omitted — callers should generally let the
 * store stamp it so chronological cluster ordering is monotonic.
 *
 * `metadata` is a free-form string map; it carries RAG provenance
 * (`context_document_ids`), HF model, finish reason, and any error
 * detail for streaming finalization. Stringly-typed for v0.
 */
export interface AppendChatMessageInput {
	readonly messageId?: string;
	readonly messageTs?: string;
	readonly role: AgentRole;
	readonly authorId?: string | null;
	readonly content?: string | null;
	readonly toolId?: string | null;
	readonly toolCallPayload?: Readonly<Record<string, unknown>> | null;
	readonly toolResponse?: Readonly<Record<string, unknown>> | null;
	readonly tokenCount?: number | null;
	readonly metadata?: Readonly<Record<string, string>>;
}

/**
 * Patch a previously-appended message. The streaming flow inserts an
 * empty assistant placeholder at stream start, then patches `content`
 * + `metadata` (finish reason etc.) when the stream completes.
 *
 * `metadata` is **merged** key-by-key into the existing map (not
 * replaced) so callers can update individual provenance fields
 * without re-sending everything. Pass an explicit `undefined` value
 * to drop a key. `null` patch fields clear the corresponding column.
 */
export interface UpdateChatMessageInput {
	readonly content?: string | null;
	readonly tokenCount?: number | null;
	readonly metadata?: Readonly<Record<string, string | undefined>>;
}

/* ------------------------------------------------------------------ */
/* Store                                                              */
/* ------------------------------------------------------------------ */

/**
 * Canonical control-plane interface. All methods MUST behave identically
 * across backends modulo durability — a record written must be visible
 * to subsequent reads on the same store instance.
 */
export interface ControlPlaneStore {
	/* Workspaces */
	listWorkspaces(): Promise<readonly WorkspaceRecord[]>;
	getWorkspace(uid: string): Promise<WorkspaceRecord | null>;
	createWorkspace(input: CreateWorkspaceInput): Promise<WorkspaceRecord>;
	updateWorkspace(
		uid: string,
		patch: UpdateWorkspaceInput,
	): Promise<WorkspaceRecord>;
	deleteWorkspace(uid: string): Promise<{ deleted: boolean }>;

	/* API keys */
	listApiKeys(workspace: string): Promise<readonly ApiKeyRecord[]>;
	getApiKey(workspace: string, keyId: string): Promise<ApiKeyRecord | null>;
	persistApiKey(
		workspace: string,
		input: PersistApiKeyInput,
	): Promise<ApiKeyRecord>;
	revokeApiKey(workspace: string, keyId: string): Promise<{ revoked: boolean }>;
	/**
	 * Global lookup by wire prefix. Used by the API-key verifier on
	 * every authenticated request — must be O(1) / O(log N) on real
	 * backends. Memory and file walk; astra uses a dedicated lookup
	 * table partitioned by prefix.
	 */
	findApiKeyByPrefix(prefix: string): Promise<ApiKeyRecord | null>;
	/** Fire-and-forget bump of `lastUsedAt` after a successful verify. */
	touchApiKey(workspace: string, keyId: string): Promise<void>;

	/* RAG documents (KB-scoped, issue #98). New surface backed by
	 * `wb_rag_documents_by_knowledge_base`. The legacy catalog-scoped
	 * Document methods above stay until phase 1c drops `/catalogs`. */
	listRagDocuments(
		workspace: string,
		knowledgeBase: string,
	): Promise<readonly RagDocumentRecord[]>;
	getRagDocument(
		workspace: string,
		knowledgeBase: string,
		uid: string,
	): Promise<RagDocumentRecord | null>;
	createRagDocument(
		workspace: string,
		knowledgeBase: string,
		input: CreateRagDocumentInput,
	): Promise<RagDocumentRecord>;
	updateRagDocument(
		workspace: string,
		knowledgeBase: string,
		uid: string,
		patch: UpdateRagDocumentInput,
	): Promise<RagDocumentRecord>;
	deleteRagDocument(
		workspace: string,
		knowledgeBase: string,
		uid: string,
	): Promise<{ deleted: boolean }>;

	/* Knowledge bases (issue #98) */
	listKnowledgeBases(
		workspace: string,
	): Promise<readonly KnowledgeBaseRecord[]>;
	getKnowledgeBase(
		workspace: string,
		uid: string,
	): Promise<KnowledgeBaseRecord | null>;
	createKnowledgeBase(
		workspace: string,
		input: CreateKnowledgeBaseInput,
	): Promise<KnowledgeBaseRecord>;
	updateKnowledgeBase(
		workspace: string,
		uid: string,
		patch: UpdateKnowledgeBaseInput,
	): Promise<KnowledgeBaseRecord>;
	deleteKnowledgeBase(
		workspace: string,
		uid: string,
	): Promise<{ deleted: boolean }>;

	/* Knowledge filters */
	listKnowledgeFilters(
		workspace: string,
		knowledgeBase: string,
	): Promise<readonly KnowledgeFilterRecord[]>;
	getKnowledgeFilter(
		workspace: string,
		knowledgeBase: string,
		uid: string,
	): Promise<KnowledgeFilterRecord | null>;
	createKnowledgeFilter(
		workspace: string,
		knowledgeBase: string,
		input: CreateKnowledgeFilterInput,
	): Promise<KnowledgeFilterRecord>;
	updateKnowledgeFilter(
		workspace: string,
		knowledgeBase: string,
		uid: string,
		patch: UpdateKnowledgeFilterInput,
	): Promise<KnowledgeFilterRecord>;
	deleteKnowledgeFilter(
		workspace: string,
		knowledgeBase: string,
		uid: string,
	): Promise<{ deleted: boolean }>;

	/* Chunking services */
	listChunkingServices(
		workspace: string,
	): Promise<readonly ChunkingServiceRecord[]>;
	getChunkingService(
		workspace: string,
		uid: string,
	): Promise<ChunkingServiceRecord | null>;
	createChunkingService(
		workspace: string,
		input: CreateChunkingServiceInput,
	): Promise<ChunkingServiceRecord>;
	updateChunkingService(
		workspace: string,
		uid: string,
		patch: UpdateChunkingServiceInput,
	): Promise<ChunkingServiceRecord>;
	deleteChunkingService(
		workspace: string,
		uid: string,
	): Promise<{ deleted: boolean }>;

	/* Embedding services */
	listEmbeddingServices(
		workspace: string,
	): Promise<readonly EmbeddingServiceRecord[]>;
	getEmbeddingService(
		workspace: string,
		uid: string,
	): Promise<EmbeddingServiceRecord | null>;
	createEmbeddingService(
		workspace: string,
		input: CreateEmbeddingServiceInput,
	): Promise<EmbeddingServiceRecord>;
	updateEmbeddingService(
		workspace: string,
		uid: string,
		patch: UpdateEmbeddingServiceInput,
	): Promise<EmbeddingServiceRecord>;
	deleteEmbeddingService(
		workspace: string,
		uid: string,
	): Promise<{ deleted: boolean }>;

	/* Reranking services */
	listRerankingServices(
		workspace: string,
	): Promise<readonly RerankingServiceRecord[]>;
	getRerankingService(
		workspace: string,
		uid: string,
	): Promise<RerankingServiceRecord | null>;
	createRerankingService(
		workspace: string,
		input: CreateRerankingServiceInput,
	): Promise<RerankingServiceRecord>;
	updateRerankingService(
		workspace: string,
		uid: string,
		patch: UpdateRerankingServiceInput,
	): Promise<RerankingServiceRecord>;
	deleteRerankingService(
		workspace: string,
		uid: string,
	): Promise<{ deleted: boolean }>;

	/* LLM services. Workspace-scoped definitions of how to call a
	 * chat/generation model. Multiple agents in the same workspace may
	 * reference one by id via `agent.llmServiceId`. Deleting a service
	 * that an agent points at is rejected with 409 (matches the
	 * embedding/chunking pattern). */
	listLlmServices(workspace: string): Promise<readonly LlmServiceRecord[]>;
	getLlmService(
		workspace: string,
		uid: string,
	): Promise<LlmServiceRecord | null>;
	createLlmService(
		workspace: string,
		input: CreateLlmServiceInput,
	): Promise<LlmServiceRecord>;
	updateLlmService(
		workspace: string,
		uid: string,
		patch: UpdateLlmServiceInput,
	): Promise<LlmServiceRecord>;
	deleteLlmService(
		workspace: string,
		uid: string,
	): Promise<{ deleted: boolean }>;

	/* Agents (workspace-scoped). User-defined agents are created
	 * explicitly via `createAgent`. `deleteAgent` cascades the
	 * agent's conversations + messages. */
	listAgents(workspaceId: string): Promise<readonly AgentRecord[]>;
	getAgent(workspaceId: string, agentId: string): Promise<AgentRecord | null>;
	createAgent(
		workspaceId: string,
		input: CreateAgentInput,
	): Promise<AgentRecord>;
	updateAgent(
		workspaceId: string,
		agentId: string,
		patch: UpdateAgentInput,
	): Promise<AgentRecord>;
	deleteAgent(
		workspaceId: string,
		agentId: string,
	): Promise<{ deleted: boolean }>;

	/* Conversations (agent-scoped). The agent-aware surface backing
	 * `/agents/{a}/conversations[/{c}/messages]`. Messages live in a
	 * separate (workspace, conversation) partition — see the
	 * `*ChatMessage*` methods below. */
	listConversations(
		workspaceId: string,
		agentId: string,
	): Promise<readonly ConversationRecord[]>;
	getConversation(
		workspaceId: string,
		agentId: string,
		conversationId: string,
	): Promise<ConversationRecord | null>;
	createConversation(
		workspaceId: string,
		agentId: string,
		input: CreateConversationInput,
	): Promise<ConversationRecord>;
	updateConversation(
		workspaceId: string,
		agentId: string,
		conversationId: string,
		patch: UpdateConversationInput,
	): Promise<ConversationRecord>;
	deleteConversation(
		workspaceId: string,
		agentId: string,
		conversationId: string,
	): Promise<{ deleted: boolean }>;

	/* Chat messages (conversation-scoped). Agent-agnostic from the
	 * storage POV — messages are partitioned by (workspace,
	 * conversation), not by agent — so the agent doesn't appear in
	 * these signatures. The legacy method names are retained for
	 * Phase C; a follow-up pass will rename them to
	 * `*ConversationMessage*`. */

	/**
	 * Chronologically-ordered message history for a conversation.
	 * Returns messages oldest-first (matching the underlying table's
	 * `message_ts ASC` cluster key); the UI flips for display.
	 */
	listChatMessages(
		workspaceId: string,
		conversationId: string,
	): Promise<readonly MessageRecord[]>;

	/**
	 * Append a turn. Throws {@link ControlPlaneNotFoundError} if the
	 * conversation doesn't exist. Stamps `messageId` (random UUID)
	 * and `messageTs` (now) when omitted.
	 */
	appendChatMessage(
		workspaceId: string,
		conversationId: string,
		input: AppendChatMessageInput,
	): Promise<MessageRecord>;

	/**
	 * Patch a previously-appended message. Used by the streaming flow
	 * to finalize an assistant placeholder once the model emits a
	 * terminal event. Throws {@link ControlPlaneNotFoundError} if the
	 * message isn't found.
	 */
	updateChatMessage(
		workspaceId: string,
		conversationId: string,
		messageId: string,
		patch: UpdateChatMessageInput,
	): Promise<MessageRecord>;

	/** Optional: run migrations, open connections, etc. Idempotent. */
	init?(): Promise<void>;

	/** Optional: release connections and flush buffers. Idempotent. */
	close?(): Promise<void>;
}
