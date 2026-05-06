/**
 * Chunking-service aggregate slice.
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
import { assertServiceNotReferenced } from "./service-reference-asserts.js";
import { assertWorkspace, type MemoryStoreState } from "./state.js";

export function makeChunkingServiceMethods(
	state: MemoryStoreState,
): ChunkingServiceRepo {
	return {
		async listChunkingServices(
			workspace: string,
		): Promise<readonly ChunkingServiceRecord[]> {
			await assertWorkspace(state, workspace);
			return Array.from(state.chunkingServices.get(workspace)?.values() ?? []);
		},

		async getChunkingService(
			workspace: string,
			uid: string,
		): Promise<ChunkingServiceRecord | null> {
			await assertWorkspace(state, workspace);
			return state.chunkingServices.get(workspace)?.get(uid) ?? null;
		},

		async createChunkingService(
			workspace: string,
			input: CreateChunkingServiceInput,
		): Promise<ChunkingServiceRecord> {
			await assertWorkspace(state, workspace);
			const uid = input.uid ?? randomUUID();
			const bucket = state.chunkingServices.get(workspace) ?? new Map();
			if (bucket.has(uid)) {
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
			bucket.set(uid, record);
			state.chunkingServices.set(workspace, bucket);
			return record;
		},

		async updateChunkingService(
			workspace: string,
			uid: string,
			patch: UpdateChunkingServiceInput,
		): Promise<ChunkingServiceRecord> {
			await assertWorkspace(state, workspace);
			const existing = state.chunkingServices.get(workspace)?.get(uid);
			if (!existing) {
				throw new ControlPlaneNotFoundError("chunking service", uid);
			}
			const next: ChunkingServiceRecord = applyPatch(existing, patch, {
				updatedAt: nowIso(),
			});
			state.chunkingServices.get(workspace)?.set(uid, next);
			return next;
		},

		async deleteChunkingService(
			workspace: string,
			uid: string,
		): Promise<{ deleted: boolean }> {
			await assertWorkspace(state, workspace);
			assertServiceNotReferenced(state, workspace, "chunkingServiceId", uid);
			return {
				deleted: state.chunkingServices.get(workspace)?.delete(uid) ?? false,
			};
		},
	};
}
