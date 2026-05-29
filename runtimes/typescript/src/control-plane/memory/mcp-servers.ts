/**
 * MCP-server aggregate slice (external tool providers, 0.4.0 A2) —
 * memory backend.
 *
 * Owns the `Map<workspaceId, Map<mcpServerId, McpServerRecord>>`
 * partition. Memory-only; mirrors the structure of every other
 * workspace-partitioned aggregate (closest analog: principals).
 */

import { randomUUID } from "node:crypto";
import { nowIso } from "../defaults.js";
import {
	ControlPlaneConflictError,
	ControlPlaneNotFoundError,
} from "../errors.js";
import { normalizeAllowedTools } from "../shared/records.js";
import type {
	CreateMcpServerInput,
	McpServerRepo,
	UpdateMcpServerInput,
} from "../store.js";
import type { McpServerRecord } from "../types.js";
import { assertWorkspace, type MemoryStoreState } from "./state.js";

export function makeMcpServerMethods(state: MemoryStoreState): McpServerRepo {
	return {
		async listMcpServers(
			workspace: string,
		): Promise<readonly McpServerRecord[]> {
			await assertWorkspace(state, workspace);
			const bucket = state.mcpServers.get(workspace);
			if (!bucket) return [];
			return Array.from(bucket.values()).sort((a, b) =>
				a.mcpServerId.localeCompare(b.mcpServerId),
			);
		},

		async getMcpServer(
			workspace: string,
			mcpServerId: string,
		): Promise<McpServerRecord | null> {
			await assertWorkspace(state, workspace);
			return state.mcpServers.get(workspace)?.get(mcpServerId) ?? null;
		},

		async createMcpServer(
			workspace: string,
			input: CreateMcpServerInput,
		): Promise<McpServerRecord> {
			await assertWorkspace(state, workspace);
			const bucket = state.mcpServers.get(workspace) ?? new Map();
			const mcpServerId = input.mcpServerId ?? randomUUID();
			if (bucket.has(mcpServerId)) {
				throw new ControlPlaneConflictError(
					`mcp server '${mcpServerId}' already exists in workspace '${workspace}'`,
				);
			}
			const now = nowIso();
			const record: McpServerRecord = {
				workspaceId: workspace,
				mcpServerId,
				label: input.label,
				url: input.url,
				credentialRef: input.credentialRef ?? null,
				enabled: input.enabled ?? true,
				allowedTools: normalizeAllowedTools(input.allowedTools),
				createdAt: now,
				updatedAt: now,
			};
			bucket.set(mcpServerId, record);
			state.mcpServers.set(workspace, bucket);
			return record;
		},

		async updateMcpServer(
			workspace: string,
			mcpServerId: string,
			patch: UpdateMcpServerInput,
		): Promise<McpServerRecord> {
			await assertWorkspace(state, workspace);
			const existing = state.mcpServers.get(workspace)?.get(mcpServerId);
			if (!existing) {
				throw new ControlPlaneNotFoundError("mcp server", mcpServerId);
			}
			const next: McpServerRecord = {
				...existing,
				...(patch.label !== undefined && { label: patch.label }),
				...(patch.url !== undefined && { url: patch.url }),
				...(patch.credentialRef !== undefined && {
					credentialRef: patch.credentialRef,
				}),
				...(patch.enabled !== undefined && { enabled: patch.enabled }),
				...(patch.allowedTools !== undefined && {
					allowedTools: normalizeAllowedTools(patch.allowedTools),
				}),
				updatedAt: nowIso(),
			};
			state.mcpServers.get(workspace)?.set(mcpServerId, next);
			return next;
		},

		async deleteMcpServer(
			workspace: string,
			mcpServerId: string,
		): Promise<{ deleted: boolean }> {
			await assertWorkspace(state, workspace);
			return {
				deleted: state.mcpServers.get(workspace)?.delete(mcpServerId) ?? false,
			};
		},
	};
}
