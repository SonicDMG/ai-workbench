/**
 * Embedding-service aggregate slice for the Astra-backed store.
 */

import { randomUUID } from "node:crypto";
import {
	embeddingServiceFromRow,
	embeddingServiceToRow,
} from "../../astra-client/converters.js";
import {
	DEFAULT_AUTH_TYPE,
	DEFAULT_DISTANCE_METRIC,
	DEFAULT_SERVICE_STATUS,
	nowIso,
} from "../defaults.js";
import {
	ControlPlaneConflictError,
	ControlPlaneNotFoundError,
} from "../errors.js";
import { applyPatch, freezeStringSet } from "../shared/records.js";
import type {
	CreateEmbeddingServiceInput,
	EmbeddingServiceRepo,
	UpdateEmbeddingServiceInput,
} from "../store.js";
import type { EmbeddingServiceRecord } from "../types.js";
import { assertServiceNotReferenced } from "./service-reference-asserts.js";
import { type AstraStoreState, assertWorkspace } from "./state.js";

export function makeEmbeddingServiceMethods(
	state: AstraStoreState,
): EmbeddingServiceRepo {
	return {
		async listEmbeddingServices(
			workspace: string,
		): Promise<readonly EmbeddingServiceRecord[]> {
			await assertWorkspace(state, workspace);
			const rows = await state.tables.embeddingServices
				.find({ workspace_id: workspace })
				.toArray();
			return rows.map(embeddingServiceFromRow);
		},

		async getEmbeddingService(
			workspace: string,
			uid: string,
		): Promise<EmbeddingServiceRecord | null> {
			await assertWorkspace(state, workspace);
			const row = await state.tables.embeddingServices.findOne({
				workspace_id: workspace,
				embedding_service_id: uid,
			});
			return row ? embeddingServiceFromRow(row) : null;
		},

		async createEmbeddingService(
			workspace: string,
			input: CreateEmbeddingServiceInput,
		): Promise<EmbeddingServiceRecord> {
			await assertWorkspace(state, workspace);
			const uid = input.uid ?? randomUUID();
			if (
				await state.tables.embeddingServices.findOne({
					workspace_id: workspace,
					embedding_service_id: uid,
				})
			) {
				throw new ControlPlaneConflictError(
					`embedding service with id '${uid}' already exists in workspace '${workspace}'`,
				);
			}
			const now = nowIso();
			const record: EmbeddingServiceRecord = {
				workspaceId: workspace,
				embeddingServiceId: uid,
				name: input.name,
				description: input.description ?? null,
				status: input.status ?? DEFAULT_SERVICE_STATUS,
				provider: input.provider,
				modelName: input.modelName,
				embeddingDimension: input.embeddingDimension,
				distanceMetric: input.distanceMetric ?? DEFAULT_DISTANCE_METRIC,
				endpointBaseUrl: input.endpointBaseUrl ?? null,
				endpointPath: input.endpointPath ?? null,
				requestTimeoutMs: input.requestTimeoutMs ?? null,
				maxBatchSize: input.maxBatchSize ?? null,
				maxInputTokens: input.maxInputTokens ?? null,
				authType: input.authType ?? DEFAULT_AUTH_TYPE,
				credentialRef: input.credentialRef ?? null,
				supportedLanguages: freezeStringSet(input.supportedLanguages),
				supportedContent: freezeStringSet(input.supportedContent),
				createdAt: now,
				updatedAt: now,
			};
			await state.tables.embeddingServices.insertOne(
				embeddingServiceToRow(record),
			);
			return record;
		},

		async updateEmbeddingService(
			workspace: string,
			uid: string,
			patch: UpdateEmbeddingServiceInput,
		): Promise<EmbeddingServiceRecord> {
			await assertWorkspace(state, workspace);
			const existing = await state.tables.embeddingServices.findOne({
				workspace_id: workspace,
				embedding_service_id: uid,
			});
			if (!existing) {
				throw new ControlPlaneNotFoundError("embedding service", uid);
			}
			const base = embeddingServiceFromRow(existing);
			const {
				supportedLanguages: _langs,
				supportedContent: _content,
				...scalarPatch
			} = patch;
			const merged: EmbeddingServiceRecord = applyPatch(base, scalarPatch, {
				...(patch.supportedLanguages !== undefined && {
					supportedLanguages: freezeStringSet(patch.supportedLanguages),
				}),
				...(patch.supportedContent !== undefined && {
					supportedContent: freezeStringSet(patch.supportedContent),
				}),
				updatedAt: nowIso(),
			});
			const nextRow = embeddingServiceToRow(merged);
			const {
				workspace_id: _w,
				embedding_service_id: _id,
				...fields
			} = nextRow;
			await state.tables.embeddingServices.updateOne(
				{ workspace_id: workspace, embedding_service_id: uid },
				{ $set: fields },
			);
			return merged;
		},

		async deleteEmbeddingService(
			workspace: string,
			uid: string,
		): Promise<{ deleted: boolean }> {
			await assertWorkspace(state, workspace);
			await assertServiceNotReferenced(
				state,
				workspace,
				"embeddingServiceId",
				uid,
			);
			const existing = await state.tables.embeddingServices.findOne({
				workspace_id: workspace,
				embedding_service_id: uid,
			});
			if (!existing) return { deleted: false };
			await state.tables.embeddingServices.deleteOne({
				workspace_id: workspace,
				embedding_service_id: uid,
			});
			return { deleted: true };
		},
	};
}
