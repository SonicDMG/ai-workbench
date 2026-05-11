/**
 * Shared state for {@link ./store.AstraControlPlaneStore}.
 *
 * The Astra backend holds no state of its own — every read/write goes
 * through the Astra Data API. The "state" threaded through each slice
 * is therefore just a {@link TablesBundle} reference plus a set of
 * `findOne`-backed existence assertions shared across slices.
 *
 * Each per-aggregate slice file consumes a narrow view of this state
 * (only the tables it needs). Cross-aggregate cascades reach into the
 * broader bundle through this single object, exactly like the in-memory
 * backend.
 */

import type { TablesBundle } from "../../astra-client/tables.js";
import { ControlPlaneNotFoundError } from "../errors.js";

/**
 * Single mutable shared object — for parity with `MemoryStoreState`.
 * The only field is the {@link TablesBundle} since every Astra
 * operation goes through it.
 */
export interface AstraStoreState {
	readonly tables: TablesBundle;
}

/** Throws {@link ControlPlaneNotFoundError} if the workspace is missing. */
export async function assertWorkspace(
	state: AstraStoreState,
	uid: string,
): Promise<void> {
	const row = await state.tables.workspaces.findOne({ uid });
	if (!row) {
		throw new ControlPlaneNotFoundError("workspace", uid);
	}
}

export async function assertKnowledgeBase(
	state: AstraStoreState,
	workspace: string,
	knowledgeBase: string,
): Promise<void> {
	await assertWorkspace(state, workspace);
	const row = await state.tables.knowledgeBases.findOne({
		workspace_id: workspace,
		knowledge_base_id: knowledgeBase,
	});
	if (!row) {
		throw new ControlPlaneNotFoundError("knowledge base", knowledgeBase);
	}
}

export async function assertChunkingService(
	state: AstraStoreState,
	workspace: string,
	uid: string,
): Promise<void> {
	const row = await state.tables.chunkingServices.findOne({
		workspace_id: workspace,
		chunking_service_id: uid,
	});
	if (!row) {
		throw new ControlPlaneNotFoundError("chunking service", uid);
	}
}

export async function assertEmbeddingService(
	state: AstraStoreState,
	workspace: string,
	uid: string,
): Promise<void> {
	const row = await state.tables.embeddingServices.findOne({
		workspace_id: workspace,
		embedding_service_id: uid,
	});
	if (!row) {
		throw new ControlPlaneNotFoundError("embedding service", uid);
	}
}

export async function assertRerankingService(
	state: AstraStoreState,
	workspace: string,
	uid: string,
): Promise<void> {
	const row = await state.tables.rerankingServices.findOne({
		workspace_id: workspace,
		reranking_service_id: uid,
	});
	if (!row) {
		throw new ControlPlaneNotFoundError("reranking service", uid);
	}
}

export async function assertLlmService(
	state: AstraStoreState,
	workspace: string,
	uid: string,
): Promise<void> {
	const row = await state.tables.llmServices.findOne({
		workspace_id: workspace,
		llm_service_id: uid,
	});
	if (!row) {
		throw new ControlPlaneNotFoundError("llm service", uid);
	}
}

export async function assertAgent(
	state: AstraStoreState,
	workspaceId: string,
	agentId: string,
): Promise<void> {
	await assertWorkspace(state, workspaceId);
	const row = await state.tables.agents.findOne({
		workspace_id: workspaceId,
		agent_id: agentId,
	});
	if (!row) {
		throw new ControlPlaneNotFoundError("agent", agentId);
	}
}

/**
 * Resolve a conversation across any agent in the workspace. Used by
 * `appendChatMessage` / `listChatMessages` / `updateChatMessage`, which
 * are agent-agnostic from the storage POV — messages are partitioned
 * by (workspace, conversation), not by agent.
 */
export async function assertChat(
	state: AstraStoreState,
	workspaceId: string,
	chatId: string,
): Promise<void> {
	await assertWorkspace(state, workspaceId);
	const row = await state.tables.conversations.findOne({
		workspace_id: workspaceId,
		conversation_id: chatId,
	});
	if (!row) {
		throw new ControlPlaneNotFoundError("chat", chatId);
	}
}
