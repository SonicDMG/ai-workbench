import type { ChunkingServiceRecord } from "../../control-plane/types.js";
import type { ChunkingServiceRow } from "../row-types.js";
import { asNumberOrNull, asUuidString } from "./coerce.js";

export function chunkingServiceToRow(
	r: ChunkingServiceRecord,
): ChunkingServiceRow {
	return {
		workspace_id: r.workspaceId,
		chunking_service_id: r.chunkingServiceId,
		name: r.name,
		description: r.description,
		status: r.status,
		engine: r.engine,
		engine_version: r.engineVersion,
		strategy: r.strategy,
		max_chunk_size: r.maxChunkSize,
		min_chunk_size: r.minChunkSize,
		chunk_unit: r.chunkUnit,
		overlap_size: r.overlapSize,
		overlap_unit: r.overlapUnit,
		preserve_structure: r.preserveStructure,
		language: r.language,
		endpoint_base_url: r.endpointBaseUrl,
		endpoint_path: r.endpointPath,
		request_timeout_ms: r.requestTimeoutMs,
		max_payload_size_kb: r.maxPayloadSizeKb,
		auth_type: r.authType,
		credential_ref: r.credentialRef,
		enable_ocr: r.enableOcr,
		extract_tables: r.extractTables,
		extract_figures: r.extractFigures,
		reading_order: r.readingOrder,
		created_at: r.createdAt,
		updated_at: r.updatedAt,
	};
}

export function chunkingServiceFromRow(
	row: ChunkingServiceRow,
): ChunkingServiceRecord {
	return {
		workspaceId: asUuidString(row.workspace_id),
		chunkingServiceId: asUuidString(row.chunking_service_id),
		name: row.name,
		description: row.description,
		status: row.status,
		engine: row.engine,
		engineVersion: row.engine_version,
		strategy: row.strategy,
		maxChunkSize: asNumberOrNull(row.max_chunk_size),
		minChunkSize: asNumberOrNull(row.min_chunk_size),
		chunkUnit: row.chunk_unit,
		overlapSize: asNumberOrNull(row.overlap_size),
		overlapUnit: row.overlap_unit,
		preserveStructure: row.preserve_structure,
		language: row.language,
		endpointBaseUrl: row.endpoint_base_url,
		endpointPath: row.endpoint_path,
		requestTimeoutMs: asNumberOrNull(row.request_timeout_ms),
		maxPayloadSizeKb: asNumberOrNull(row.max_payload_size_kb),
		authType: row.auth_type,
		credentialRef: row.credential_ref,
		enableOcr: row.enable_ocr,
		extractTables: row.extract_tables,
		extractFigures: row.extract_figures,
		readingOrder: row.reading_order,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
	};
}
