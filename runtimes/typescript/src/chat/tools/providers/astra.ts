/**
 * Astra Data API tool provider (A4).
 *
 * STUB: returns no tools. A4 implements `astra:data_api` — a scoped,
 * read-mostly Data API query over the workspace's bound knowledge bases,
 * reusing the Playground / `search-dispatch` path and emitting an
 * `AstraQuerySnapshot` via the effects sink. Only meaningful for
 * `astra` / `hcd` workspaces; a no-op elsewhere. Opt-in per agent.
 */

import type { AgentTool, ToolProviderContext } from "../registry.js";

export async function astraTools(
	_ctx: ToolProviderContext,
): Promise<readonly AgentTool[]> {
	return [];
}
