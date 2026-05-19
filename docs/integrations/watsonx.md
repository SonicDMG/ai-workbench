# IBM watsonx Agent Builder

[IBM watsonx Agent Builder](https://www.ibm.com/products/watsonx-agent-builder)
is configured through its own web UI rather than code, so this guide
walks through the click path rather than a snippet.

> The Connect tab in the product UI shows the same recipe with your
> workspace URL and OpenAPI URL pre-filled. Open the workspace → click
> **Connect** → pick the **IBM watsonx Agent Builder** tab. You'll see
> the exact strings to paste into Builder's dialogs.

AI Workbench offers two paths into watsonx Agent Builder. Pick the one
that matches your runtime state:

| Path | When | Trade-offs |
|---|---|---|
| **A — Register as an MCP server** | `mcp.enabled` is `true` (the default) | Cleanest. One config, every read/write tool the workspace exposes shows up in the agent. Updates automatically as we add tools. |
| **B — Import the REST API as a custom tool** | Any runtime, including when `mcp.enabled: false`. | More verbose. One Builder "tool" per operation in `/api/v1/openapi.json`. Useful if you want fine-grained control over which routes the agent can call. |

You can run **both** against the same workspace — A for retrieval-shaped
calls the agent makes mid-conversation, B for back-office routes (KB
CRUD, workspace mutation) that Builder shouldn't auto-discover via MCP.

## Path A — Register as an MCP server (recommended)

### 1. Get the URLs

Open the workspace in AI Workbench, then click **Connect**. Copy:

- **MCP (Streamable HTTP)** URL — looks like
  `https://YOUR-WORKBENCH/api/v1/workspaces/YOUR-WORKSPACE-ID/mcp`.
- **API-key env var** name — `WORKBENCH_API_KEY` by default.

Mint a workspace API key from the workspace's **API keys** card. The
plaintext token is shown **once** — copy it immediately. You'll paste
it into Builder's auth dialog in the next step.

### 2. Add the MCP server in Builder

In watsonx Agent Builder, open the agent you want to ground in AI
Workbench. Then:

1. **Tools → Add tool → MCP server**.
2. Fill in:
   - **Server URL**: paste the MCP URL from step 1.
   - **Transport**: `Streamable HTTP`.
   - **Auth header**: name `Authorization`, value
     `Bearer <your WORKBENCH_API_KEY token>`.
3. **Save**. Builder probes the server and lists every tool the
   workspace exposes — typically:
   - `list_knowledge_bases`
   - `list_documents`
   - `search_kb`
   - `list_chats`, `list_chat_messages`
   - `ingest_text`, `delete_document` (when write tools are wired)
   - `chat_send` (when `mcp.exposeChat: true`)

Toggle on the ones the agent should call. Most agents only need
`search_kb` + `list_documents` for retrieval; add the write tools when
you want the agent to record its findings back.

### 3. Tell the agent to use the tools

In Builder's **Instructions** for the agent, add a sentence like:

> Use the AI Workbench tools to ground every answer. Call `search_kb`
> with the user's question before responding. If you find a useful new
> source mid-conversation, save it with `ingest_text`.

Builder generates the tool-call schemas from MCP automatically; you
don't need to describe them in the prompt.

### 4. Test

Use Builder's preview chat. A question that implies retrieval
("What does our onboarding policy say about laptop returns?") should
trigger a `search_kb` call you can see in the trace panel.

## Path B — Import the REST API as a custom tool

This path works against **any** AI Workbench runtime, MCP-enabled or
not. It imports `/api/v1/openapi.json` and Builder generates one
custom tool per operation.

### 1. Get the URLs + key

Same as Path A step 1, but you'll also need:

- **REST base URL** — copy from the Connect tab. Looks like
  `https://YOUR-WORKBENCH/api/v1`.
- **OpenAPI URL** — `https://YOUR-WORKBENCH/api/v1/openapi.json`.

### 2. Import the OpenAPI doc

In Builder:

1. **Tools → Add tool → Custom tool → From OpenAPI URL**.
2. Fill in:
   - **Source URL**: the OpenAPI URL.
   - **Server URL**: the REST base URL.
   - **Auth**: API key, header name `Authorization`, value
     `Bearer <your WORKBENCH_API_KEY token>`.
3. **Save**. Builder generates a tool per operation in the spec.

### 3. Prune the surface

The full `/api/v1/*` surface includes mutating routes (KB create,
workspace delete, agent CRUD, API-key issuance, …) you almost certainly
don't want an agent to call. After import:

- **Hide** every operation under `POST/PATCH/DELETE`
  `/workspaces/{w}/...` that isn't strictly retrieval.
- **Keep** `POST /search`, `GET /knowledge-bases`, `GET /documents`,
  `GET /jobs/{jobId}` and similar read paths.

The granular toggle is the whole point of Path B — you can be more
restrictive than the MCP read-mostly surface, at the cost of having to
manage the list yourself when we add new routes.

### 4. Test

Same as Path A — use Builder's preview chat and confirm a retrieval
question fires the `POST /search` operation in the trace.

## Combining A + B

A pragmatic split:

- **Path A** for the agent's day-to-day retrieval (`search_kb`,
  `list_documents`, `ingest_text`). Updates automatically as we add
  MCP tools.
- **Path B** for back-office operations the agent occasionally needs
  (e.g. `POST /jobs/{jobId}` to poll an async ingest you kicked off
  separately). Pin only the ones you want.

Both paths reference the same workspace API key, so revoking the key
in AI Workbench's API-keys card cuts off both surfaces at once.

## Troubleshooting

- **Builder says "MCP server didn't respond" on Save.** MCP is on by
  default, so this usually means someone explicitly set
  `mcp.enabled: false` on the runtime — remove that line (or flip it
  to `true`) and restart. Also check that Builder can actually reach
  the URL (no VPN-only access, no Cloudflare quick-tunnel SSE
  buffering — see [`mcp.md`](../mcp.md#tunnelling-and-reverse-proxy-notes)).
- **Builder lists zero tools after importing OpenAPI.** Confirm the
  Source URL returns JSON in a browser; the Server URL value can't
  carry trailing slashes; the Auth header is in the per-tool form,
  not Builder's global auth.
- **401 on every tool call.** Token revoked or wrong workspace; the
  Authorization header value must include the literal `Bearer ` prefix.
- **Agent never calls the workbench tools.** Builder doesn't probe
  tools without a prompt-level reason. Update the agent's
  **Instructions** to explicitly mention the AI Workbench surface.

## See also

- [`mcp.md`](../mcp.md) — the underlying MCP façade, tool surface, auth.
- [watsonx Agent Builder docs](https://www.ibm.com/docs/en/watsonx/saas?topic=tools-adding) — the framework side.
- [`docs/api-spec.md`](../api-spec.md) — the REST surface Path B consumes.
