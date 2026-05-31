import type { RerankingServiceRecord } from "../../control-plane/types.js";
import type { RerankingServiceRow } from "../row-types.js";
import {
	arrayToSet,
	asNumberOrNull,
	asUuidString,
	setToSortedArray,
} from "./coerce.js";

export function rerankingServiceToRow(
	r: RerankingServiceRecord,
): RerankingServiceRow {
	return {
		workspace_id: r.workspaceId,
		reranking_service_id: r.rerankingServiceId,
		name: r.name,
		description: r.description,
		status: r.status,
		provider: r.provider,
		engine: r.engine,
		model_name: r.modelName,
		model_version: r.modelVersion,
		max_candidates: r.maxCandidates,
		scoring_strategy: r.scoringStrategy,
		score_normalized: r.scoreNormalized,
		return_scores: r.returnScores,
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

export function rerankingServiceFromRow(
	row: RerankingServiceRow,
): RerankingServiceRecord {
	return {
		workspaceId: asUuidString(row.workspace_id),
		rerankingServiceId: asUuidString(row.reranking_service_id),
		name: row.name,
		description: row.description,
		status: row.status,
		provider: row.provider,
		engine: row.engine,
		modelName: row.model_name,
		modelVersion: row.model_version,
		maxCandidates: asNumberOrNull(row.max_candidates),
		scoringStrategy: row.scoring_strategy,
		scoreNormalized: row.score_normalized,
		returnScores: row.return_scores,
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
