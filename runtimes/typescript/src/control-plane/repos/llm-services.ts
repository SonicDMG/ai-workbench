/**
 * LLM-service aggregate. Workspace-scoped definitions of how to call
 * a chat / generation model. Multiple agents in the same workspace
 * may reference one by id via `agent.llmServiceId`. Deleting a
 * service that an agent points at is rejected with
 * `llm_service_in_use`.
 */

import type { LlmServiceRecord, ServiceStatus } from "../types.js";
import type { ServiceEndpointInput } from "./_service-endpoint.js";

export interface CreateLlmServiceInput extends ServiceEndpointInput {
	readonly uid?: string;
	readonly name: string;
	readonly description?: string | null;
	readonly status?: ServiceStatus;
	readonly provider: string;
	readonly engine?: string | null;
	readonly modelName: string;
	readonly modelVersion?: string | null;
	readonly contextWindowTokens?: number | null;
	readonly maxOutputTokens?: number | null;
	readonly temperatureMin?: number | null;
	readonly temperatureMax?: number | null;
	readonly supportsStreaming?: boolean | null;
	readonly supportsTools?: boolean | null;
	readonly maxBatchSize?: number | null;
	readonly supportedLanguages?: ReadonlySet<string> | readonly string[];
	readonly supportedContent?: ReadonlySet<string> | readonly string[];
}

export type UpdateLlmServiceInput = Partial<Omit<CreateLlmServiceInput, "uid">>;

export interface LlmServiceRepo {
	listLlmServices(workspace: string): Promise<readonly LlmServiceRecord[]>;
	getLlmService(
		workspace: string,
		uid: string,
	): Promise<LlmServiceRecord | null>;
	createLlmService(
		workspace: string,
		input: CreateLlmServiceInput,
	): Promise<LlmServiceRecord>;
	updateLlmService(
		workspace: string,
		uid: string,
		patch: UpdateLlmServiceInput,
	): Promise<LlmServiceRecord>;
	deleteLlmService(
		workspace: string,
		uid: string,
	): Promise<{ deleted: boolean }>;
}
