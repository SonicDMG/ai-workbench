/**
 * Chunking-service aggregate slice for the file-backed store.
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
import { applyPatch } from "../shared/records.js";
import type {
	ChunkingServiceRepo,
	CreateChunkingServiceInput,
	UpdateChunkingServiceInput,
} from "../store.js";
import type { ChunkingServiceRecord } from "../types.js";
import {
	assertServiceNotReferenced,
	assertWorkspace,
	type FileStoreState,
} from "./state.js";

export function makeChunkingServiceMethods(
	state: FileStoreState,
): ChunkingServiceRepo {
	return {
		async listChunkingServices(
			workspace: string,
		): Promise<readonly ChunkingServiceRecord[]> {
			await assertWorkspace(state, workspace);
			const all = await state.readAll("chunking-services");
			return all.filter((s) => s.workspaceId === workspace);
		},

		async getChunkingService(
			workspace: string,
			uid: string,
		): Promise<ChunkingServiceRecord | null> {
			await assertWorkspace(state, workspace);
			const all = await state.readAll("chunking-services");
			return (
				all.find(
					(s) => s.workspaceId === workspace && s.chunkingServiceId === uid,
				) ?? null
			);
		},

		async createChunkingService(
			workspace: string,
			input: CreateChunkingServiceInput,
		): Promise<ChunkingServiceRecord> {
			await assertWorkspace(state, workspace);
			return state.mutate("chunking-services", (rows) => {
				const uid = input.uid ?? randomUUID();
				if (
					rows.some(
						(s) => s.workspaceId === workspace && s.chunkingServiceId === uid,
					)
				) {
					throw new ControlPlaneConflictError(
						`chunking service with id '${uid}' already exists in workspace '${workspace}'`,
					);
				}
				const now = nowIso();
				const record: ChunkingServiceRecord = {
					workspaceId: workspace,
					chunkingServiceId: uid,
					name: input.name,
					description: input.description ?? null,
					status: input.status ?? DEFAULT_SERVICE_STATUS,
					engine: input.engine,
					engineVersion: input.engineVersion ?? null,
					strategy: input.strategy ?? null,
					maxChunkSize: input.maxChunkSize ?? null,
					minChunkSize: input.minChunkSize ?? null,
					chunkUnit: input.chunkUnit ?? null,
					overlapSize: input.overlapSize ?? null,
					overlapUnit: input.overlapUnit ?? null,
					preserveStructure: input.preserveStructure ?? null,
					language: input.language ?? null,
					endpointBaseUrl: input.endpointBaseUrl ?? null,
					endpointPath: input.endpointPath ?? null,
					requestTimeoutMs: input.requestTimeoutMs ?? null,
					authType: input.authType ?? DEFAULT_AUTH_TYPE,
					credentialRef: input.credentialRef ?? null,
					maxPayloadSizeKb: input.maxPayloadSizeKb ?? null,
					enableOcr: input.enableOcr ?? null,
					extractTables: input.extractTables ?? null,
					extractFigures: input.extractFigures ?? null,
					readingOrder: input.readingOrder ?? null,
					createdAt: now,
					updatedAt: now,
				};
				return { rows: [...rows, record], result: record };
			});
		},

		async updateChunkingService(
			workspace: string,
			uid: string,
			patch: UpdateChunkingServiceInput,
		): Promise<ChunkingServiceRecord> {
			await assertWorkspace(state, workspace);
			return state.mutate("chunking-services", (rows) => {
				const idx = rows.findIndex(
					(s) => s.workspaceId === workspace && s.chunkingServiceId === uid,
				);
				if (idx < 0) {
					throw new ControlPlaneNotFoundError("chunking service", uid);
				}
				const existing = rows[idx] as ChunkingServiceRecord;
				const next: ChunkingServiceRecord = applyPatch(existing, patch, {
					updatedAt: nowIso(),
				});
				const nextRows = [...rows];
				nextRows[idx] = next;
				return { rows: nextRows, result: next };
			});
		},

		async deleteChunkingService(
			workspace: string,
			uid: string,
		): Promise<{ deleted: boolean }> {
			await assertWorkspace(state, workspace);
			await assertServiceNotReferenced(
				state,
				workspace,
				"chunkingServiceId",
				uid,
			);
			return state.mutate("chunking-services", (rows) => {
				const next = rows.filter(
					(s) => !(s.workspaceId === workspace && s.chunkingServiceId === uid),
				);
				return {
					rows: next,
					result: { deleted: next.length !== rows.length },
				};
			});
		},
	};
}
