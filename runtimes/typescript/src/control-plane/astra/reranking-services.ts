/**
 * Reranking-service aggregate slice for the Astra-backed store.
 */

import { randomUUID } from "node:crypto";
import {
	rerankingServiceFromRow,
	rerankingServiceToRow,
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
	CreateRerankingServiceInput,
	RerankingServiceRepo,
	UpdateRerankingServiceInput,
} from "../store.js";
import type { RerankingServiceRecord } from "../types.js";
import {
	assertAgentServiceNotReferenced,
	assertServiceNotReferenced,
} from "./service-reference-asserts.js";
import { type AstraStoreState, assertWorkspace } from "./state.js";

export function makeRerankingServiceMethods(
	state: AstraStoreState,
): RerankingServiceRepo {
	return {
		async listRerankingServices(
			workspace: string,
		): Promise<readonly RerankingServiceRecord[]> {
			await assertWorkspace(state, workspace);
			const rows = await state.tables.rerankingServices
				.find({ workspace_id: workspace })
				.toArray();
			return rows.map(rerankingServiceFromRow);
		},

		async getRerankingService(
			workspace: string,
			uid: string,
		): Promise<RerankingServiceRecord | null> {
			await assertWorkspace(state, workspace);
			const row = await state.tables.rerankingServices.findOne({
				workspace_id: workspace,
				reranking_service_id: uid,
			});
			return row ? rerankingServiceFromRow(row) : null;
		},

		async createRerankingService(
			workspace: string,
			input: CreateRerankingServiceInput,
		): Promise<RerankingServiceRecord> {
			await assertWorkspace(state, workspace);
			const uid = input.uid ?? randomUUID();
			if (
				await state.tables.rerankingServices.findOne({
					workspace_id: workspace,
					reranking_service_id: uid,
				})
			) {
				throw new ControlPlaneConflictError(
					`reranking service with id '${uid}' already exists in workspace '${workspace}'`,
				);
			}
			const now = nowIso();
			const record: RerankingServiceRecord = {
				workspaceId: workspace,
				rerankingServiceId: uid,
				name: input.name,
				description: input.description ?? null,
				status: input.status ?? DEFAULT_SERVICE_STATUS,
				provider: input.provider,
				engine: input.engine ?? null,
				modelName: input.modelName,
				modelVersion: input.modelVersion ?? null,
				maxCandidates: input.maxCandidates ?? null,
				scoringStrategy: input.scoringStrategy ?? null,
				scoreNormalized: input.scoreNormalized ?? null,
				returnScores: input.returnScores ?? null,
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
			await state.tables.rerankingServices.insertOne(
				rerankingServiceToRow(record),
			);
			return record;
		},

		async updateRerankingService(
			workspace: string,
			uid: string,
			patch: UpdateRerankingServiceInput,
		): Promise<RerankingServiceRecord> {
			await assertWorkspace(state, workspace);
			const existing = await state.tables.rerankingServices.findOne({
				workspace_id: workspace,
				reranking_service_id: uid,
			});
			if (!existing) {
				throw new ControlPlaneNotFoundError("reranking service", uid);
			}
			const base = rerankingServiceFromRow(existing);
			const {
				supportedLanguages: _langs,
				supportedContent: _content,
				...scalarPatch
			} = patch;
			const merged: RerankingServiceRecord = applyPatch(base, scalarPatch, {
				...(patch.supportedLanguages !== undefined && {
					supportedLanguages: freezeStringSet(patch.supportedLanguages),
				}),
				...(patch.supportedContent !== undefined && {
					supportedContent: freezeStringSet(patch.supportedContent),
				}),
				updatedAt: nowIso(),
			});
			const nextRow = rerankingServiceToRow(merged);
			const {
				workspace_id: _w,
				reranking_service_id: _id,
				...fields
			} = nextRow;
			await state.tables.rerankingServices.updateOne(
				{ workspace_id: workspace, reranking_service_id: uid },
				{ $set: fields },
			);
			return merged;
		},

		async deleteRerankingService(
			workspace: string,
			uid: string,
		): Promise<{ deleted: boolean }> {
			await assertWorkspace(state, workspace);
			await assertServiceNotReferenced(
				state,
				workspace,
				"rerankingServiceId",
				uid,
			);
			await assertAgentServiceNotReferenced(
				state,
				workspace,
				"rerankingServiceId",
				uid,
			);
			const existing = await state.tables.rerankingServices.findOne({
				workspace_id: workspace,
				reranking_service_id: uid,
			});
			if (!existing) return { deleted: false };
			await state.tables.rerankingServices.deleteOne({
				workspace_id: workspace,
				reranking_service_id: uid,
			});
			return { deleted: true };
		},
	};
}
