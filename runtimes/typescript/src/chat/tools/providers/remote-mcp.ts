/**
 * External MCP tool provider (A2).
 *
 * STUB: returns no tools. A2 implements remote MCP: read the workspace's
 * registered MCP servers (`wb_config_mcp_tools_by_workspace`), connect
 * via the MCP client (`chat/tools/mcp-client.ts`), `tools/list`, and
 * adapt each remote tool into an `AgentTool` named
 * `mcp:{serverId}:{tool}`. Reuses the SSRF guard for the server URL and
 * the `SecretResolver` for any credential. Opt-in per agent.
 */

import type { AgentTool, ToolProviderContext } from "../registry.js";

export async function remoteMcpTools(
	_ctx: ToolProviderContext,
): Promise<readonly AgentTool[]> {
	return [];
}
