/**
 * Agent aggregate slice for the Astra-backed store. Owns
 * `wb_agents` plus the cascade across conversations and chat messages
 * on agent delete. Messages are partitioned by (workspace,
 * conversation) — we read the agent's conversation ids, then delete
 * each partition in turn (no cross-partition secondary index keyed by
 * agent_id).
 */

import { randomUUID } from "node:crypto";
import { agentFromRow, agentToRow } from "../../astra-client/converters.js";
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
	type AstraStoreState,
	assertLlmService,
	assertRerankingService,
	assertWorkspace,
} from "./state.js";

export function makeAgentMethods(state: AstraStoreState): AgentRepo {
	return {
		async listAgents(workspaceId: string): Promise<readonly AgentRecord[]> {
			await assertWorkspace(state, workspaceId);
			const rows = await state.tables.agents
				.find({ workspace_id: workspaceId })
				.toArray();
			return rows.map(agentFromRow).sort(byAgentCreatedAtAsc);
		},

		async getAgent(
			workspaceId: string,
			agentId: string,
		): Promise<AgentRecord | null> {
			await assertWorkspace(state, workspaceId);
			const row = await state.tables.agents.findOne({
				workspace_id: workspaceId,
				agent_id: agentId,
			});
			return row ? agentFromRow(row) : null;
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
			const existing = await state.tables.agents.findOne({
				workspace_id: workspaceId,
				agent_id: agentId,
			});
			if (existing) {
				throw new ControlPlaneConflictError(
					`agent with id '${agentId}' already exists`,
				);
			}
			const record = buildAgentRecord(workspaceId, agentId, input);
			await state.tables.agents.insertOne(agentToRow(record));
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
			const existingRow = await state.tables.agents.findOne({
				workspace_id: workspaceId,
				agent_id: agentId,
			});
			if (!existingRow) {
				throw new ControlPlaneNotFoundError("agent", agentId);
			}
			const existing = agentFromRow(existingRow);
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
			const nextRow = agentToRow(next);
			await state.tables.agents.updateOne(
				{ workspace_id: workspaceId, agent_id: agentId },
				{
					$set: {
						name: nextRow.name,
						description: nextRow.description,
						system_prompt: nextRow.system_prompt,
						user_prompt: nextRow.user_prompt,
						llm_service_id: nextRow.llm_service_id,
						knowledge_base_ids: nextRow.knowledge_base_ids,
						rerank_enabled: nextRow.rerank_enabled,
						reranking_service_id: nextRow.reranking_service_id,
						rerank_max_results: nextRow.rerank_max_results,
						updated_at: nextRow.updated_at,
					},
				},
			);
			return next;
		},

		async deleteAgent(
			workspaceId: string,
			agentId: string,
		): Promise<{ deleted: boolean }> {
			await assertWorkspace(state, workspaceId);
			const existing = await state.tables.agents.findOne({
				workspace_id: workspaceId,
				agent_id: agentId,
			});
			if (!existing) return { deleted: false };
			// Cascade conversations + their messages. Messages are partitioned
			// by (workspace, conversation) — we read the agent's conversation
			// ids, then delete each partition in turn (no cross-partition
			// secondary index for messages keyed on agent_id).
			const convRows = await state.tables.conversations
				.find({ workspace_id: workspaceId, agent_id: agentId })
				.toArray();
			await state.tables.agents.deleteOne({
				workspace_id: workspaceId,
				agent_id: agentId,
			});
			await state.tables.conversations.deleteMany({
				workspace_id: workspaceId,
				agent_id: agentId,
			});
			for (const conv of convRows) {
				await state.tables.messages.deleteMany({
					workspace_id: workspaceId,
					conversation_id: conv.conversation_id,
				});
			}
			return { deleted: true };
		},
	};
}
