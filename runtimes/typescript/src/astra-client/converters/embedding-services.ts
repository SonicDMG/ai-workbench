import type { EmbeddingServiceRecord } from "../../control-plane/types.js";
import type { EmbeddingServiceRow } from "../row-types.js";
import {
	arrayToSet,
	asNumber,
	asNumberOrNull,
	asUuidString,
	setToSortedArray,
} from "./coerce.js";

export function embeddingServiceToRow(
	r: EmbeddingServiceRecord,
): EmbeddingServiceRow {
	return {
		workspace_id: r.workspaceId,
		embedding_service_id: r.embeddingServiceId,
		name: r.name,
		description: r.description,
		status: r.status,
		provider: r.provider,
		model_name: r.modelName,
		embedding_dimension: r.embeddingDimension,
		distance_metric: r.distanceMetric,
		endpoint_base_url: r.endpointBaseUrl,
		endpoint_path: r.endpointPath,
		request_timeout_ms: r.requestTimeoutMs,
		max_batch_size: r.maxBatchSize,
		max_input_tokens: r.maxInputTokens,
		auth_type: r.authType,
		credential_ref: r.credentialRef,
		supported_languages: arrayToSet(r.supportedLanguages),
		supported_content: arrayToSet(r.supportedContent),
		created_at: r.createdAt,
		updated_at: r.updatedAt,
	};
}

export function embeddingServiceFromRow(
	row: EmbeddingServiceRow,
): EmbeddingServiceRecord {
	return {
		workspaceId: asUuidString(row.workspace_id),
		embeddingServiceId: asUuidString(row.embedding_service_id),
		name: row.name,
		description: row.description,
		status: row.status,
		provider: row.provider,
		modelName: row.model_name,
		embeddingDimension: asNumber(row.embedding_dimension),
		distanceMetric: row.distance_metric,
		endpointBaseUrl: row.endpoint_base_url,
		endpointPath: row.endpoint_path,
		requestTimeoutMs: asNumberOrNull(row.request_timeout_ms),
		maxBatchSize: asNumberOrNull(row.max_batch_size),
		maxInputTokens: asNumberOrNull(row.max_input_tokens),
		authType: row.auth_type,
		credentialRef: row.credential_ref,
		supportedLanguages: setToSortedArray(row.supported_languages),
		supportedContent: setToSortedArray(row.supported_content),
		createdAt: row.created_at,
		updatedAt: row.updated_at,
	};
}
