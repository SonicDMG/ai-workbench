/**
 * Embedding-service aggregate slice.
 */

import { randomUUID } from "node:crypto";
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
import { assertWorkspace, type MemoryStoreState } from "./state.js";

export function makeEmbeddingServiceMethods(
	state: MemoryStoreState,
): EmbeddingServiceRepo {
	return {
		async listEmbeddingServices(
			workspace: string,
		): Promise<readonly EmbeddingServiceRecord[]> {
			await assertWorkspace(state, workspace);
			return Array.from(state.embeddingServices.get(workspace)?.values() ?? []);
		},

		async getEmbeddingService(
			workspace: string,
			uid: string,
		): Promise<EmbeddingServiceRecord | null> {
			await assertWorkspace(state, workspace);
			return state.embeddingServices.get(workspace)?.get(uid) ?? null;
		},

		async createEmbeddingService(
			workspace: string,
			input: CreateEmbeddingServiceInput,
		): Promise<EmbeddingServiceRecord> {
			await assertWorkspace(state, workspace);
			const uid = input.uid ?? randomUUID();
			const bucket = state.embeddingServices.get(workspace) ?? new Map();
			if (bucket.has(uid)) {
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
			bucket.set(uid, record);
			state.embeddingServices.set(workspace, bucket);
			return record;
		},

		async updateEmbeddingService(
			workspace: string,
			uid: string,
			patch: UpdateEmbeddingServiceInput,
		): Promise<EmbeddingServiceRecord> {
			await assertWorkspace(state, workspace);
			const existing = state.embeddingServices.get(workspace)?.get(uid);
			if (!existing) {
				throw new ControlPlaneNotFoundError("embedding service", uid);
			}
			const {
				supportedLanguages: _langs,
				supportedContent: _content,
				...scalarPatch
			} = patch;
			const next: EmbeddingServiceRecord = applyPatch(existing, scalarPatch, {
				...(patch.supportedLanguages !== undefined && {
					supportedLanguages: freezeStringSet(patch.supportedLanguages),
				}),
				...(patch.supportedContent !== undefined && {
					supportedContent: freezeStringSet(patch.supportedContent),
				}),
				updatedAt: nowIso(),
			});
			state.embeddingServices.get(workspace)?.set(uid, next);
			return next;
		},

		async deleteEmbeddingService(
			workspace: string,
			uid: string,
		): Promise<{ deleted: boolean }> {
			await assertWorkspace(state, workspace);
			assertServiceNotReferenced(state, workspace, "embeddingServiceId", uid);
			return {
				deleted: state.embeddingServices.get(workspace)?.delete(uid) ?? false,
			};
		},
	};
}
