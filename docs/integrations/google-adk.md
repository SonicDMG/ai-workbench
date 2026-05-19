# Google Agent Development Kit (ADK)

[Google ADK](https://google.github.io/adk-docs/) is Google's first-party
agent framework, paired with Gemini / Vertex AI. AI Workbench plugs in
as a tool source via ADK's first-class **`MCPToolset`** — pass it on an
`LlmAgent` and the workspace's tools become callable from the model.

> The Connect tab in the product UI renders this exact recipe pre-filled
> with your workspace ID and the env var name your API key lives under.
> Open the workspace → click **Connect** → pick the **Google ADK** tab.

## 1. Install

```bash
pip install google-adk
```

`google-adk` ≥ 1.0 ships `MCPToolset` with Streamable HTTP connection
params. Older 0.x versions are stdio-only and won't reach a remote
workbench.

## 2. Mint an API key + Gemini auth

In the workspace UI, open the **API keys** card and create a key
(label it something like `adk-research`). Copy the plaintext token —
it's shown once.

```bash
export WORKBENCH_API_KEY=wb_sk_...
```

Gemini auth has three flavours; pick one:

```bash
# Option 1 — AI Studio key (simplest)
export GOOGLE_API_KEY=...

# Option 2 — Vertex AI via application-default credentials
gcloud auth application-default login
export GOOGLE_GENAI_USE_VERTEXAI=true
export GOOGLE_CLOUD_PROJECT=your-project
export GOOGLE_CLOUD_LOCATION=us-central1

# Option 3 — Vertex via service account
export GOOGLE_APPLICATION_CREDENTIALS=/path/to/sa.json
export GOOGLE_GENAI_USE_VERTEXAI=true
```

## 3. Wire AI Workbench into an LlmAgent

```python
import os

from google.adk.agents import LlmAgent
from google.adk.tools.mcp_tool import MCPToolset
from google.adk.tools.mcp_tool.mcp_session_manager import (
    StreamableHTTPConnectionParams,
)

workbench = MCPToolset(
    connection_params=StreamableHTTPConnectionParams(
        url="https://YOUR-WORKBENCH/api/v1/workspaces/YOUR-WORKSPACE-ID/mcp",
        headers={
            "Authorization": f"Bearer {os.environ['WORKBENCH_API_KEY']}",
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
```

Replace the URL with the **MCP (Streamable HTTP)** endpoint shown on
the Connect tab. The agent calls `search_kb` automatically when the
question implies retrieval, just like ADK's built-in tools.

## 4. Run it

Two ways:

```bash
# Headless CLI
adk run path/to/this_module.py

# Local dev UI (chat + trace viewer)
adk web
```

`adk web` is especially useful for the demo case — you can watch ADK's
trace viewer light up the `search_kb` / `list_documents` tool calls
as they fire, which makes the integration self-evident.

## 5. Compose with other ADK toolsets

`MCPToolset` is just another `Toolset`. Mix it with built-ins:

```python
from google.adk.tools.google_search_tool import GoogleSearchTool

agent = LlmAgent(
    name="researcher",
    model="gemini-2.0-flash",
    instruction=(
        "Prefer the AI Workbench KB. Fall back to Google Search only"
        " if the KB has nothing relevant."
    ),
    tools=[workbench, GoogleSearchTool()],
)
```

## 6. Scope to a specific KB

`MCPToolset` exposes every tool the MCP server advertises. To bias
the agent toward one KB:

- **Bake the KB id into the `instruction`.** Tell the model to always
  pass `knowledgeBaseId="..."` to `search_kb`.
- **Render a KB-scoped snippet from the Connect tab.** Pick the KB
  from the **Scope** dropdown — the rendered snippet's tagline reminds
  the reader which KB it's been narrowed to.
- **Filter tools at construction time.** `MCPToolset` accepts a
  `tool_filter` predicate (ADK ≥ 1.2) — you can hide tools you don't
  want the agent to call.

## 7. Write tools (ingest_text, delete_document)

If `mcp.enabled` is on **and** the runtime has the write tools wired,
the same toolset exposes them. The model will pick `ingest_text` when
the instruction encourages it — useful for sub-agents that need to
record their findings:

```python
researcher = LlmAgent(
    name="researcher",
    model="gemini-2.0-flash",
    instruction=(
        "When you find a useful source, call ingest_text with the text"
        " and a sourceFilename so later agents in the session can"
        " retrieve it via search_kb."
    ),
    tools=[workbench],
)
```

See [`mcp.md`](../mcp.md) for the write-tool surface and intentional
limits (one-document delete only, no KB CRUD).

## Troubleshooting

- **`ImportError: StreamableHTTPConnectionParams`.** `google-adk` < 1.0;
  upgrade.
- **404 from the MCP endpoint.** MCP is on by default; a 404 means
  someone set `mcp.enabled: false` in `workbench.yaml`. Remove that
  line (or flip it to `true`) and restart.
- **401 on every tool call.** Wrong / revoked bearer token, or the
  workspace id in the path doesn't match the key's workspace.
- **`adk web` hangs on tool call.** Streaming behind a buffering proxy.
  See [`mcp.md`](../mcp.md#tunnelling-and-reverse-proxy-notes).
- **Gemini returns "no usable tool" even though the workbench is
  reachable.** Confirm the `instruction` actually mentions the
  workbench / KB; Gemini doesn't probe tools without a prompt-level
  reason to.

## See also

- [`mcp.md`](../mcp.md) — the underlying MCP façade, tool surface, auth.
- [ADK MCP tools docs](https://google.github.io/adk-docs/tools/mcp-tools/) —
  the framework side of the same wire.
- [ADK LlmAgent reference](https://google.github.io/adk-docs/agents/llm-agents/)
