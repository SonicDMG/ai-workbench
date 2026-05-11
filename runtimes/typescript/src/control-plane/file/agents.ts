/**
 * Agent aggregate slice for the file-backed store. Cascades into
 * conversations + messages on agent delete.
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
	type FileStoreState,
} from "./state.js";

export function makeAgentMethods(state: FileStoreState): AgentRepo {
	return {
		async listAgents(workspaceId: string): Promise<readonly AgentRecord[]> {
			await assertWorkspace(state, workspaceId);
			const all = await state.readAll("agents");
			return all
				.filter((a) => a.workspaceId === workspaceId)
				.sort(byAgentCreatedAtAsc);
		},

		async getAgent(
			workspaceId: string,
			agentId: string,
		): Promise<AgentRecord | null> {
			await assertWorkspace(state, workspaceId);
			const all = await state.readAll("agents");
			return (
				all.find(
					(a) => a.workspaceId === workspaceId && a.agentId === agentId,
				) ?? null
			);
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
			return state.mutate("agents", (rows) => {
				const agentId = input.agentId ?? randomUUID();
				if (
					rows.some(
						(a) => a.workspaceId === workspaceId && a.agentId === agentId,
					)
				) {
					throw new ControlPlaneConflictError(
						`agent with id '${agentId}' already exists`,
					);
				}
				const record = buildAgentRecord(workspaceId, agentId, input);
				return { rows: [...rows, record], result: record };
			});
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
			return state.mutate("agents", (rows) => {
				const idx = rows.findIndex(
					(a) => a.workspaceId === workspaceId && a.agentId === agentId,
				);
				if (idx < 0) {
					throw new ControlPlaneNotFoundError("agent", agentId);
				}
				const existing = rows[idx] as AgentRecord;
				const next: AgentRecord = {
					...existing,
					...(patch.name !== undefined && { name: patch.name }),
					...(patch.description !== undefined && {
						description: patch.description,
					}),
					...(patch.systemPrompt !== undefined && {
						systemPrompt: patch.systemPrompt,
					}),
					...(patch.userPrompt !== undefined && {
						userPrompt: patch.userPrompt,
					}),
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
				const nextRows = [...rows];
				nextRows[idx] = next;
				return { rows: nextRows, result: next };
			});
		},

		async deleteAgent(
			workspaceId: string,
			agentId: string,
		): Promise<{ deleted: boolean }> {
			await assertWorkspace(state, workspaceId);
			const res = await state.mutate("agents", (rows) => {
				const next = rows.filter(
					(a) => !(a.workspaceId === workspaceId && a.agentId === agentId),
				);
				return {
					rows: next,
					result: { deleted: next.length !== rows.length },
				};
			});
			if (res.deleted) {
				// Cascade: drop the agent's conversations and any messages
				// belonging to those conversations.
				const droppedConversationIds = new Set<string>();
				await state.mutate("conversations", (rows) => ({
					rows: rows.filter((c) => {
						const drop = c.workspaceId === workspaceId && c.agentId === agentId;
						if (drop) droppedConversationIds.add(c.conversationId);
						return !drop;
					}),
					result: null,
				}));
				if (droppedConversationIds.size > 0) {
					await state.mutate("messages", (rows) => ({
						rows: rows.filter(
							(m) =>
								!(
									m.workspaceId === workspaceId &&
									droppedConversationIds.has(m.conversationId)
								),
						),
						result: null,
					}));
				}
			}
			return res;
		},
	};
}
