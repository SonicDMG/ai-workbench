/**
 * Embedding-service aggregate. Workspace-scoped definitions of an
 * embedding model; KBs reference one by id and inherit its
 * `embeddingDimension` + `distanceMetric` for collection
 * provisioning. Deleting a service still bound to a KB is rejected
 * with `embedding_service_in_use`.
 */

import type {
	DistanceMetric,
	EmbeddingServiceRecord,
	ServiceStatus,
} from "../types.js";
import type { ServiceEndpointInput } from "./_service-endpoint.js";

export interface CreateEmbeddingServiceInput extends ServiceEndpointInput {
	readonly uid?: string;
	readonly name: string;
	readonly description?: string | null;
	readonly status?: ServiceStatus;
	readonly provider: string;
	readonly modelName: string;
	readonly embeddingDimension: number;
	readonly distanceMetric?: DistanceMetric;
	readonly maxBatchSize?: number | null;
	readonly maxInputTokens?: number | null;
	readonly supportedLanguages?: ReadonlySet<string> | readonly string[];
	readonly supportedContent?: ReadonlySet<string> | readonly string[];
}

export type UpdateEmbeddingServiceInput = Partial<
	Omit<CreateEmbeddingServiceInput, "uid">
>;

export interface EmbeddingServiceRepo {
	listEmbeddingServices(
		workspace: string,
	): Promise<readonly EmbeddingServiceRecord[]>;
	getEmbeddingService(
		workspace: string,
		uid: string,
	): Promise<EmbeddingServiceRecord | null>;
	createEmbeddingService(
		workspace: string,
		input: CreateEmbeddingServiceInput,
	): Promise<EmbeddingServiceRecord>;
	updateEmbeddingService(
		workspace: string,
		uid: string,
		patch: UpdateEmbeddingServiceInput,
	): Promise<EmbeddingServiceRecord>;
	deleteEmbeddingService(
		workspace: string,
		uid: string,
	): Promise<{ deleted: boolean }>;
}
