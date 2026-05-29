/**
 * MCP-server aggregate (external tool providers, 0.4.0 A2).
 *
 * Each row is a remote MCP server registered for a workspace. The agent
 * tool resolver (`chat/tools/providers/remote-mcp.ts`) lists the enabled
 * servers, connects to each over Streamable HTTP, and adapts every
 * discovered tool into an agent tool named `mcp:{mcpServerId}:{toolName}`.
 *
 * `mcpServerId` is a server-minted UUID (mirrors agents / services) — not
 * an operator-chosen handle like a principal id — because the namespaced
 * tool id embeds it and it never needs to be human-typed.
 */

import type { McpServerRecord, SecretRef } from "../types.js";

export interface CreateMcpServerInput {
	/** Optional explicit id (else minted). Used by import / restore paths. */
	readonly mcpServerId?: string;
	readonly label: string;
	readonly url: string;
	readonly credentialRef?: SecretRef | null;
	/** Defaults to `true` when omitted. */
	readonly enabled?: boolean;
	/** Allow-list of remote tool names; `null`/absent = expose all. */
	readonly allowedTools?: readonly string[] | null;
}

export interface UpdateMcpServerInput {
	readonly label?: string;
	readonly url?: string;
	readonly credentialRef?: SecretRef | null;
	readonly enabled?: boolean;
	readonly allowedTools?: readonly string[] | null;
}

export interface McpServerRepo {
	listMcpServers(workspace: string): Promise<readonly McpServerRecord[]>;
	getMcpServer(
		workspace: string,
		mcpServerId: string,
	): Promise<McpServerRecord | null>;
	createMcpServer(
		workspace: string,
		input: CreateMcpServerInput,
	): Promise<McpServerRecord>;
	updateMcpServer(
		workspace: string,
		mcpServerId: string,
		patch: UpdateMcpServerInput,
	): Promise<McpServerRecord>;
	deleteMcpServer(
		workspace: string,
		mcpServerId: string,
	): Promise<{ deleted: boolean }>;
}
