import type { LlmServiceRecord } from "../../control-plane/types.js";
import type { LlmServiceRow } from "../row-types.js";
import {
	arrayToSet,
	asNumberOrNull,
	asUuidString,
	setToSortedArray,
} from "./coerce.js";

export function llmServiceToRow(r: LlmServiceRecord): LlmServiceRow {
	return {
		workspace_id: r.workspaceId,
		llm_service_id: r.llmServiceId,
		name: r.name,
		description: r.description,
		status: r.status,
		provider: r.provider,
		engine: r.engine,
		model_name: r.modelName,
		model_version: r.modelVersion,
		context_window_tokens: r.contextWindowTokens,
		max_output_tokens: r.maxOutputTokens,
		temperature_min: r.temperatureMin,
		temperature_max: r.temperatureMax,
		supports_streaming: r.supportsStreaming,
		supports_tools: r.supportsTools,
		endpoint_base_url: r.endpointBaseUrl,
		endpoint_path: r.endpointPath,
		request_timeout_ms: r.requestTimeoutMs,
		max_batch_size: r.maxBatchSize,
		auth_type: r.authType,
		credential_ref: r.credentialRef,
		supported_languages: arrayToSet(r.supportedLanguages),
		supported_content: arrayToSet(r.supportedContent),
		created_at: r.createdAt,
		updated_at: r.updatedAt,
	};
}

export function llmServiceFromRow(row: LlmServiceRow): LlmServiceRecord {
	return {
		workspaceId: asUuidString(row.workspace_id),
		llmServiceId: asUuidString(row.llm_service_id),
		name: row.name,
		description: row.description,
		status: row.status,
		provider: row.provider,
		engine: row.engine,
		modelName: row.model_name,
		modelVersion: row.model_version,
		contextWindowTokens: asNumberOrNull(row.context_window_tokens),
		maxOutputTokens: asNumberOrNull(row.max_output_tokens),
		temperatureMin: asNumberOrNull(row.temperature_min),
		temperatureMax: asNumberOrNull(row.temperature_max),
		supportsStreaming: row.supports_streaming,
		supportsTools: row.supports_tools,
		endpointBaseUrl: row.endpoint_base_url,
		endpointPath: row.endpoint_path,
		requestTimeoutMs: asNumberOrNull(row.request_timeout_ms),
		maxBatchSize: asNumberOrNull(row.max_batch_size),
		authType: row.auth_type,
		credentialRef: row.credential_ref,
		supportedLanguages: setToSortedArray(row.supported_languages),
		supportedContent: setToSortedArray(row.supported_content),
		createdAt: row.created_at,
		updatedAt: row.updated_at,
	};
}
