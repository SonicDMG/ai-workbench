/**
 * Agent aggregate slice. Owns the
 * `Map<workspaceId, Map<agentId, AgentRecord>>` partition plus the
 * cascade across conversations and chat messages on agent delete.
 */

import { randomUUID } from "node:crypto";
import { nowIso } from "../defaults.js";
import {
	ControlPlaneConflictError,
	ControlPlaneNotFoundError,
} from "../errors.js";
import {
	buildAgentRecord,
	byAgentCreatedAtAsc,
	freezeStringSet,
} from "../shared/records.js";
import type {
	AgentRepo,
	CreateAgentInput,
	UpdateAgentInput,
} from "../store.js";
import type { AgentRecord } from "../types.js";
import {
	assertLlmService,
	assertRerankingService,
	assertWorkspace,
	type MemoryStoreState,
} from "./state.js";

export function makeAgentMethods(state: MemoryStoreState): AgentRepo {
	return {
		async listAgents(workspaceId: string): Promise<readonly AgentRecord[]> {
			await assertWorkspace(state, workspaceId);
			const byAgent = state.agents.get(workspaceId);
			if (!byAgent) return [];
			return Array.from(byAgent.values()).sort(byAgentCreatedAtAsc);
		},

		async getAgent(
			workspaceId: string,
			agentId: string,
		): Promise<AgentRecord | null> {
			await assertWorkspace(state, workspaceId);
			return state.agents.get(workspaceId)?.get(agentId) ?? null;
		},

		async createAgent(
			workspaceId: string,
			input: CreateAgentInput,
		): Promise<AgentRecord> {
			await assertWorkspace(state, workspaceId);
			if (input.llmServiceId != null) {
				await assertLlmService(state, workspaceId, input.llmServiceId);
			}
			if (input.rerankingServiceId != null) {
				await assertRerankingService(
					state,
					workspaceId,
					input.rerankingServiceId,
				);
			}
			const agentId = input.agentId ?? randomUUID();
			const byAgent = state.agents.get(workspaceId) ?? new Map();
			if (byAgent.has(agentId)) {
				throw new ControlPlaneConflictError(
					`agent with id '${agentId}' already exists`,
				);
			}
			const record = buildAgentRecord(workspaceId, agentId, input);
			byAgent.set(agentId, record);
			state.agents.set(workspaceId, byAgent);
			return record;
		},

		async updateAgent(
			workspaceId: string,
			agentId: string,
			patch: UpdateAgentInput,
		): Promise<AgentRecord> {
			await assertWorkspace(state, workspaceId);
			if (patch.llmServiceId != null) {
				await assertLlmService(state, workspaceId, patch.llmServiceId);
			}
			if (patch.rerankingServiceId != null) {
				await assertRerankingService(
					state,
					workspaceId,
					patch.rerankingServiceId,
				);
			}
			const byAgent = state.agents.get(workspaceId);
			const existing = byAgent?.get(agentId);
			if (!existing) {
				throw new ControlPlaneNotFoundError("agent", agentId);
			}
			const next: AgentRecord = {
				...existing,
				...(patch.name !== undefined && { name: patch.name }),
				...(patch.description !== undefined && {
					description: patch.description,
				}),
				...(patch.systemPrompt !== undefined && {
					systemPrompt: patch.systemPrompt,
				}),
				...(patch.userPrompt !== undefined && { userPrompt: patch.userPrompt }),
				...(patch.llmServiceId !== undefined && {
					llmServiceId: patch.llmServiceId,
				}),
				...(patch.knowledgeBaseIds !== undefined && {
					knowledgeBaseIds: freezeStringSet(patch.knowledgeBaseIds),
				}),
				...(patch.toolIds !== undefined && {
					toolIds: freezeStringSet(patch.toolIds),
				}),
				...(patch.rerankEnabled !== undefined && {
					rerankEnabled: patch.rerankEnabled,
				}),
				...(patch.rerankingServiceId !== undefined && {
					rerankingServiceId: patch.rerankingServiceId,
				}),
				...(patch.rerankMaxResults !== undefined && {
					rerankMaxResults: patch.rerankMaxResults,
				}),
				updatedAt: nowIso(),
			};
			byAgent?.set(agentId, next);
			return next;
		},

		async deleteAgent(
			workspaceId: string,
			agentId: string,
		): Promise<{ deleted: boolean }> {
			await assertWorkspace(state, workspaceId);
			const deleted = state.agents.get(workspaceId)?.delete(agentId) ?? false;
			if (deleted) {
				// Cascade conversations + messages.
				const convKey = `${workspaceId}:${agentId}`;
				const byChat = state.conversations.get(convKey);
				if (byChat) {
					for (const conversationId of byChat.keys()) {
						state.messages.delete(`${workspaceId}:${conversationId}`);
					}
					state.conversations.delete(convKey);
				}
			}
			return { deleted };
		},
	};
}
