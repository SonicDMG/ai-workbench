/**
 * Reranking-service aggregate slice for the file-backed store.
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
	assertWorkspace,
	type FileStoreState,
} from "./state.js";

export function makeRerankingServiceMethods(
	state: FileStoreState,
): RerankingServiceRepo {
	return {
		async listRerankingServices(
			workspace: string,
		): Promise<readonly RerankingServiceRecord[]> {
			await assertWorkspace(state, workspace);
			const all = await state.readAll("reranking-services");
			return all.filter((s) => s.workspaceId === workspace);
		},

		async getRerankingService(
			workspace: string,
			uid: string,
		): Promise<RerankingServiceRecord | null> {
			await assertWorkspace(state, workspace);
			const all = await state.readAll("reranking-services");
			return (
				all.find(
					(s) => s.workspaceId === workspace && s.rerankingServiceId === uid,
				) ?? null
			);
		},

		async createRerankingService(
			workspace: string,
			input: CreateRerankingServiceInput,
		): Promise<RerankingServiceRecord> {
			await assertWorkspace(state, workspace);
			return state.mutate("reranking-services", (rows) => {
				const uid = input.uid ?? randomUUID();
				if (
					rows.some(
						(s) => s.workspaceId === workspace && s.rerankingServiceId === uid,
					)
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
				return { rows: [...rows, record], result: record };
			});
		},

		async updateRerankingService(
			workspace: string,
			uid: string,
			patch: UpdateRerankingServiceInput,
		): Promise<RerankingServiceRecord> {
			await assertWorkspace(state, workspace);
			return state.mutate("reranking-services", (rows) => {
				const idx = rows.findIndex(
					(s) => s.workspaceId === workspace && s.rerankingServiceId === uid,
				);
				if (idx < 0) {
					throw new ControlPlaneNotFoundError("reranking service", uid);
				}
				const existing = rows[idx] as RerankingServiceRecord;
				const merged = applyPatch(existing, patch, {
					updatedAt: nowIso(),
				});
				const next: RerankingServiceRecord = {
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
			return state.mutate("reranking-services", (rows) => {
				const next = rows.filter(
					(s) => !(s.workspaceId === workspace && s.rerankingServiceId === uid),
				);
				return {
					rows: next,
					result: { deleted: next.length !== rows.length },
				};
			});
		},
	};
}
