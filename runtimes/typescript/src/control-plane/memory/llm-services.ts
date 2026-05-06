/**
 * LLM-service aggregate slice.
 */

import { randomUUID } from "node:crypto";
import {
	DEFAULT_AUTH_TYPE,
	DEFAULT_SERVICE_STATUS,
	nowIso,
} from "../defaults.js";
import {
	ControlPlaneConflictError,
	ControlPlaneNotFoundError,
} from "../errors.js";
import { applyPatch, freezeStringSet } from "../shared/records.js";
import type {
	CreateLlmServiceInput,
	LlmServiceRepo,
	UpdateLlmServiceInput,
} from "../store.js";
import type { LlmServiceRecord } from "../types.js";
import { assertAgentServiceNotReferenced } from "./service-reference-asserts.js";
import { assertWorkspace, type MemoryStoreState } from "./state.js";

export function makeLlmServiceMethods(state: MemoryStoreState): LlmServiceRepo {
	return {
		async listLlmServices(
			workspace: string,
		): Promise<readonly LlmServiceRecord[]> {
			await assertWorkspace(state, workspace);
			return Array.from(state.llmServices.get(workspace)?.values() ?? []);
		},

		async getLlmService(
			workspace: string,
			uid: string,
		): Promise<LlmServiceRecord | null> {
			await assertWorkspace(state, workspace);
			return state.llmServices.get(workspace)?.get(uid) ?? null;
		},

		async createLlmService(
			workspace: string,
			input: CreateLlmServiceInput,
		): Promise<LlmServiceRecord> {
			await assertWorkspace(state, workspace);
			const uid = input.uid ?? randomUUID();
			const bucket = state.llmServices.get(workspace) ?? new Map();
			if (bucket.has(uid)) {
				throw new ControlPlaneConflictError(
					`llm service with id '${uid}' already exists in workspace '${workspace}'`,
				);
			}
			const now = nowIso();
			const record: LlmServiceRecord = {
				workspaceId: workspace,
				llmServiceId: uid,
				name: input.name,
				description: input.description ?? null,
				status: input.status ?? DEFAULT_SERVICE_STATUS,
				provider: input.provider,
				engine: input.engine ?? null,
				modelName: input.modelName,
				modelVersion: input.modelVersion ?? null,
				contextWindowTokens: input.contextWindowTokens ?? null,
				maxOutputTokens: input.maxOutputTokens ?? null,
				temperatureMin: input.temperatureMin ?? null,
				temperatureMax: input.temperatureMax ?? null,
				supportsStreaming: input.supportsStreaming ?? null,
				supportsTools: input.supportsTools ?? null,
				endpointBaseUrl: input.endpointBaseUrl ?? null,
				endpointPath: input.endpointPath ?? null,
				requestTimeoutMs: input.requestTimeoutMs ?? null,
				maxBatchSize: input.maxBatchSize ?? null,
				authType: input.authType ?? DEFAULT_AUTH_TYPE,
				credentialRef: input.credentialRef ?? null,
				supportedLanguages: freezeStringSet(input.supportedLanguages),
				supportedContent: freezeStringSet(input.supportedContent),
				createdAt: now,
				updatedAt: now,
			};
			bucket.set(uid, record);
			state.llmServices.set(workspace, bucket);
			return record;
		},

		async updateLlmService(
			workspace: string,
			uid: string,
			patch: UpdateLlmServiceInput,
		): Promise<LlmServiceRecord> {
			await assertWorkspace(state, workspace);
			const existing = state.llmServices.get(workspace)?.get(uid);
			if (!existing) {
				throw new ControlPlaneNotFoundError("llm service", uid);
			}
			const {
				supportedLanguages: _langs,
				supportedContent: _content,
				...scalarPatch
			} = patch;
			const next: LlmServiceRecord = applyPatch(existing, scalarPatch, {
				...(patch.supportedLanguages !== undefined && {
					supportedLanguages: freezeStringSet(patch.supportedLanguages),
				}),
				...(patch.supportedContent !== undefined && {
					supportedContent: freezeStringSet(patch.supportedContent),
				}),
				updatedAt: nowIso(),
			});
			state.llmServices.get(workspace)?.set(uid, next);
			return next;
		},

		async deleteLlmService(
			workspace: string,
			uid: string,
		): Promise<{ deleted: boolean }> {
			await assertWorkspace(state, workspace);
			assertAgentServiceNotReferenced(state, workspace, "llmServiceId", uid);
			return {
				deleted: state.llmServices.get(workspace)?.delete(uid) ?? false,
			};
		},
	};
}
