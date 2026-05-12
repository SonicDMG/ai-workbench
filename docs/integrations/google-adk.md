# Google Agent Development Kit (ADK)

> **Status: stub.** Connect tab in the product UI renders this snippet
> pre-filled for any workspace.

## TL;DR

```bash
pip install google-adk
export WORKBENCH_API_KEY=wb_sk_...
# (Gemini auth via ADC, GOOGLE_API_KEY, or Vertex)
```

```python
from google.adk.agents import LlmAgent
from google.adk.tools.mcp_tool import MCPToolset
from google.adk.tools.mcp_tool.mcp_session_manager import StreamableHTTPConnectionParams
import os

workbench = MCPToolset(
    connection_params=StreamableHTTPConnectionParams(
        url="https://YOUR-WORKBENCH/api/v1/workspaces/YOUR-WORKSPACE-ID/mcp",
        headers={"Authorization": f"Bearer {os.environ['WORKBENCH_API_KEY']}"},
    ),
)

agent = LlmAgent(
    name="workbench_research_agent",
    model="gemini-2.0-flash",
    instruction="Ground every answer in the AI Workbench knowledge base.",
    tools=[workbench],
)
```

Run via `adk run` / `adk web`.

## See also

- [ADK MCP tools docs](https://google.github.io/adk-docs/tools/mcp-tools/)
- [`mcp.md`](../mcp.md)
