/**
 * Workspace aggregate. The root of every other resource — every repo
 * below scopes its rows under `workspaceId`. Cascade rules for
 * `deleteWorkspace` live in `../cascade.ts`.
 */

import type { SecretRef, WorkspaceKind, WorkspaceRecord } from "../types.js";

export interface CreateWorkspaceInput {
	/** Optional — generated if omitted. */
	readonly uid?: string;
	readonly name: string;
	readonly url?: string | null;
	readonly kind: WorkspaceKind;
	readonly credentials?: Readonly<Record<string, SecretRef>>;
	readonly keyspace?: string | null;
}

/**
 * Patch a workspace. `kind` is intentionally absent — a workspace's
 * backend is immutable after creation (changing it would orphan any
 * vector-store collections that already exist on the old backend).
 * Delete and recreate if the kind needs to change.
 */
export interface UpdateWorkspaceInput {
	readonly name?: string;
	readonly url?: string | null;
	readonly credentials?: Readonly<Record<string, SecretRef>>;
	readonly keyspace?: string | null;
}

export interface WorkspaceRepo {
	listWorkspaces(): Promise<readonly WorkspaceRecord[]>;
	getWorkspace(uid: string): Promise<WorkspaceRecord | null>;
	createWorkspace(input: CreateWorkspaceInput): Promise<WorkspaceRecord>;
	updateWorkspace(
		uid: string,
		patch: UpdateWorkspaceInput,
	): Promise<WorkspaceRecord>;
	/**
	 * Cascade-delete the workspace and every dependent resource (api
	 * keys, KBs, RAG documents, services, agents, conversations,
	 * messages). Returns `{ deleted: false }` if the workspace was
	 * already gone — idempotent re-deletes don't error.
	 */
	deleteWorkspace(uid: string): Promise<{ deleted: boolean }>;
}
