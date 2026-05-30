/**
 * Shared in-memory state for {@link ./store.MemoryControlPlaneStore}.
 *
 * Each per-aggregate slice file under this directory consumes a
 * narrow view of this state plus a set of assertion helpers. The
 * store shell owns the single instance of this state and threads it
 * through every slice constructor.
 *
 * Every Map keyed `Map<string, Map<string, Record>>` follows the same
 * `Map<workspaceId, Map<recordId, Record>>` shape — see the
 * {@link ./store.ts} module doc for the full layout.
 */

import { ControlPlaneNotFoundError } from "../errors.js";
import type {
	AgentRecord,
	ChunkingServiceRecord,
	ConversationRecord,
	EmbeddingServiceRecord,
	KnowledgeBaseRecord,
	KnowledgeFilterRecord,
	LlmServiceRecord,
	McpServerRecord,
	MessageRecord,
	PolicyAuditRecord,
	PrincipalRecord,
	RagDocumentRecord,
	RerankingServiceRecord,
	WorkspaceRecord,
} from "../types.js";
import type { MemoryApiKeyRepository } from "./api-key-repository.js";

/** `${workspaceId}:${childId}` composite key used by KB-scoped maps. */
export function docKey(workspace: string, catalog: string): string {
	return `${workspace}:${catalog}`;
}

/**
 * Mutable shared state. The slice files only ever read/mutate the
 * fields they are responsible for; cross-aggregate cascades reach
 * into the broader state through this single object.
 */
export interface MemoryStoreState {
	readonly workspaces: Map<string, WorkspaceRecord>;
	// KB-scoped RAG documents (issue #98). `${workspaceId}:${kbId}` keyed.
	readonly ragDocuments: Map<string, Map<string, RagDocumentRecord>>;
	// API keys live in their own repository — see the
	// `api-key-repository.ts` doc comment for the decomposition plan
	// the rest of the resource groups follow.
	readonly apiKeyRepo: MemoryApiKeyRepository;
	// Knowledge-base schema (issue #98). All four maps follow the same
	// `Map<workspaceId, Map<recordId, Record>>` shape.
	readonly knowledgeBases: Map<string, Map<string, KnowledgeBaseRecord>>;
	readonly knowledgeFilters: Map<string, Map<string, KnowledgeFilterRecord>>;
	readonly chunkingServices: Map<string, Map<string, ChunkingServiceRecord>>;
	readonly embeddingServices: Map<string, Map<string, EmbeddingServiceRecord>>;
	readonly rerankingServices: Map<string, Map<string, RerankingServiceRecord>>;
	readonly llmServices: Map<string, Map<string, LlmServiceRecord>>;
	// Agentic tables (Stage-2 schema). Agents partitioned by
	// workspace; conversations by (workspace, agent); messages by
	// (workspace, conversation).
	readonly agents: Map<string, Map<string, AgentRecord>>;
	readonly conversations: Map<string, Map<string, ConversationRecord>>; // keyed by `${workspace}:${agent}`
	readonly messages: Map<string, Map<string, MessageRecord>>; // keyed by `${workspace}:${conversation}`
	// RLAC prototype. Principals are workspace-scoped; audit is an
	// append-only list keyed by workspace.
	readonly principals: Map<string, Map<string, PrincipalRecord>>;
	readonly policyAudit: Map<string, PolicyAuditRecord[]>;
	// External MCP servers (0.4.0 A2). Workspace-scoped, same shape as
	// every other `Map<workspaceId, Map<recordId, Record>>` aggregate.
	readonly mcpServers: Map<string, Map<string, McpServerRecord>>;
}

/** Throws {@link ControlPlaneNotFoundError} if the workspace is missing. */
export async function assertWorkspace(
	state: MemoryStoreState,
	uid: string,
): Promise<void> {
	if (!state.workspaces.has(uid)) {
		throw new ControlPlaneNotFoundError("workspace", uid);
	}
}

export async function assertKnowledgeBase(
	state: MemoryStoreState,
	workspace: string,
	knowledgeBase: string,
): Promise<void> {
	await assertWorkspace(state, workspace);
	if (!state.knowledgeBases.get(workspace)?.has(knowledgeBase)) {
		throw new ControlPlaneNotFoundError("knowledge base", knowledgeBase);
	}
}

export async function assertChunkingService(
	state: MemoryStoreState,
	workspace: string,
	uid: string,
): Promise<void> {
	if (!state.chunkingServices.get(workspace)?.has(uid)) {
		throw new ControlPlaneNotFoundError("chunking service", uid);
	}
}

export async function assertEmbeddingService(
	state: MemoryStoreState,
	workspace: string,
	uid: string,
): Promise<void> {
	if (!state.embeddingServices.get(workspace)?.has(uid)) {
		throw new ControlPlaneNotFoundError("embedding service", uid);
	}
}

export async function assertRerankingService(
	state: MemoryStoreState,
	workspace: string,
	uid: string,
): Promise<void> {
	if (!state.rerankingServices.get(workspace)?.has(uid)) {
		throw new ControlPlaneNotFoundError("reranking service", uid);
	}
}

export async function assertLlmService(
	state: MemoryStoreState,
	workspace: string,
	uid: string,
): Promise<void> {
	if (!state.llmServices.get(workspace)?.has(uid)) {
		throw new ControlPlaneNotFoundError("llm service", uid);
	}
}

export async function assertAgent(
	state: MemoryStoreState,
	workspaceId: string,
	agentId: string,
): Promise<void> {
	await assertWorkspace(state, workspaceId);
	if (!state.agents.get(workspaceId)?.has(agentId)) {
		throw new ControlPlaneNotFoundError("agent", agentId);
	}
}

/**
 * Resolve a conversation across any agent in the workspace. Used by
 * `appendChatMessage` / `listChatMessages` / `updateChatMessage`,
 * which are agent-agnostic from the storage POV — messages are
 * partitioned by (workspace, conversation), not by agent.
 */
export async function assertChat(
	state: MemoryStoreState,
	workspaceId: string,
	chatId: string,
): Promise<void> {
	await assertWorkspace(state, workspaceId);
	for (const [key, byChat] of state.conversations.entries()) {
		if (!key.startsWith(`${workspaceId}:`)) continue;
		if (byChat.has(chatId)) return;
	}
	throw new ControlPlaneNotFoundError("chat", chatId);
}
