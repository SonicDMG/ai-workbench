/**
 * Reranking-service aggregate slice.
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
	CreateRerankingServiceInput,
	RerankingServiceRepo,
	UpdateRerankingServiceInput,
} from "../store.js";
import type { RerankingServiceRecord } from "../types.js";
import {
	assertAgentServiceNotReferenced,
	assertServiceNotReferenced,
} from "./service-reference-asserts.js";
import { assertWorkspace, type MemoryStoreState } from "./state.js";

export function makeRerankingServiceMethods(
	state: MemoryStoreState,
): RerankingServiceRepo {
	return {
		async listRerankingServices(
			workspace: string,
		): Promise<readonly RerankingServiceRecord[]> {
			await assertWorkspace(state, workspace);
			return Array.from(state.rerankingServices.get(workspace)?.values() ?? []);
		},

		async getRerankingService(
			workspace: string,
			uid: string,
		): Promise<RerankingServiceRecord | null> {
			await assertWorkspace(state, workspace);
			return state.rerankingServices.get(workspace)?.get(uid) ?? null;
		},

		async createRerankingService(
			workspace: string,
			input: CreateRerankingServiceInput,
		): Promise<RerankingServiceRecord> {
			await assertWorkspace(state, workspace);
			const uid = input.uid ?? randomUUID();
			const bucket = state.rerankingServices.get(workspace) ?? new Map();
			if (bucket.has(uid)) {
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
			bucket.set(uid, record);
			state.rerankingServices.set(workspace, bucket);
			return record;
		},

		async updateRerankingService(
			workspace: string,
			uid: string,
			patch: UpdateRerankingServiceInput,
		): Promise<RerankingServiceRecord> {
			await assertWorkspace(state, workspace);
			const existing = state.rerankingServices.get(workspace)?.get(uid);
			if (!existing) {
				throw new ControlPlaneNotFoundError("reranking service", uid);
			}
			const {
				supportedLanguages: _langs,
				supportedContent: _content,
				...scalarPatch
			} = patch;
			const next: RerankingServiceRecord = applyPatch(existing, scalarPatch, {
				...(patch.supportedLanguages !== undefined && {
					supportedLanguages: freezeStringSet(patch.supportedLanguages),
				}),
				...(patch.supportedContent !== undefined && {
					supportedContent: freezeStringSet(patch.supportedContent),
				}),
				updatedAt: nowIso(),
			});
			state.rerankingServices.get(workspace)?.set(uid, next);
			return next;
		},

		async deleteRerankingService(
			workspace: string,
			uid: string,
		): Promise<{ deleted: boolean }> {
			await assertWorkspace(state, workspace);
			assertServiceNotReferenced(state, workspace, "rerankingServiceId", uid);
			assertAgentServiceNotReferenced(
				state,
				workspace,
				"rerankingServiceId",
				uid,
			);
			return {
				deleted: state.rerankingServices.get(workspace)?.delete(uid) ?? false,
			};
		},
	};
}
