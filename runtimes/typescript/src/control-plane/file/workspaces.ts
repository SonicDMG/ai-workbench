/**
 * Workspace aggregate slice for the file-backed store.
 *
 * Owns the `workspaces.json` table plus the cascade across every
 * dependent partition. Each cascade independently acquires the
 * relevant per-file mutex; the order matches the pre-split monolith
 * so the eventual consistency semantics (and the single-node
 * deadlock-free behavior) are preserved.
 */

import { randomUUID } from "node:crypto";
import { byCreatedAtThenId, nowIso } from "../defaults.js";
import {
	ControlPlaneConflictError,
	ControlPlaneNotFoundError,
} from "../errors.js";
import { assertNoWorkspaceConflict } from "../shared/workspaces.js";
import type {
	CreateWorkspaceInput,
	UpdateWorkspaceInput,
	WorkspaceRepo,
} from "../store.js";
import type { WorkspaceRecord } from "../types.js";
import type { FileStoreState } from "./state.js";

export function makeWorkspaceMethods(state: FileStoreState): WorkspaceRepo {
	return {
		async listWorkspaces(): Promise<readonly WorkspaceRecord[]> {
			const all = await state.readAll("workspaces");
			return [...all].sort(byCreatedAtThenId);
		},

		async getWorkspace(uid: string): Promise<WorkspaceRecord | null> {
			const all = await state.readAll("workspaces");
			return all.find((w) => w.uid === uid) ?? null;
		},

		async createWorkspace(
			input: CreateWorkspaceInput,
		): Promise<WorkspaceRecord> {
			return state.mutate("workspaces", (rows) => {
				const uid = input.uid ?? randomUUID();
				if (rows.some((w) => w.uid === uid)) {
					throw new ControlPlaneConflictError(
						`workspace with id '${uid}' already exists`,
					);
				}
				assertNoWorkspaceConflict(rows, {
					name: input.name,
					url: input.url ?? null,
					keyspace: input.keyspace ?? null,
				});
				const now = nowIso();
				const record: WorkspaceRecord = {
					uid,
					name: input.name,
					url: input.url ?? null,
					kind: input.kind,
					credentials: { ...(input.credentials ?? {}) },
					keyspace: input.keyspace ?? null,
					createdAt: now,
					updatedAt: now,
				};
				return { rows: [...rows, record], result: record };
			});
		},

		async updateWorkspace(
			uid: string,
			patch: UpdateWorkspaceInput,
		): Promise<WorkspaceRecord> {
			return state.mutate("workspaces", (rows) => {
				const idx = rows.findIndex((w) => w.uid === uid);
				if (idx < 0) {
					throw new ControlPlaneNotFoundError("workspace", uid);
				}
				const existing = rows[idx] as WorkspaceRecord;
				const next: WorkspaceRecord = {
					...existing,
					...(patch.name !== undefined && { name: patch.name }),
					...(patch.url !== undefined && { url: patch.url }),
					...(patch.credentials !== undefined && {
						credentials: { ...patch.credentials },
					}),
					...(patch.keyspace !== undefined && { keyspace: patch.keyspace }),
					updatedAt: nowIso(),
				};
				assertNoWorkspaceConflict(
					rows,
					{ name: next.name, url: next.url, keyspace: next.keyspace },
					uid,
				);
				const nextRows = [...rows];
				nextRows[idx] = next;
				return { rows: nextRows, result: next };
			});
		},

		async deleteWorkspace(uid: string): Promise<{ deleted: boolean }> {
			// Cascade across tables. Each cascade is independently locked; we
			// accept eventual consistency across tables, which is fine for
			// single-node and matches how astra would behave (no
			// cross-partition transaction).
			const workspaceDeleted = await state.mutate("workspaces", (rows) => {
				const next = rows.filter((w) => w.uid !== uid);
				return {
					rows: next,
					result: { deleted: next.length !== rows.length },
				};
			});

			await state.mutate("api-keys", (rows) => ({
				rows: rows.filter((k) => k.workspace !== uid),
				result: null,
			}));
			// Knowledge-base schema cascades.
			await state.mutate("knowledge-bases", (rows) => ({
				rows: rows.filter((kb) => kb.workspaceId !== uid),
				result: null,
			}));
			await state.mutate("knowledge-filters", (rows) => ({
				rows: rows.filter((f) => f.workspaceId !== uid),
				result: null,
			}));
			await state.mutate("chunking-services", (rows) => ({
				rows: rows.filter((s) => s.workspaceId !== uid),
				result: null,
			}));
			await state.mutate("embedding-services", (rows) => ({
				rows: rows.filter((s) => s.workspaceId !== uid),
				result: null,
			}));
			await state.mutate("reranking-services", (rows) => ({
				rows: rows.filter((s) => s.workspaceId !== uid),
				result: null,
			}));
			await state.mutate("llm-services", (rows) => ({
				rows: rows.filter((s) => s.workspaceId !== uid),
				result: null,
			}));
			await state.mutate("rag-documents", (rows) => ({
				rows: rows.filter((d) => d.workspaceId !== uid),
				result: null,
			}));

			// Chat cascade: agents → conversations → messages.
			await state.mutate("agents", (rows) => ({
				rows: rows.filter((a) => a.workspaceId !== uid),
				result: null,
			}));
			await state.mutate("conversations", (rows) => ({
				rows: rows.filter((c) => c.workspaceId !== uid),
				result: null,
			}));
			await state.mutate("messages", (rows) => ({
				rows: rows.filter((m) => m.workspaceId !== uid),
				result: null,
			}));

			return workspaceDeleted;
		},
	};
}
