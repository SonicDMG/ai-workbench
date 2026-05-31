import type { KnowledgeBaseRecord } from "../../control-plane/types.js";
import type { KnowledgeBaseRow } from "../row-types.js";
import {
	asNullableUuidString,
	asPlainStringMap,
	asUuidString,
} from "./coerce.js";

export function knowledgeBaseToRow(r: KnowledgeBaseRecord): KnowledgeBaseRow {
	return {
		workspace_id: r.workspaceId,
		knowledge_base_id: r.knowledgeBaseId,
		name: r.name,
		description: r.description,
		status: r.status,
		embedding_service_id: r.embeddingServiceId,
		chunking_service_id: r.chunkingServiceId,
		reranking_service_id: r.rerankingServiceId,
		language: r.language,
		vector_collection: r.vectorCollection,
		owned: r.owned,
		lexical_enabled: r.lexical.enabled,
		lexical_analyzer: r.lexical.analyzer,
		lexical_options: { ...r.lexical.options },
		policy_dsl: r.policyDsl,
		policy_enabled: r.policyEnabled,
		created_at: r.createdAt,
		updated_at: r.updatedAt,
	};
}

export function knowledgeBaseFromRow(
	row: KnowledgeBaseRow,
): KnowledgeBaseRecord {
	return {
		workspaceId: asUuidString(row.workspace_id),
		knowledgeBaseId: asUuidString(row.knowledge_base_id),
		name: row.name,
		description: row.description,
		status: row.status,
		embeddingServiceId: asUuidString(row.embedding_service_id),
		chunkingServiceId: asUuidString(row.chunking_service_id),
		rerankingServiceId: asNullableUuidString(row.reranking_service_id),
		language: row.language,
		vectorCollection: row.vector_collection,
		// Pre-`owned`-column rows are coerced to `true` so their
		// collection lifecycle stays under runtime control, matching
		// the original behavior at the time those rows were written.
		owned: row.owned ?? true,
		lexical: {
			enabled: row.lexical_enabled ?? false,
			analyzer: row.lexical_analyzer ?? null,
			options: asPlainStringMap(row.lexical_options),
		},
		policyDsl: row.policy_dsl ?? null,
		policyEnabled: row.policy_enabled ?? false,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
	};
}
