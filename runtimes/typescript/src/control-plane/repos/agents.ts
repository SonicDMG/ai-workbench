/**
 * Agent aggregate (workspace-scoped). User-defined agents are created
 * explicitly via `createAgent`; `deleteAgent` cascades the agent's
 * conversations + messages.
 */

import type { AgentRecord } from "../types.js";

/**
 * Input for {@link AgentRepo.createAgent}. User-defined agents use
 * random UUIDs (or a caller-supplied UUID).
 *
 * `knowledgeBaseIds` here is the **agent's default** — at chat time
 * the conversation row's per-conversation `knowledgeBaseIds` filter
 * takes precedence. Today the chat routes pull from the conversation,
 * not the agent; the agent field is metadata for future per-agent
 * retrieval defaults.
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

export interface AgentRepo {
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
}
