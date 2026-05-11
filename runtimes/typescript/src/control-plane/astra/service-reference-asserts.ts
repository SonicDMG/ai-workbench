/**
 * Astra implementations of the cross-aggregate "service is still
 * referenced" guard rails used by service-delete methods. Mirrors the
 * memory-backend helpers of the same name; pulled out of each slice so
 * the per-aggregate files don't need to reach across partitions
 * themselves.
 */

import {
	type AgentServiceReferenceField,
	type KnowledgeBaseServiceReferenceField,
	serviceReferencedByAgent,
	serviceReferencedByKnowledgeBase,
} from "../shared/service-references.js";
import type { AstraStoreState } from "./state.js";

/** Refuse to delete a service that any KB still references. */
export async function assertServiceNotReferenced(
	state: AstraStoreState,
	workspace: string,
	field: KnowledgeBaseServiceReferenceField,
	serviceId: string,
): Promise<void> {
	const rows = await state.tables.knowledgeBases
		.find({ workspace_id: workspace })
		.toArray();
	const fieldOnRow: keyof (typeof rows)[number] =
		field === "embeddingServiceId"
			? "embedding_service_id"
			: field === "chunkingServiceId"
				? "chunking_service_id"
				: "reranking_service_id";
	const ref = rows.find((kb) => kb[fieldOnRow] === serviceId);
	if (ref) {
		throw serviceReferencedByKnowledgeBase(
			serviceId,
			ref.knowledge_base_id,
			field,
		);
	}
}

/**
 * Refuse to delete a service that any agent in the workspace still
 * references on the given field. There's no secondary index keyed by
 * service id, so we read the workspace's agents and filter client-side.
 * v0 workspaces are bounded; if agent counts grow we'll add a
 * `_by_service` index.
 */
export async function assertAgentServiceNotReferenced(
	state: AstraStoreState,
	workspace: string,
	field: AgentServiceReferenceField,
	serviceId: string,
): Promise<void> {
	const rows = await state.tables.agents
		.find({ workspace_id: workspace })
		.toArray();
	const fieldOnRow: keyof (typeof rows)[number] =
		field === "llmServiceId" ? "llm_service_id" : "reranking_service_id";
	const ref = rows.find((agent) => agent[fieldOnRow] === serviceId);
	if (ref) {
		throw serviceReferencedByAgent(serviceId, ref.agent_id, field);
	}
}
