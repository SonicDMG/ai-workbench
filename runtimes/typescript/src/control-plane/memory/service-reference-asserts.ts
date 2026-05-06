/**
 * In-memory implementations of the cross-aggregate "service is still
 * referenced" guard rails used by service-delete methods. Pulled out
 * of the slice files so each slice doesn't need to import the shared
 * service-reference helpers and hold the cross-aggregate state types.
 */

import {
	type AgentServiceReferenceField,
	type KnowledgeBaseServiceReferenceField,
	serviceReferencedByAgent,
	serviceReferencedByKnowledgeBase,
} from "../shared/service-references.js";
import type { MemoryStoreState } from "./state.js";

/** Refuse to delete a service that any KB still references. */
export function assertServiceNotReferenced(
	state: MemoryStoreState,
	workspace: string,
	field: KnowledgeBaseServiceReferenceField,
	serviceId: string,
): void {
	const ref = Array.from(
		state.knowledgeBases.get(workspace)?.values() ?? [],
	).find((kb) => kb[field] === serviceId);
	if (ref) {
		throw serviceReferencedByKnowledgeBase(
			serviceId,
			ref.knowledgeBaseId,
			field,
		);
	}
}

/** Refuse to delete a service that any agent still references. */
export function assertAgentServiceNotReferenced(
	state: MemoryStoreState,
	workspace: string,
	field: AgentServiceReferenceField,
	serviceId: string,
): void {
	const ref = Array.from(state.agents.get(workspace)?.values() ?? []).find(
		(agent) => agent[field] === serviceId,
	);
	if (ref) {
		throw serviceReferencedByAgent(serviceId, ref.agentId, field);
	}
}
