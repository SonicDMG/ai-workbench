/**
 * LLM-service aggregate slice for the file-backed store.
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
import {
	assertAgentServiceNotReferenced,
	assertWorkspace,
	type FileStoreState,
} from "./state.js";

export function makeLlmServiceMethods(state: FileStoreState): LlmServiceRepo {
	return {
		async listLlmServices(
			workspace: string,
		): Promise<readonly LlmServiceRecord[]> {
			await assertWorkspace(state, workspace);
			const all = await state.readAll("llm-services");
			return all.filter((s) => s.workspaceId === workspace);
		},

		async getLlmService(
			workspace: string,
			uid: string,
		): Promise<LlmServiceRecord | null> {
			await assertWorkspace(state, workspace);
			const all = await state.readAll("llm-services");
			return (
				all.find(
					(s) => s.workspaceId === workspace && s.llmServiceId === uid,
				) ?? null
			);
		},

		async createLlmService(
			workspace: string,
			input: CreateLlmServiceInput,
		): Promise<LlmServiceRecord> {
			await assertWorkspace(state, workspace);
			return state.mutate("llm-services", (rows) => {
				const uid = input.uid ?? randomUUID();
				if (
					rows.some(
						(s) => s.workspaceId === workspace && s.llmServiceId === uid,
					)
				) {
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
				return { rows: [...rows, record], result: record };
			});
		},

		async updateLlmService(
			workspace: string,
			uid: string,
			patch: UpdateLlmServiceInput,
		): Promise<LlmServiceRecord> {
			await assertWorkspace(state, workspace);
			return state.mutate("llm-services", (rows) => {
				const idx = rows.findIndex(
					(s) => s.workspaceId === workspace && s.llmServiceId === uid,
				);
				if (idx < 0) {
					throw new ControlPlaneNotFoundError("llm service", uid);
				}
				const existing = rows[idx] as LlmServiceRecord;
				const merged = applyPatch(existing, patch, {
					updatedAt: nowIso(),
				});
				const next: LlmServiceRecord = {
					...merged,
					...(patch.supportedLanguages !== undefined && {
						supportedLanguages: freezeStringSet(patch.supportedLanguages),
					}),
					...(patch.supportedContent !== undefined && {
						supportedContent: freezeStringSet(patch.supportedContent),
					}),
				};
				const nextRows = [...rows];
				nextRows[idx] = next;
				return { rows: nextRows, result: next };
			});
		},

		async deleteLlmService(
			workspace: string,
			uid: string,
		): Promise<{ deleted: boolean }> {
			await assertWorkspace(state, workspace);
			await assertAgentServiceNotReferenced(
				state,
				workspace,
				"llmServiceId",
				uid,
			);
			return state.mutate("llm-services", (rows) => {
				const next = rows.filter(
					(s) => !(s.workspaceId === workspace && s.llmServiceId === uid),
				);
				return {
					rows: next,
					result: { deleted: next.length !== rows.length },
				};
			});
		},
	};
}
