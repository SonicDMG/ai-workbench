/**
 * MCP-server aggregate slice (external tool providers, 0.4.0 A2) —
 * file backend.
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
import { assertWorkspace, type FileStoreState } from "./state.js";

export function makeMcpServerMethods(state: FileStoreState): McpServerRepo {
	return {
		async listMcpServers(
			workspace: string,
		): Promise<readonly McpServerRecord[]> {
			await assertWorkspace(state, workspace);
			const rows = await state.readAll("mcp-servers");
			return rows
				.filter((r) => r.workspaceId === workspace)
				.sort((a, b) => a.mcpServerId.localeCompare(b.mcpServerId));
		},

		async getMcpServer(
			workspace: string,
			mcpServerId: string,
		): Promise<McpServerRecord | null> {
			await assertWorkspace(state, workspace);
			const rows = await state.readAll("mcp-servers");
			return (
				rows.find(
					(r) => r.workspaceId === workspace && r.mcpServerId === mcpServerId,
				) ?? null
			);
		},

		async createMcpServer(
			workspace: string,
			input: CreateMcpServerInput,
		): Promise<McpServerRecord> {
			await assertWorkspace(state, workspace);
			return state.mutate("mcp-servers", (rows) => {
				const mcpServerId = input.mcpServerId ?? randomUUID();
				if (
					rows.some(
						(r) => r.workspaceId === workspace && r.mcpServerId === mcpServerId,
					)
				) {
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
				return { rows: [...rows, record], result: record };
			});
		},

		async updateMcpServer(
			workspace: string,
			mcpServerId: string,
			patch: UpdateMcpServerInput,
		): Promise<McpServerRecord> {
			await assertWorkspace(state, workspace);
			return state.mutate("mcp-servers", (rows) => {
				const idx = rows.findIndex(
					(r) => r.workspaceId === workspace && r.mcpServerId === mcpServerId,
				);
				if (idx < 0) {
					throw new ControlPlaneNotFoundError("mcp server", mcpServerId);
				}
				const existing = rows[idx] as McpServerRecord;
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
				const nextRows = [...rows];
				nextRows[idx] = next;
				return { rows: nextRows, result: next };
			});
		},

		async deleteMcpServer(
			workspace: string,
			mcpServerId: string,
		): Promise<{ deleted: boolean }> {
			await assertWorkspace(state, workspace);
			return state.mutate("mcp-servers", (rows) => {
				const next = rows.filter(
					(r) =>
						!(r.workspaceId === workspace && r.mcpServerId === mcpServerId),
				);
				return {
					rows: next,
					result: { deleted: next.length !== rows.length },
				};
			});
		},
	};
}
