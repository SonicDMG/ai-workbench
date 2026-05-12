/**
 * MCP raw — a one-line `curl` against the workspace's MCP endpoint.
 *
 * Lives in the catalog as a smoke test: if this 200s, every framework
 * tab on the Connect page will also work. It's the fastest way to
 * prove that an MCP-aware client (any framework, any language) can
 * reach the workspace.
 *
 * The body posts JSON-RPC `tools/list`, which the runtime answers
 * synchronously even though Streamable HTTP supports SSE — keeping it
 * synchronous lets the response render in a normal terminal.
 */

import type { ConnectSnippet, SnippetContext } from "../types.js";
import { mcpUrl } from "./urls.js";

export function buildMcpRawSnippet(ctx: SnippetContext): ConnectSnippet {
	const url = mcpUrl(ctx.publicBaseUrl, ctx.workspaceId);
	const code = `# Smoke-test the MCP endpoint without any SDK.
# Substitute the env var with your minted key, or 'export ${ctx.apiKeyEnvVar}=...' first.

curl -sN '${url}' \\
  -H "Authorization: Bearer $${ctx.apiKeyEnvVar}" \\
  -H 'Content-Type: application/json' \\
  -H 'Accept: application/json, text/event-stream' \\
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'

# Expect a JSON-RPC reply listing search_kb, list_knowledge_bases,
# list_documents, list_chats, list_chat_messages (and chat_send if
# the runtime has mcp.exposeChat: true).
`;
	return {
		id: "mcp-raw",
		displayName: "MCP (curl)",
		tagline:
			"Prove the wire is up before reaching for any SDK. JSON-RPC over Streamable HTTP.",
		language: "bash",
		transport: "mcp",
		install: null,
		code,
		requiresMcp: true,
		docsUrl:
			"https://modelcontextprotocol.io/specification/2025-06-18/basic/transports#streamable-http",
		notes:
			"Smoke test only — production agents should use one of the framework-specific tabs above so retries, schemas, and tool selection are handled for you.",
	};
}
