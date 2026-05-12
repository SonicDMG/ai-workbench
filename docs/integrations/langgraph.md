# LangGraph

[LangGraph](https://langchain-ai.github.io/langgraph/) is LangChain's
graph-based agent framework. AI Workbench plugs in as an MCP tool source —
every read tool the workspace exposes (`search_kb`, `list_documents`, …)
becomes a LangChain tool you can hand to any LangGraph node.

> The Connect tab in the product UI renders this exact recipe pre-filled
> with your workspace ID and the env var name your API key lives under.
> Open the workspace → click **Connect** → pick the **LangGraph** tab.

## 1. Install

```bash
pip install langgraph langchain-mcp-adapters langchain-openai
```

`langchain-mcp-adapters` is the package that converts an MCP server into
LangChain `Tool` instances. It ships a `MultiServerMCPClient` that
supports multiple MCP servers in one agent — handy when you also want
Slack / GitHub / etc. tools alongside AI Workbench.

## 2. Mint an API key

In the workspace UI, open the **API keys** card and create a key
(label it something memorable, e.g. `langgraph-local-dev`). The plaintext
token is shown **once** — copy it immediately.

Export it under the env var the Connect tab tells you to use:

```bash
export WORKBENCH_API_KEY=wb_sk_...
export OPENAI_API_KEY=sk-...   # or any other LangChain-supported LLM
```

## 3. Wire AI Workbench into a ReAct agent

```python
import asyncio
import os

from langchain_mcp_adapters.client import MultiServerMCPClient
from langgraph.prebuilt import create_react_agent


async def main() -> None:
    client = MultiServerMCPClient(
        {
            "workbench": {
                "transport": "streamable_http",
                "url": "https://YOUR-WORKBENCH/api/v1/workspaces/YOUR-WORKSPACE-ID/mcp",
                "headers": {
                    "Authorization": f"Bearer {os.environ['WORKBENCH_API_KEY']}",
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
```

Replace the URL with the **MCP (Streamable HTTP)** endpoint shown on the
Connect tab. The agent calls `search_kb` automatically when the question
implies retrieval.

## 4. Scope to a specific KB

`MultiServerMCPClient` returns every tool the MCP server exposes. To bias
the agent toward a specific KB, either:

- **Filter at construction time.** `await client.get_tools()` returns a
  plain list — keep only the ones you want.
- **Bake it into the system prompt.** The `search_kb` tool accepts a
  `knowledgeBaseId` argument; tell the model in its instructions to always
  pass the workspace's `kb_legal` (or whichever) id.
- **Render a KB-scoped snippet.** Pick the KB from the **Scope** dropdown
  on the Connect tab; the Connect API can also be hit directly:
  `GET /api/v1/workspaces/{w}/connect/snippets?knowledgeBaseId=...`
  and feeds that scope hint into the rendered tagline.

## 5. Use the workspace from a graph node, not a prebuilt agent

The prebuilt ReAct agent is fine for quick demos. For production graphs
you typically want the workbench tools bound to a specific node:

```python
from langgraph.graph import StateGraph, START, END
from langchain_openai import ChatOpenAI

llm = ChatOpenAI(model="gpt-4o-mini").bind_tools(tools)

async def researcher(state):
    response = await llm.ainvoke(state["messages"])
    return {"messages": [response]}

graph = (
    StateGraph(dict)
    .add_node("researcher", researcher)
    .add_edge(START, "researcher")
    .add_edge("researcher", END)
)
```

…and pass `tools` only to the node that should reach AI Workbench. A
supervisor node further up the graph stays unaware of the KB.

## Troubleshooting

- **404 from the MCP endpoint.** MCP is off on the runtime. Set
  `mcp.enabled: true` in `workbench.yaml` and restart.
- **401 on every tool call.** The bearer token is wrong, revoked, or the
  workspace id in the path doesn't match the key's workspace.
- **Tools list is empty.** The runtime is reachable but you're hitting a
  workspace with no knowledge bases. `search_kb` is registered
  unconditionally but doesn't surface meaningful results until a KB
  exists.
- **SSE stalls under Cloudflare quick tunnels.** Known gotcha — see
  [`mcp.md`](../mcp.md#cloudflare-quick-tunnels-trycloudflarecom) for
  alternatives (named Cloudflare tunnels, ngrok, real reverse proxy).

## See also

- [`mcp.md`](../mcp.md) — the underlying MCP façade, tool surface,
  auth, and transport notes.
- [LangGraph MCP docs](https://langchain-ai.github.io/langgraph/agents/mcp/) —
  the framework side of the same wire.
