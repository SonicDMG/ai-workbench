# CrewAI

> **Status: stub.** The product UI's Connect tab already renders a working
> CrewAI snippet for any workspace — open the workspace, click **Connect**,
> and pick the **CrewAI** tab. The long-form walkthrough below is on the
> way; see [LangGraph](./langgraph.md) for the same structure we'll follow
> here.

## TL;DR

```bash
pip install 'crewai[tools]'
export WORKBENCH_API_KEY=wb_sk_...
export OPENAI_API_KEY=sk-...
```

```python
from crewai import Agent, Crew, Task
from crewai_tools import MCPServerAdapter
import os

server_params = {
    "url": "https://YOUR-WORKBENCH/api/v1/workspaces/YOUR-WORKSPACE-ID/mcp",
    "transport": "streamable-http",
    "headers": {"Authorization": f"Bearer {os.environ['WORKBENCH_API_KEY']}"},
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
    print(Crew(agents=[researcher], tasks=[task]).kickoff())
```

The `MCPServerAdapter` exposes every read tool the workspace publishes to
each agent in the crew that lists it under `tools=`.

## See also

- [Connect tab](../../README.md#current-http-surface) — the product surface that renders this snippet pre-filled.
- [CrewAI MCP docs](https://docs.crewai.com/en/mcp/overview) — the framework side.
- [`mcp.md`](../mcp.md) — the underlying façade.
