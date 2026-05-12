/**
 * IBM watsonx Agent Builder — manual / config-driven recipe.
 *
 * Builder is a UI-first product: registering an MCP server is a few
 * clicks rather than code. The "snippet" we return is the literal
 * dialog the user pastes the URL into, plus the OpenAPI doc URL for
 * the lower-level "register a custom tool" path.
 *
 * We keep this in the same response shape as the code snippets so the
 * UI can render it on a tab alongside the others — the only thing
 * that changes is `transport: "manual"` and `language: "text"`.
 */

import type { ConnectSnippet, SnippetContext } from "../types.js";
import { mcpUrl, restBaseUrl } from "./urls.js";

export function buildWatsonxSnippet(ctx: SnippetContext): ConnectSnippet {
	const url = mcpUrl(ctx.publicBaseUrl, ctx.workspaceId);
	const openapi = `${ctx.publicBaseUrl}/api/v1/openapi.json`;
	const code = `## Option A — Register AI Workbench as an MCP tool (recommended)

  1. In watsonx Agent Builder, open the agent you want to ground in
     AI Workbench and click **Tools → Add tool → MCP server**.
  2. Fill in:
       Server URL   ${url}
       Transport    Streamable HTTP
       Auth header  Authorization: Bearer <your WORKBENCH_API_KEY>
  3. Save. The workspace's read tools (search_kb, list_documents,
     list_knowledge_bases) appear in the agent's tool list. Toggle the
     ones the agent should call.

## Option B — Import the REST API as a custom tool (no MCP needed)

  1. Tools → Add tool → Custom tool → From OpenAPI URL.
  2. Source URL    ${openapi}
  3. Server URL    ${restBaseUrl(ctx.publicBaseUrl)}
  4. Auth          API key, header name 'Authorization', value
                   'Bearer <your WORKBENCH_API_KEY>'.
  5. Builder generates one tool per operation. Hide the write
     operations you don't want the agent to invoke and keep the
     search / list ones.
`;
	return {
		id: "watsonx",
		displayName: "IBM watsonx Agent Builder",
		tagline:
			"Register AI Workbench in Agent Builder — point-and-click MCP, or import the REST API as a custom tool.",
		language: "text",
		transport: "manual",
		install: null,
		code,
		requiresMcp: false,
		docsUrl: "https://www.ibm.com/docs/en/watsonx/saas?topic=tools-adding",
		notes:
			"Option A needs `mcp.enabled: true` on the runtime; Option B works against any runtime since it consumes `/api/v1/openapi.json` directly.",
	};
}
