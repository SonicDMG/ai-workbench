/**
 * Chunking-service aggregate slice for the Astra-backed store.
 */

import { randomUUID } from "node:crypto";
import {
	chunkingServiceFromRow,
	chunkingServiceToRow,
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
import { applyPatch } from "../shared/records.js";
import type {
	ChunkingServiceRepo,
	CreateChunkingServiceInput,
	UpdateChunkingServiceInput,
} from "../store.js";
import type { ChunkingServiceRecord } from "../types.js";
import { assertServiceNotReferenced } from "./service-reference-asserts.js";
import { type AstraStoreState, assertWorkspace } from "./state.js";

export function makeChunkingServiceMethods(
	state: AstraStoreState,
): ChunkingServiceRepo {
	return {
		async listChunkingServices(
			workspace: string,
		): Promise<readonly ChunkingServiceRecord[]> {
			await assertWorkspace(state, workspace);
			const rows = await state.tables.chunkingServices
				.find({ workspace_id: workspace })
				.toArray();
			return rows.map(chunkingServiceFromRow);
		},

		async getChunkingService(
			workspace: string,
			uid: string,
		): Promise<ChunkingServiceRecord | null> {
			await assertWorkspace(state, workspace);
			const row = await state.tables.chunkingServices.findOne({
				workspace_id: workspace,
				chunking_service_id: uid,
			});
			return row ? chunkingServiceFromRow(row) : null;
		},

		async createChunkingService(
			workspace: string,
			input: CreateChunkingServiceInput,
		): Promise<ChunkingServiceRecord> {
			await assertWorkspace(state, workspace);
			const uid = input.uid ?? randomUUID();
			if (
				await state.tables.chunkingServices.findOne({
					workspace_id: workspace,
					chunking_service_id: uid,
				})
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
			await state.tables.chunkingServices.insertOne(
				chunkingServiceToRow(record),
			);
			return record;
		},

		async updateChunkingService(
			workspace: string,
			uid: string,
			patch: UpdateChunkingServiceInput,
		): Promise<ChunkingServiceRecord> {
			await assertWorkspace(state, workspace);
			const existing = await state.tables.chunkingServices.findOne({
				workspace_id: workspace,
				chunking_service_id: uid,
			});
			if (!existing)
				throw new ControlPlaneNotFoundError("chunking service", uid);
			const base = chunkingServiceFromRow(existing);
			const next: ChunkingServiceRecord = applyPatch(base, patch, {
				updatedAt: nowIso(),
			});
			const nextRow = chunkingServiceToRow(next);
			const { workspace_id: _w, chunking_service_id: _id, ...fields } = nextRow;
			await state.tables.chunkingServices.updateOne(
				{ workspace_id: workspace, chunking_service_id: uid },
				{ $set: fields },
			);
			return next;
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
			const existing = await state.tables.chunkingServices.findOne({
				workspace_id: workspace,
				chunking_service_id: uid,
			});
			if (!existing) return { deleted: false };
			await state.tables.chunkingServices.deleteOne({
				workspace_id: workspace,
				chunking_service_id: uid,
			});
			return { deleted: true };
		},
	};
}
