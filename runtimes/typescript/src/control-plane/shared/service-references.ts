import { ControlPlaneConflictError, IN_USE_CODES } from "../errors.js";

export type KnowledgeBaseServiceReferenceField =
	| "embeddingServiceId"
	| "chunkingServiceId"
	| "rerankingServiceId";

export type AgentServiceReferenceField = "llmServiceId" | "rerankingServiceId";

export function serviceReferencedByKnowledgeBase(
	serviceId: string,
	knowledgeBaseId: string,
	field: KnowledgeBaseServiceReferenceField,
): ControlPlaneConflictError {
	return serviceReferenceConflict(
		"knowledge base",
		serviceId,
		knowledgeBaseId,
		field,
	);
}

export function serviceReferencedByAgent(
	serviceId: string,
	agentId: string,
	field: AgentServiceReferenceField,
): ControlPlaneConflictError {
	return serviceReferenceConflict("agent", serviceId, agentId, field);
}

function serviceReferenceConflict(
	resource: "knowledge base" | "agent",
	serviceId: string,
	referenceId: string,
	field: KnowledgeBaseServiceReferenceField | AgentServiceReferenceField,
): ControlPlaneConflictError {
	return new ControlPlaneConflictError(
		`service '${serviceId}' is referenced by ${resource} '${referenceId}' (${field})`,
		IN_USE_CODES[field],
	);
}
