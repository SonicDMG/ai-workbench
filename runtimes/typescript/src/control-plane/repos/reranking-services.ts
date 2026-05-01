/**
 * Reranking-service aggregate. Workspace-scoped; KBs and agents may
 * each reference one. Deleting a service bound to a KB or an agent
 * is rejected with `reranking_service_in_use`.
 */

import type { RerankingServiceRecord, ServiceStatus } from "../types.js";
import type { ServiceEndpointInput } from "./_service-endpoint.js";

export interface CreateRerankingServiceInput extends ServiceEndpointInput {
	readonly uid?: string;
	readonly name: string;
	readonly description?: string | null;
	readonly status?: ServiceStatus;
	readonly provider: string;
	readonly engine?: string | null;
	readonly modelName: string;
	readonly modelVersion?: string | null;
	readonly maxCandidates?: number | null;
	readonly scoringStrategy?: string | null;
	readonly scoreNormalized?: boolean | null;
	readonly returnScores?: boolean | null;
	readonly maxBatchSize?: number | null;
	readonly supportedLanguages?: ReadonlySet<string> | readonly string[];
	readonly supportedContent?: ReadonlySet<string> | readonly string[];
}

export type UpdateRerankingServiceInput = Partial<
	Omit<CreateRerankingServiceInput, "uid">
>;

export interface RerankingServiceRepo {
	listRerankingServices(
		workspace: string,
	): Promise<readonly RerankingServiceRecord[]>;
	getRerankingService(
		workspace: string,
		uid: string,
	): Promise<RerankingServiceRecord | null>;
	createRerankingService(
		workspace: string,
		input: CreateRerankingServiceInput,
	): Promise<RerankingServiceRecord>;
	updateRerankingService(
		workspace: string,
		uid: string,
		patch: UpdateRerankingServiceInput,
	): Promise<RerankingServiceRecord>;
	deleteRerankingService(
		workspace: string,
		uid: string,
	): Promise<{ deleted: boolean }>;
}
