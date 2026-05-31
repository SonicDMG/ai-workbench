import type { AgentRecord } from "../../control-plane/types.js";
import type { AgentRow } from "../row-types.js";
import {
	arrayToSet,
	asNullableUuidString,
	asNumberOrNull,
	asUuidString,
	setToSortedArray,
} from "./coerce.js";

export function agentToRow(r: AgentRecord): AgentRow {
	return {
		workspace_id: r.workspaceId,
		agent_id: r.agentId,
		name: r.name,
		description: r.description,
		system_prompt: r.systemPrompt,
		user_prompt: r.userPrompt,
		tool_ids: arrayToSet(r.toolIds),
		llm_service_id: r.llmServiceId,
		knowledge_base_ids: arrayToSet(r.knowledgeBaseIds),
		rerank_enabled: r.rerankEnabled,
		reranking_service_id: r.rerankingServiceId,
		rerank_max_results: r.rerankMaxResults,
		created_at: r.createdAt,
		updated_at: r.updatedAt,
	};
}

export function agentFromRow(row: AgentRow): AgentRecord {
	return {
		workspaceId: asUuidString(row.workspace_id),
		agentId: asUuidString(row.agent_id),
		name: row.name,
		description: row.description,
		systemPrompt: row.system_prompt,
		userPrompt: row.user_prompt,
		toolIds: setToSortedArray(row.tool_ids),
		llmServiceId: asNullableUuidString(row.llm_service_id),
		knowledgeBaseIds: setToSortedArray(row.knowledge_base_ids),
		rerankEnabled: row.rerank_enabled,
		rerankingServiceId: asNullableUuidString(row.reranking_service_id),
		rerankMaxResults: asNumberOrNull(row.rerank_max_results),
		createdAt: row.created_at,
		updatedAt: row.updated_at,
	};
}
