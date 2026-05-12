# Microsoft Agent Framework (MAF)

[Microsoft Agent Framework](https://learn.microsoft.com/en-us/agent-framework/)
is Microsoft's successor to Semantic Kernel's agent abstractions —
single-agent and multi-agent workflows on top of any chat-completion
provider (Azure OpenAI / OpenAI / OpenAI-compatible / Mistral, …). AI
Workbench plugs in as a tool source via MAF's first-class
**`MCPStreamableHTTPTool`**.

> The Connect tab in the product UI renders this exact recipe pre-filled
> with your workspace ID and the env var name your API key lives under.
> Open the workspace → click **Connect** → pick the **Microsoft Agent
> Framework** tab.

The Python preview SDK is the fast path; the .NET package
(`Microsoft.Agents.AI`) ships an equivalent `MCPClient` with an
identical wire contract — the same workspace works with either flavour.

## 1. Install

### Python

```bash
pip install agent-framework
```

### .NET

```bash
dotnet add package Microsoft.Agents.AI
dotnet add package Microsoft.Agents.AI.OpenAI
```

## 2. Mint an API key + LLM auth

In the workspace UI, open the **API keys** card and create a key
(label it `maf-research` or similar). Copy the plaintext token — shown
once.

```bash
export WORKBENCH_API_KEY=wb_sk_...

# Pick one LLM backend
export OPENAI_API_KEY=sk-...                    # OpenAI
# or
export AZURE_OPENAI_ENDPOINT=https://your-resource.openai.azure.com
export AZURE_OPENAI_API_KEY=...
export AZURE_OPENAI_CHAT_DEPLOYMENT_NAME=gpt-4o-mini
```

## 3. Wire AI Workbench into a ChatAgent (Python)

```python
import asyncio
import os

from agent_framework import ChatAgent
from agent_framework.mcp import MCPStreamableHTTPTool
from agent_framework.openai import OpenAIChatClient


async def main() -> None:
    async with MCPStreamableHTTPTool(
        name="workbench",
        url="https://YOUR-WORKBENCH/api/v1/workspaces/YOUR-WORKSPACE-ID/mcp",
        headers={
            "Authorization": f"Bearer {os.environ['WORKBENCH_API_KEY']}",
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
```

The `async with ... as workbench` form is **required** — `MCPStreamableHTTPTool`
opens an MCP session on enter and tears it down on exit. Skipping the
context manager will leak the session and miss tool registration.

Replace the URL with the **MCP (Streamable HTTP)** endpoint shown on
the Connect tab.

## 4. The same flow against Azure OpenAI

```python
from agent_framework.azure import AzureOpenAIChatClient

agent = ChatAgent(
    chat_client=AzureOpenAIChatClient(
        # Picks up AZURE_OPENAI_* env vars.
        deployment_name=os.environ["AZURE_OPENAI_CHAT_DEPLOYMENT_NAME"],
    ),
    tools=workbench,
    instructions="...",
)
```

The chat-client is the only thing that changes — `MCPStreamableHTTPTool`
is provider-agnostic.

## 5. .NET equivalent (sketch)

```csharp
using Microsoft.Agents.AI;
using Microsoft.Agents.AI.OpenAI;
using Microsoft.Agents.AI.Mcp;

await using var workbench = new McpClient(new StreamableHttpClientOptions
{
    Url = "https://YOUR-WORKBENCH/api/v1/workspaces/YOUR-WORKSPACE-ID/mcp",
    Headers =
    {
        ["Authorization"] = $"Bearer {Environment.GetEnvironmentVariable("WORKBENCH_API_KEY")}",
    },
});

var agent = new ChatAgent(
    chatClient: new OpenAIChatClient("gpt-4o-mini"),
    tools: workbench.Tools,
    instructions: "Ground every answer in the AI Workbench knowledge base."
);

var reply = await agent.RunAsync("Summarize the onboarding docs.");
Console.WriteLine(reply.Text);
```

Same wire, same tool surface. Pick whichever runtime fits the rest of
your stack.

## 6. Multi-agent workflows

MAF's `Workflow` and `Orchestration` types compose agents into graphs
similar to LangGraph. AI Workbench plugs into individual agents in the
graph — the same `MCPStreamableHTTPTool` instance can be shared:

```python
async with MCPStreamableHTTPTool(...) as workbench:
    researcher = ChatAgent(
        chat_client=client, tools=workbench,
        instructions="Find sources in the KB."
    )
    writer = ChatAgent(
        chat_client=client, tools=workbench,
        instructions="Draft based on the researcher's findings."
    )
    # Wire researcher → writer into a Workflow / Orchestration as usual.
```

## 7. Scope to a specific KB

`MCPStreamableHTTPTool` exposes every tool the MCP server advertises.
To bias an agent toward one KB:

- **Bake the KB id into `instructions`.** Tell the model to pass
  `knowledgeBaseId="..."` to `search_kb`.
- **Render a KB-scoped snippet from the Connect tab.** Pick the KB
  from the **Scope** dropdown — the rendered snippet's tagline reminds
  the reader which KB it's been narrowed to.

## 8. Write tools (ingest_text, delete_document)

If `mcp.enabled` is on **and** the runtime has the write tools wired,
they appear under the same `workbench` toolset. The model picks them
when `instructions` encourages it:

```python
researcher = ChatAgent(
    chat_client=client,
    tools=workbench,
    instructions=(
        "When you find a useful source, call ingest_text with the text"
        " and a sourceFilename so later turns can retrieve it."
    ),
)
```

See [`mcp.md`](../mcp.md) for the write-tool surface and intentional
limits (one-document delete only, no KB CRUD).

## Troubleshooting

- **`ImportError: MCPStreamableHTTPTool`.** `agent-framework` is still
  in preview — pin to a recent release (`pip install -U agent-framework`).
- **404 from the MCP endpoint.** MCP is off on the runtime. Set
  `mcp.enabled: true` in `workbench.yaml` and restart.
- **401 on every tool call.** Wrong / revoked bearer token, or the
  workspace id in the path doesn't match the key's workspace.
- **Agent never calls workbench tools.** Confirm the `instructions`
  actually mention the KB. The model needs a prompt-level reason to
  probe an MCP tool surface.
- **Session leaks under load.** You're constructing
  `MCPStreamableHTTPTool` without the `async with` (or .NET `await
  using`). Sessions are bound to the context manager lifetime — short
  agent runs should construct + tear down per call; long-lived
  processes should hold one session and reuse the agent.

## See also

- [`mcp.md`](../mcp.md) — the underlying MCP façade, tool surface, auth.
- [MAF MCP integration docs](https://learn.microsoft.com/en-us/agent-framework/integrations/mcp) —
  the framework side of the same wire.
- [MAF agents reference](https://learn.microsoft.com/en-us/agent-framework/agents/)
