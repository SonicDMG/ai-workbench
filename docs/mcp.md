# Model Context Protocol (MCP) façade

AI Workbench can expose a workspace as a [Model Context
Protocol](https://modelcontextprotocol.io) server, so external
agents — Claude Code, Cursor, Continue, hosted MCP gateways — can
use the workspace as a context backend. The agent sees the
workspace's read surface (KB search, documents, chats) as MCP
tools and resources; it never sees the raw HTTP API or has to
implement client code beyond the standard MCP SDK.

The façade is **off by default**. Enable explicitly via the
`mcp:` block in `workbench.yaml` to avoid surprising operators
who weren't planning to expand their attack surface.

## Quick start

1. Add to `workbench.yaml`:
   ```yaml
   mcp:
     enabled: true
     # Optional: also expose `chat_send`, which routes a message
     # through the runtime's global chat service. Inherits the
     # `chat:` block; the tool is silently skipped when chat is
     # unconfigured.
     exposeChat: false
   ```
2. Restart the runtime.
3. Point an MCP client at
   `http://<your-runtime>/api/v1/workspaces/{workspaceId}/mcp`.

The endpoint speaks
[Streamable HTTP](https://modelcontextprotocol.io/specification/2025-06-18/basic/transports#streamable-http)
— the modern MCP transport. Each request is stateless: no
session id, no per-client state survives between requests.

## Configuration

```yaml
mcp:
  enabled: true | false      # default: false
  exposeChat: true | false   # default: false; ignored when chat is unset
```

| Field | Default | Notes |
|-------|---------|-------|
| `enabled` | `false` | When false the MCP route returns `404 not_found` so the surface isn't probeable. |
| `exposeChat` | `false` | Adds the `chat_send` tool. Requires the `chat:` block; without it the tool is silently skipped. |

## Auth

The MCP route is mounted under `/api/v1/workspaces/{w}/mcp`, which
means the regular `/api/v1/*` auth middleware applies.
The shared workspace-route authorization wrapper is enforced on every
request: a scoped API key for workspace A cannot call MCP tools
against workspace B, even with the URL.

The default `auth.mode: disabled` (single-tenant dev runtime) lets
anonymous callers in. **For any deployment exposing MCP to external
agents, set `auth.mode: apiKey` (or stricter) and mint a workspace
API key per agent.**

## Tools

| Name | Args | Returns |
|------|------|---------|
| `list_knowledge_bases` | none | JSON array of `{ knowledgeBaseId, name, description, status, language }` |
| `list_documents` | `{ knowledgeBaseId, limit? }` | JSON array of document metadata (`documentId`, `sourceFilename`, `status`, `chunkTotal`, `contentHash`, `ingestedAt`) |
| `search_kb` | `{ knowledgeBaseId, text? \| vector?, topK?, hybrid?, rerank? }` | JSON array of search hits (`chunkId`, `score`, `documentId`, `content`) |
| `list_chats` | none | JSON array of chat summaries (`chatId`, `title`, `knowledgeBaseIds`, `createdAt`) |
| `list_chat_messages` | `{ chatId }` | Oldest-first message log (`messageId`, `role`, `content`, `messageTs`, `metadata`) |
| `ingest_text` | `{ knowledgeBaseId, text, sourceFilename?, sourceDocId?, metadata?, overwriteOnNameConflict? }` | JSON envelope with one of three `outcome` values: `completed` (new document — `documentId`, `sourceFilename`, `contentHash`, `chunks`), `duplicate` (content-hash match — pipeline did not run; returns the existing `documentId`), or `name_conflict` (`isError: true` — filename matched but bytes differ; retry with `overwriteOnNameConflict: true` or pick a new name). Runs the same dedup + chunk + embed + upsert pipeline as the REST `POST /ingest`. Always synchronous from the MCP caller's POV. |
| `delete_document` | `{ knowledgeBaseId, documentId }` | JSON object with `outcome`: `deleted` (`documentId`, `chunksDropped`) or `not_found` (no row matched the id — returned without `isError` so speculative cleanup doesn't need to branch). Wraps the same cascade helper the REST `DELETE /documents/{id}` route uses; vector chunks come down first, then the control-plane row. |
| `chat_send` *(opt-in)* | `{ chatId, content }` | The assistant's reply as a single text block. Persists both turns through the runtime's global chat service; the system prompt falls back to `DEFAULT_AGENT_SYSTEM_PROMPT` when `chat.systemPrompt` is unset. |

All tool results are returned as a single MCP `text` content item
containing JSON; clients parse it into native objects. This keeps
the wire format predictable across providers that handle structured
content differently.

## Why these tools and not others

The façade is mostly retrieval-shaped (`search_kb`, `list_*`) so
external agents can ground their reasoning in the workspace. Two
write tools — `ingest_text` and `delete_document` — were added once
the LangGraph / CrewAI / ADK story made it clear that *recording*
what an agent gathers (and cleaning up afterward) is half the value
of the integration. Larger mutations (KB CRUD, workspace mutation,
service CRUD) stay off the surface. Reasons:

- **Blast radius.** A misbehaving agent that can `search_kb` is a
  performance / cost concern; one that can `delete_kb` is a
  data-loss concern. `ingest_text` falls in the middle — its only
  observable effect is more KB content, which is reversible by
  `delete_document`. `delete_document` itself is scoped to a single
  document at a time (no "delete by filter" surface) so the radius
  stays predictable.
- **Auth semantics aren't fully there yet.** The current scoped API
  key is per-workspace; we have no per-tool scope. Until that lands
  (planned, see the roadmap), any key with workspace access can call
  any exposed tool. The write surface is intentionally bounded —
  `ingest_text`, `delete_document`, and the opt-in `chat_send` — so
  the upper bound is predictable.
- **Most useful surface first.** Retrieval is the killer feature for
  an MCP integration; ingestion is the most-asked-for write tool;
  delete pairs naturally with ingest for agents that maintain their
  own KB; everything else is incremental.

`chat_send` is exposed under a separate flag because it's the only
tool that costs HuggingFace tokens. `ingest_text` and
`delete_document` are unflagged: their cost is bounded by the
chunker + embedder on the workspace, which the operator already
controls through the regular ingest config.

## Streaming

Streamable HTTP supports SSE-formatted responses for long-running
tool calls; the SDK uses them automatically when the server
chooses. Today our tool implementations are synchronous (the only
long-running one is `chat_send`, and we return its full reply at
once rather than streaming progress notifications), but the
transport is ready when we add a streaming variant.

For the chat UI's own streaming, see
[`agents.md`](agents.md) — it uses the
`POST /agents/{a}/conversations/{c}/messages/stream` endpoint that
emits structured SSE events tailored to the UI rather than going
through MCP.

## Tunnelling and reverse-proxy notes

The MCP endpoint uses **SSE (Server-Sent Events)** to stream JSON-RPC
responses. Most reverse proxies and local-tunnel tools work fine, but
there are a few gotchas:

### Cloudflare quick tunnels (`trycloudflare.com`)

Quick tunnels (`cloudflare tunnel --url ...`) buffer SSE aggressively.
The client often sees an empty body or a stalled connection because
Cloudflare holds chunks until a flush threshold is reached or the
connection closes — the opposite of what SSE needs.

**Recommended alternatives for public dev access:**

| Option | Notes |
|--------|-------|
| **Cloudflare Tunnel (named)** | `cloudflare tunnel create <name>` + `cloudflare tunnel route dns` — persistent, named tunnels flush SSE correctly. |
| **ngrok** | `ngrok http 8080` — SSE works reliably out of the box. |
| **Real reverse proxy** | nginx / Caddy with `proxy_buffering off` (nginx) or default Caddy config both pass SSE through without buffering. |

### nginx

Add to the `location` block that proxies the runtime:

```nginx
location /api/v1/ {
    proxy_pass http://localhost:8080;
    proxy_buffering off;
    proxy_cache off;
    proxy_read_timeout 3600s;
    proxy_set_header Connection '';
    chunked_transfer_encoding on;
}
```

Without `proxy_buffering off`, nginx accumulates the SSE stream and
delivers it in one shot when the connection closes — which looks like a
hanging request from the MCP client's perspective.

### MCP client requirements

Most MCP clients require the endpoint URL to use `https://`. For local
development this means either:

- a named tunnel / ngrok (both provide HTTPS automatically), or
- a local TLS terminator (Caddy's `localhost` cert, `mkcert` + nginx).

`http://localhost:8080/...` works fine if your MCP client explicitly
allows plain HTTP local addresses.

## Failure surface

| Symptom | Why | Fix |
|---|---|---|
| `404 not_found` from `/.../mcp` | `mcp.enabled: false` (the default). | Set `mcp.enabled: true`. |
| `404 workspace_not_found` | Path workspace id doesn't exist. | Check the workspace id. |
| `401` / `403` | Caller lacks access. | Verify the API key scope (workspace match). |
| `chat_send` tool isn't registered | `exposeChat: false`, OR `chat:` is unset. | Set `exposeChat: true` AND wire the `chat:` block. |

## Related

- [Specification](https://modelcontextprotocol.io/specification/2025-06-18) — the MCP wire protocol.
- [`docs/configuration.md`](configuration.md) — full `workbench.yaml` schema.
- [`docs/auth.md`](auth.md) — the auth surface MCP inherits.
- [`docs/agents.md`](agents.md) — the agent surface that the chat UI uses; the `chat_send` MCP tool wraps the runtime's global chat service.
