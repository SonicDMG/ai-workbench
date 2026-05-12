/**
 * LangGraph (Python) — MCP transport via `langchain-mcp-adapters`.
 *
 * LangGraph is the most widely-adopted OSS agent framework, so this is
 * the highest-leverage recipe in the catalog. The snippet wires a
 * `MultiServerMCPClient` against the workspace's MCP endpoint and
 * spins up a prebuilt ReAct agent that grounds answers in whatever
 * KBs are visible.
 *
 * The user supplies the API key via the `WORKBENCH_API_KEY` env var —
 * we never echo a secret into the rendered code.
 */

import type { ConnectSnippet, SnippetContext } from "../types.js";
import { mcpUrl } from "./urls.js";

export function buildLangGraphSnippet(ctx: SnippetContext): ConnectSnippet {
	const url = mcpUrl(ctx.publicBaseUrl, ctx.workspaceId);
	const code = `# Install: pip install langgraph langchain-mcp-adapters langchain-openai
# Env:     export ${ctx.apiKeyEnvVar}=wb_sk_...   (mint at the Connect tab)
#          export OPENAI_API_KEY=sk-...

import asyncio
import os

from langchain_mcp_adapters.client import MultiServerMCPClient
from langgraph.prebuilt import create_react_agent


async def main() -> None:
    client = MultiServerMCPClient(
        {
            "workbench": {
                "transport": "streamable_http",
                "url": "${url}",
                "headers": {
                    "Authorization": f"Bearer {os.environ['${ctx.apiKeyEnvVar}']}",
                },
            }
        }
    )
    tools = await client.get_tools()

    agent = create_react_agent("openai:gpt-4o-mini", tools)
    response = await agent.ainvoke(
        {"messages": [("user", "Summarize the onboarding docs.")]}
    )
    print(response["messages"][-1].content)


if __name__ == "__main__":
    asyncio.run(main())
`;
	return {
		id: "langgraph",
		displayName: "LangGraph",
		tagline:
			"Drop AI Workbench in as a tool source on any LangGraph node via MCP.",
		language: "python",
		transport: "mcp",
		install: "pip install langgraph langchain-mcp-adapters langchain-openai",
		code,
		requiresMcp: true,
		docsUrl: "https://langchain-ai.github.io/langgraph/agents/mcp/",
		notes:
			"Uses LangChain's MultiServerMCPClient with Streamable HTTP. The workspace's read tools (search_kb, list_documents, list_knowledge_bases) become LangChain tools the ReAct agent can call directly.",
	};
}
