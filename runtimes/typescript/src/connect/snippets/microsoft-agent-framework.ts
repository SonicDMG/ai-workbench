/**
 * Microsoft Agent Framework (Python flavour) — MCP transport via
 * `MCPStreamableHTTPTool`.
 *
 * MAF is the successor to Semantic Kernel's agent abstractions. The
 * MCP integration is the SDK's recommended path for third-party tool
 * surfaces; we use the OpenAI-backed `ChatAgent` here because it is
 * provider-portable (Azure OpenAI / OpenAI / OpenAI-compatible) and
 * matches the language of the docs.
 */

import type { ConnectSnippet, SnippetContext } from "../types.js";
import { mcpUrl } from "./urls.js";

export function buildMicrosoftAgentFrameworkSnippet(
	ctx: SnippetContext,
): ConnectSnippet {
	const url = mcpUrl(ctx.publicBaseUrl, ctx.workspaceId);
	const code = `# Install: pip install agent-framework
# Env:     export ${ctx.apiKeyEnvVar}=wb_sk_...
#          export OPENAI_API_KEY=sk-...   (or AZURE_OPENAI_* for Azure)

import asyncio
import os

from agent_framework import ChatAgent
from agent_framework.mcp import MCPStreamableHTTPTool
from agent_framework.openai import OpenAIChatClient


async def main() -> None:
    async with MCPStreamableHTTPTool(
        name="workbench",
        url="${url}",
        headers={
            "Authorization": f"Bearer {os.environ['${ctx.apiKeyEnvVar}']}",
        },
    ) as workbench:
        agent = ChatAgent(
            chat_client=OpenAIChatClient(model_id="gpt-4o-mini"),
            tools=workbench,
            instructions=(
                "Ground every answer in the AI Workbench knowledge base."
            ),
        )
        reply = await agent.run("Summarize the onboarding docs.")
        print(reply.text)


if __name__ == "__main__":
    asyncio.run(main())
`;
	return {
		id: "microsoft-agent-framework",
		displayName: "Microsoft Agent Framework",
		tagline:
			"Use AI Workbench as an MCP tool on any MAF ChatAgent (Azure OpenAI / OpenAI).",
		language: "python",
		transport: "mcp",
		install: "pip install agent-framework",
		code,
		requiresMcp: true,
		docsUrl:
			"https://learn.microsoft.com/en-us/agent-framework/integrations/mcp",
		notes:
			"Python preview SDK. A matching .NET package (Microsoft.Agents.AI) ships an equivalent MCPClient — the wire contract is identical.",
	};
}
