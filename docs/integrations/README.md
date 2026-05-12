# Integrations

AI Workbench is built to **plug into** the agent framework you already use,
not replace it. Each guide below shows the smallest copy-pasteable example for
treating a workspace as a knowledge / tool source from inside that framework.

The same recipes are rendered live, scoped to your workspace, on the
**Connect** tab in the product UI — open any workspace and click
**Connect** in the header. The UI bakes your workspace ID, an optional KB
scope, and the API-key env var into each snippet so you can copy without
hand-editing placeholders.

| Framework | Language | Transport | Status |
|---|---|---|---|
| [LangGraph](./langgraph.md) | Python | MCP (Streamable HTTP) | ✅ Ready |
| [CrewAI](./crewai.md) | Python | MCP (Streamable HTTP) | ✅ Ready |
| [Google ADK](./google-adk.md) | Python | MCP (Streamable HTTP) | ✅ Ready |
| [Microsoft Agent Framework](./microsoft-agent-framework.md) | Python (+ .NET) | MCP (Streamable HTTP) | ✅ Ready |
| [IBM watsonx Agent Builder](./watsonx.md) | UI / REST | MCP or OpenAPI | ✅ Ready |
| [Raw MCP smoke test (curl)](./mcp-raw.md) | Bash | MCP (Streamable HTTP) | ✅ Ready |

## Prerequisites

All of the recipes assume:

- **A running workspace** in AI Workbench with at least one knowledge base.
  See the [overview](../overview.md) and [quickstart](../../README.md#quickstart).
- **MCP enabled on the runtime** — set `mcp.enabled: true` in
  `workbench.yaml` (or pass it via env). The Connect tab warns you up-top
  if it's still off. See [`mcp.md`](../mcp.md) for the full surface.
- **A workspace API key** — issue one from the workspace's API-keys card.
  The Connect UI shows the env var name the snippets reference
  (`WORKBENCH_API_KEY` by default). The plaintext token is returned **once**
  at issuance — copy it into your shell env then.

## What gets exposed

The MCP façade is intentionally bounded — retrieval + a small write
surface that pairs naturally with it. The tools:

| Tool | Kind | What it does |
|---|---|---|
| `list_knowledge_bases` | read | Discover what's in the workspace. |
| `list_documents` | read | Page through documents in a KB. |
| `search_kb` | read | Vector / hybrid / rerank retrieval against a KB. |
| `list_chats`, `list_chat_messages` | read | Historical conversation context. |
| `ingest_text` | write | Append a new document to a KB (same dedup + chunk + embed pipeline as REST `POST /ingest`). |
| `delete_document` | write | Remove a document and cascade its chunks. Idempotent. |
| `chat_send` (*opt-in*) | write | Routes a message through the runtime's chat service. |

Larger mutations (KB CRUD, workspace mutation, service CRUD) stay off the
surface — see the discussion in [`mcp.md`](../mcp.md#why-these-tools-and-not-others).
The "watsonx → Path B" recipe shows how to wire those via the OpenAPI
doc when you do need them.

## A note on transports

Every recipe uses **MCP over Streamable HTTP**. Older MCP clients sometimes
only support stdio; check your framework's docs for version pinning. The
Streamable HTTP transport supports SSE for long-running tool calls — AI
Workbench's tool implementations are synchronous today, but the wire is
ready for streaming variants.

If your reverse proxy buffers SSE (Cloudflare quick tunnels are a common
gotcha), the [MCP transport notes](../mcp.md#tunnelling-and-reverse-proxy-notes)
list the workarounds.
