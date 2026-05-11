/**
 * Embedding-service aggregate slice for the file-backed store.
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
import {
	assertServiceNotReferenced,
	assertWorkspace,
	type FileStoreState,
} from "./state.js";

export function makeEmbeddingServiceMethods(
	state: FileStoreState,
): EmbeddingServiceRepo {
	return {
		async listEmbeddingServices(
			workspace: string,
		): Promise<readonly EmbeddingServiceRecord[]> {
			await assertWorkspace(state, workspace);
			const all = await state.readAll("embedding-services");
			return all.filter((s) => s.workspaceId === workspace);
		},

		async getEmbeddingService(
			workspace: string,
			uid: string,
		): Promise<EmbeddingServiceRecord | null> {
			await assertWorkspace(state, workspace);
			const all = await state.readAll("embedding-services");
			return (
				all.find(
					(s) => s.workspaceId === workspace && s.embeddingServiceId === uid,
				) ?? null
			);
		},

		async createEmbeddingService(
			workspace: string,
			input: CreateEmbeddingServiceInput,
		): Promise<EmbeddingServiceRecord> {
			await assertWorkspace(state, workspace);
			return state.mutate("embedding-services", (rows) => {
				const uid = input.uid ?? randomUUID();
				if (
					rows.some(
						(s) => s.workspaceId === workspace && s.embeddingServiceId === uid,
					)
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
				return { rows: [...rows, record], result: record };
			});
		},

		async updateEmbeddingService(
			workspace: string,
			uid: string,
			patch: UpdateEmbeddingServiceInput,
		): Promise<EmbeddingServiceRecord> {
			await assertWorkspace(state, workspace);
			return state.mutate("embedding-services", (rows) => {
				const idx = rows.findIndex(
					(s) => s.workspaceId === workspace && s.embeddingServiceId === uid,
				);
				if (idx < 0) {
					throw new ControlPlaneNotFoundError("embedding service", uid);
				}
				const existing = rows[idx] as EmbeddingServiceRecord;
				const merged = applyPatch(existing, patch, {
					updatedAt: nowIso(),
				});
				const next: EmbeddingServiceRecord = {
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
			return state.mutate("embedding-services", (rows) => {
				const next = rows.filter(
					(s) => !(s.workspaceId === workspace && s.embeddingServiceId === uid),
				);
				return {
					rows: next,
					result: { deleted: next.length !== rows.length },
				};
			});
		},
	};
}
