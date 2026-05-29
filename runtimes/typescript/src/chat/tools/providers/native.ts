/**
 * Native tool provider (A3) — HTTP fetch + web search.
 *
 * STUB: returns no tools. A3 implements `native:fetch` (GET/POST via
 * `safeFetch` with a hard timeout, response-size cap, and content-type
 * allow-list) and `native:web_search` (a pluggable search provider
 * behind a config key, off when unconfigured). Both are opt-in per
 * agent via the `toolIds` allow-list. No code execution this release.
 */

import type { AgentTool, ToolProviderContext } from "../registry.js";

export async function nativeTools(
	_ctx: ToolProviderContext,
): Promise<readonly AgentTool[]> {
	return [];
}
