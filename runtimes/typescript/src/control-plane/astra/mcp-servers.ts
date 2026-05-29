/**
 * MCP-server aggregate slice (external tool providers, 0.4.0 A2) —
 * Astra backend.
 *
 * Backed by `wb_config_mcp_servers_by_workspace`. Mirrors the principals
 * slice: `insertOne` is upsert-by-default in the Data API, so we check
 * existence first to surface a 409 conflict on a re-create with the same
 * id rather than silently overwriting. `mcpServerId` is a server-minted
 * UUID (mirrors agents / services), so the create path mints one when the
 * caller doesn't supply it.
 */

import { randomUUID } from "node:crypto";
import {
	mcpServerFromRow,
	mcpServerToRow,
} from "../../astra-client/converters.js";
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
import { type AstraStoreState, assertWorkspace } from "./state.js";

export function makeMcpServerMethods(state: AstraStoreState): McpServerRepo {
	return {
		async listMcpServers(
			workspace: string,
		): Promise<readonly McpServerRecord[]> {
			await assertWorkspace(state, workspace);
			const rows = await state.tables.mcpServers
				.find({ workspace_id: workspace })
				.toArray();
			return rows
				.map(mcpServerFromRow)
				.sort((a, b) => a.mcpServerId.localeCompare(b.mcpServerId));
		},

		async getMcpServer(
			workspace: string,
			mcpServerId: string,
		): Promise<McpServerRecord | null> {
			await assertWorkspace(state, workspace);
			const row = await state.tables.mcpServers.findOne({
				workspace_id: workspace,
				mcp_server_id: mcpServerId,
			});
			return row ? mcpServerFromRow(row) : null;
		},

		async createMcpServer(
			workspace: string,
			input: CreateMcpServerInput,
		): Promise<McpServerRecord> {
			await assertWorkspace(state, workspace);
			const mcpServerId = input.mcpServerId ?? randomUUID();
			const existing = await state.tables.mcpServers.findOne({
				workspace_id: workspace,
				mcp_server_id: mcpServerId,
			});
			if (existing) {
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
			await state.tables.mcpServers.insertOne(mcpServerToRow(record));
			return record;
		},

		async updateMcpServer(
			workspace: string,
			mcpServerId: string,
			patch: UpdateMcpServerInput,
		): Promise<McpServerRecord> {
			await assertWorkspace(state, workspace);
			const existing = await state.tables.mcpServers.findOne({
				workspace_id: workspace,
				mcp_server_id: mcpServerId,
			});
			if (!existing) {
				throw new ControlPlaneNotFoundError("mcp server", mcpServerId);
			}
			const base = mcpServerFromRow(existing);
			const next: McpServerRecord = {
				...base,
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
			const nextRow = mcpServerToRow(next);
			const { workspace_id: _w, mcp_server_id: _m, ...fields } = nextRow;
			await state.tables.mcpServers.updateOne(
				{ workspace_id: workspace, mcp_server_id: mcpServerId },
				{ $set: fields },
			);
			return next;
		},

		async deleteMcpServer(
			workspace: string,
			mcpServerId: string,
		): Promise<{ deleted: boolean }> {
			await assertWorkspace(state, workspace);
			const existing = await state.tables.mcpServers.findOne({
				workspace_id: workspace,
				mcp_server_id: mcpServerId,
			});
			if (!existing) return { deleted: false };
			await state.tables.mcpServers.deleteOne({
				workspace_id: workspace,
				mcp_server_id: mcpServerId,
			});
			return { deleted: true };
		},
	};
}
