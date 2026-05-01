/**
 * Chunking-service aggregate. Workspace-scoped definitions of a
 * chunking engine; KBs reference one by id. Deleting a service that
 * any KB still binds is rejected with `chunking_service_in_use`.
 */

import type { ChunkingServiceRecord, ServiceStatus } from "../types.js";
import type { ServiceEndpointInput } from "./_service-endpoint.js";

export interface CreateChunkingServiceInput extends ServiceEndpointInput {
	readonly uid?: string;
	readonly name: string;
	readonly description?: string | null;
	readonly status?: ServiceStatus;
	readonly engine: string;
	readonly engineVersion?: string | null;
	readonly strategy?: string | null;
	readonly maxChunkSize?: number | null;
	readonly minChunkSize?: number | null;
	readonly chunkUnit?: string | null;
	readonly overlapSize?: number | null;
	readonly overlapUnit?: string | null;
	readonly preserveStructure?: boolean | null;
	readonly language?: string | null;
	readonly maxPayloadSizeKb?: number | null;
	readonly enableOcr?: boolean | null;
	readonly extractTables?: boolean | null;
	readonly extractFigures?: boolean | null;
	readonly readingOrder?: string | null;
}

export type UpdateChunkingServiceInput = Partial<
	Omit<CreateChunkingServiceInput, "uid">
>;

export interface ChunkingServiceRepo {
	listChunkingServices(
		workspace: string,
	): Promise<readonly ChunkingServiceRecord[]>;
	getChunkingService(
		workspace: string,
		uid: string,
	): Promise<ChunkingServiceRecord | null>;
	createChunkingService(
		workspace: string,
		input: CreateChunkingServiceInput,
	): Promise<ChunkingServiceRecord>;
	updateChunkingService(
		workspace: string,
		uid: string,
		patch: UpdateChunkingServiceInput,
	): Promise<ChunkingServiceRecord>;
	deleteChunkingService(
		workspace: string,
		uid: string,
	): Promise<{ deleted: boolean }>;
}
