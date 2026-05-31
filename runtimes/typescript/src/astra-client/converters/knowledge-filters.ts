import type { KnowledgeFilterRecord } from "../../control-plane/types.js";
import type { KnowledgeFilterRow } from "../row-types.js";
import {
	asUuidString,
	parseJsonObject,
	stringifyJsonObject,
} from "./coerce.js";

export function knowledgeFilterToRow(
	r: KnowledgeFilterRecord,
): KnowledgeFilterRow {
	return {
		workspace_id: r.workspaceId,
		knowledge_base_id: r.knowledgeBaseId,
		knowledge_filter_id: r.knowledgeFilterId,
		name: r.name,
		description: r.description,
		filter_json: stringifyJsonObject(r.filter),
		created_at: r.createdAt,
		updated_at: r.updatedAt,
	};
}

export function knowledgeFilterFromRow(
	row: KnowledgeFilterRow,
): KnowledgeFilterRecord {
	return {
		workspaceId: asUuidString(row.workspace_id),
		knowledgeBaseId: asUuidString(row.knowledge_base_id),
		knowledgeFilterId: asUuidString(row.knowledge_filter_id),
		name: row.name,
		description: row.description,
		filter: parseJsonObject(row.filter_json) ?? {},
		createdAt: row.created_at,
		updatedAt: row.updated_at,
	};
}
