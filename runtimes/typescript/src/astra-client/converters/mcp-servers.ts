import type { McpServerRecord } from "../../control-plane/types.js";
import type { McpServerRow } from "../row-types.js";
import { asIsoString, asUuidString } from "./coerce.js";

/**
 * Parse the `allowed_tools` text column. `null`/missing → `null` (expose
 * every advertised tool); a serialized JSON array → a sorted, deduped
 * `string[]`. Throws on malformed JSON / non-array so a corrupt row
 * surfaces loudly rather than silently exposing every tool.
 */
function parseAllowedTools(raw: string | null): readonly string[] | null {
	if (raw == null) return null;
	const parsed = JSON.parse(raw) as unknown;
	if (!Array.isArray(parsed)) {
		throw new Error("expected allowed_tools to be a JSON array");
	}
	return [...new Set(parsed.map((v) => String(v)))].sort();
}

export function mcpServerToRow(r: McpServerRecord): McpServerRow {
	return {
		workspace_id: r.workspaceId,
		mcp_server_id: r.mcpServerId,
		label: r.label,
		url: r.url,
		credential_ref: r.credentialRef,
		enabled: r.enabled,
		allowed_tools:
			r.allowedTools === null ? null : JSON.stringify(r.allowedTools),
		created_at: r.createdAt,
		updated_at: r.updatedAt,
	};
}

export function mcpServerFromRow(row: McpServerRow): McpServerRecord {
	return {
		workspaceId: asUuidString(row.workspace_id),
		mcpServerId: asUuidString(row.mcp_server_id),
		label: row.label,
		url: row.url,
		credentialRef: row.credential_ref,
		// Legacy rows written before the column existed read as enabled.
		enabled: row.enabled ?? true,
		allowedTools: parseAllowedTools(row.allowed_tools),
		createdAt: asIsoString(row.created_at),
		updatedAt: asIsoString(row.updated_at),
	};
}
