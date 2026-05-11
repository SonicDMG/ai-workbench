/**
 * LLM-service aggregate slice for the Astra-backed store.
 */

import { randomUUID } from "node:crypto";
import {
	llmServiceFromRow,
	llmServiceToRow,
} from "../../astra-client/converters.js";
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
import { type AstraStoreState, assertWorkspace } from "./state.js";

export function makeLlmServiceMethods(state: AstraStoreState): LlmServiceRepo {
	return {
		async listLlmServices(
			workspace: string,
		): Promise<readonly LlmServiceRecord[]> {
			await assertWorkspace(state, workspace);
			const rows = await state.tables.llmServices
				.find({ workspace_id: workspace })
				.toArray();
			return rows.map(llmServiceFromRow);
		},

		async getLlmService(
			workspace: string,
			uid: string,
		): Promise<LlmServiceRecord | null> {
			await assertWorkspace(state, workspace);
			const row = await state.tables.llmServices.findOne({
				workspace_id: workspace,
				llm_service_id: uid,
			});
			return row ? llmServiceFromRow(row) : null;
		},

		async createLlmService(
			workspace: string,
			input: CreateLlmServiceInput,
		): Promise<LlmServiceRecord> {
			await assertWorkspace(state, workspace);
			const uid = input.uid ?? randomUUID();
			if (
				await state.tables.llmServices.findOne({
					workspace_id: workspace,
					llm_service_id: uid,
				})
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
			await state.tables.llmServices.insertOne(llmServiceToRow(record));
			return record;
		},

		async updateLlmService(
			workspace: string,
			uid: string,
			patch: UpdateLlmServiceInput,
		): Promise<LlmServiceRecord> {
			await assertWorkspace(state, workspace);
			const existing = await state.tables.llmServices.findOne({
				workspace_id: workspace,
				llm_service_id: uid,
			});
			if (!existing) throw new ControlPlaneNotFoundError("llm service", uid);
			const base = llmServiceFromRow(existing);
			const {
				supportedLanguages: _langs,
				supportedContent: _content,
				...scalarPatch
			} = patch;
			const merged: LlmServiceRecord = applyPatch(base, scalarPatch, {
				...(patch.supportedLanguages !== undefined && {
					supportedLanguages: freezeStringSet(patch.supportedLanguages),
				}),
				...(patch.supportedContent !== undefined && {
					supportedContent: freezeStringSet(patch.supportedContent),
				}),
				updatedAt: nowIso(),
			});
			const nextRow = llmServiceToRow(merged);
			const { workspace_id: _w, llm_service_id: _id, ...fields } = nextRow;
			await state.tables.llmServices.updateOne(
				{ workspace_id: workspace, llm_service_id: uid },
				{ $set: fields },
			);
			return merged;
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
			const existing = await state.tables.llmServices.findOne({
				workspace_id: workspace,
				llm_service_id: uid,
			});
			if (!existing) return { deleted: false };
			await state.tables.llmServices.deleteOne({
				workspace_id: workspace,
				llm_service_id: uid,
			});
			return { deleted: true };
		},
	};
}
