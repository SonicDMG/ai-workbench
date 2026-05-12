# CrewAI

[CrewAI](https://docs.crewai.com/) models multi-agent work as a **Crew**:
roles, tasks, and tools composed declaratively. AI Workbench plugs in as
an MCP tool source — every read/write tool the workspace exposes
(`search_kb`, `list_documents`, `ingest_text`, …) becomes a CrewAI tool
any agent in the crew can call.

> The Connect tab in the product UI renders this exact recipe pre-filled
> with your workspace ID and the env var name your API key lives under.
> Open the workspace → click **Connect** → pick the **CrewAI** tab.

## 1. Install

```bash
pip install 'crewai[tools]'
```

The `tools` extra pulls in `crewai-tools`, which ships the
`MCPServerAdapter` you'll use below. `MCPServerAdapter` ≥ 0.34 supports
**Streamable HTTP** — older versions only spoke stdio and won't reach a
remote workbench.

## 2. Mint an API key

In the workspace UI, open the **API keys** card and create a key
(label it something memorable, e.g. `crewai-research`). The plaintext
token is shown **once** — copy it immediately.

```bash
export WORKBENCH_API_KEY=wb_sk_...
export OPENAI_API_KEY=sk-...   # or any other CrewAI-supported LLM
```

## 3. Wire AI Workbench into a Crew

```python
import os

from crewai import Agent, Crew, Task
from crewai_tools import MCPServerAdapter

server_params = {
    "url": "https://YOUR-WORKBENCH/api/v1/workspaces/YOUR-WORKSPACE-ID/mcp",
    "transport": "streamable-http",
    "headers": {
        "Authorization": f"Bearer {os.environ['WORKBENCH_API_KEY']}",
    },
}

with MCPServerAdapter(server_params) as workbench_tools:
    researcher = Agent(
        role="Knowledge-base researcher",
        goal="Answer the user's question using AI Workbench retrieval.",
        backstory="You ground every claim in the workspace's knowledge bases.",
        tools=workbench_tools,
    )

    task = Task(
        description="Summarize how onboarding works, using the KB as source.",
        expected_output="A 3-sentence summary citing the KB.",
        agent=researcher,
    )

    crew = Crew(agents=[researcher], tasks=[task])
    print(crew.kickoff())
```

Replace the URL with the **MCP (Streamable HTTP)** endpoint shown on the
Connect tab. Note the **hyphen** in `streamable-http` — CrewAI's spelling
differs from LangChain's (`streamable_http`, underscore). Easy to miss
when porting snippets between frameworks.

The `with MCPServerAdapter(...) as ...` form opens a session per crew
run and tears it down on exit. For long-lived processes, prefer
`adapter.start()` / `adapter.stop()` to keep the session alive across
runs.

## 4. Use AI Workbench across multiple agents

CrewAI's strength is composing roles. Share the same tool set across a
researcher + writer + reviewer crew by passing `workbench_tools` to
each `Agent(tools=...)`:

```python
with MCPServerAdapter(server_params) as workbench_tools:
    researcher = Agent(role="Researcher", goal="Find sources", tools=workbench_tools, ...)
    writer = Agent(role="Writer", goal="Synthesize a draft", tools=workbench_tools, ...)
    reviewer = Agent(role="Reviewer", goal="Fact-check claims", tools=workbench_tools, ...)

    crew = Crew(
        agents=[researcher, writer, reviewer],
        tasks=[research_task, draft_task, review_task],
        process=Process.sequential,
    )
```

Each agent gets its own conversation context but shares the same MCP
session, so retrievals stay consistent across the workflow.

## 5. Scope to a specific KB

`MCPServerAdapter` exposes every tool the MCP server advertises. To bias
agents toward one KB:

- **Bake the KB into the agent's instructions.** `search_kb` takes a
  `knowledgeBaseId` argument; tell each agent's `backstory` or `goal`
  to always pass `kb_legal` (or whichever).
- **Render a KB-scoped snippet from the Connect tab.** Pick the KB
  from the **Scope** dropdown — the rendered snippet's tagline reminds
  the reader which KB it's been narrowed to.

## 6. Write tools (ingest_text, delete_document)

If `mcp.enabled` is on **and** the runtime has the write tools wired,
CrewAI agents can also persist their work back into a KB:

```python
researcher = Agent(
    role="Researcher",
    goal="Find sources AND record findings in the KB for later agents.",
    backstory=(
        "When you find a useful source, call `ingest_text` with the text"
        " and a sourceFilename so future runs can retrieve it."
    ),
    tools=workbench_tools,
)
```

The model will pick `ingest_text` based on the instruction. See
[`mcp.md`](../mcp.md) for the write-tool surface and intentional limits
(one-document delete only, no KB CRUD).

## Troubleshooting

- **`MCPServerAdapter` raises on `transport: "streamable-http"`.**
  `crewai-tools` < 0.34 only supports stdio. Upgrade.
- **404 from the MCP endpoint.** MCP is off on the runtime. Set
  `mcp.enabled: true` in `workbench.yaml` and restart.
- **401 on every tool call.** Wrong / revoked bearer token, or the
  workspace id in the path doesn't match the key's workspace.
- **The crew hangs after `kickoff()`.** Streaming responses behind a
  buffering proxy (Cloudflare quick tunnels are a common one). See
  [`mcp.md`](../mcp.md#tunnelling-and-reverse-proxy-notes) for the
  workarounds.

## See also

- [`mcp.md`](../mcp.md) — the underlying MCP façade, tool surface, auth.
- [CrewAI MCP docs](https://docs.crewai.com/en/mcp/overview) — the
  framework side of the same wire.
