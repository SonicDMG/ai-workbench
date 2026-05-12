/**
 * Google Agent Development Kit (Python) — MCP transport via `MCPToolset`.
 *
 * ADK is Google's first-party agent framework (paired with Gemini /
 * Vertex AI). The `MCPToolset` is a first-class citizen — pass it as
 * a tool on an `LlmAgent` and the workspace's read surface becomes
 * callable.
 */

import type { ConnectSnippet, SnippetContext } from "../types.js";
import { mcpUrl } from "./urls.js";

export function buildGoogleAdkSnippet(ctx: SnippetContext): ConnectSnippet {
	const url = mcpUrl(ctx.publicBaseUrl, ctx.workspaceId);
	const code = `# Install: pip install google-adk
# Env:     export ${ctx.apiKeyEnvVar}=wb_sk_...
#          (Gemini / Vertex auth via application-default credentials, ADC, or GOOGLE_API_KEY)

import os

from google.adk.agents import LlmAgent
from google.adk.tools.mcp_tool import MCPToolset
from google.adk.tools.mcp_tool.mcp_session_manager import (
    StreamableHTTPConnectionParams,
)

workbench = MCPToolset(
    connection_params=StreamableHTTPConnectionParams(
        url="${url}",
        headers={
            "Authorization": f"Bearer {os.environ['${ctx.apiKeyEnvVar}']}",
        },
    ),
)

agent = LlmAgent(
    name="workbench_research_agent",
    model="gemini-2.0-flash",
    instruction=(
        "Ground every answer in the AI Workbench knowledge base. "
        "Call search_kb before responding."
    ),
    tools=[workbench],
)

# Run with the ADK CLI:  adk run path/to/this_module.py
`;
	return {
		id: "google-adk",
		displayName: "Google ADK",
		tagline:
			"Wire AI Workbench into a Gemini-backed LlmAgent through ADK's MCPToolset.",
		language: "python",
		transport: "mcp",
		install: "pip install google-adk",
		code,
		requiresMcp: true,
		docsUrl: "https://google.github.io/adk-docs/tools/mcp-tools/",
		notes:
			"ADK >= 1.0.0 exposes MCPToolset with Streamable HTTP connection params. Run via `adk run` or `adk web`.",
	};
}
