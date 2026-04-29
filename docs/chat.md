# Chat with Bobbie

Bobbie is the workspace-scoped chat assistant built into AI Workbench.
She answers questions grounded in the workspace's knowledge bases
using a HuggingFace chat-completion model.

This page explains how the surface works end-to-end: configuration,
data model, routes, retrieval, streaming, and where to look when
things break.

## Quick start

1. Generate a HuggingFace inference token at
   <https://huggingface.co/settings/tokens> with read scope.
2. Set `HUGGINGFACE_API_KEY` in your `.env` (see `.env.example`).
3. Uncomment the `chat:` block in
   [`runtimes/typescript/examples/workbench.yaml`](../runtimes/typescript/examples/workbench.yaml).
4. `npm run dev`. The boot log reads `chat service initialized model=…`.
5. Browse to a workspace, click **Chat with Bobbie** on the workspace
   detail page, type a message, watch tokens stream in.

Without the `chat:` block the runtime still boots and the rest of the
API works; only `POST .../chats/{id}/messages` and
`POST .../chats/{id}/messages/stream` return `503 chat_disabled`.

## Configuration

```yaml
# workbench.yaml
chat:
  tokenRef: env:HUGGINGFACE_API_KEY        # SecretRef
  model: mistralai/Mistral-7B-Instruct-v0.3
  maxOutputTokens: 1024
  retrievalK: 6                              # KB chunks per KB
  systemPrompt: null                         # null → built-in Bobbie persona
```

| Field | Type | Default | Notes |
|---|---|---|---|
| `tokenRef` | `SecretRef` | required | `env:VAR` or `file:/path`. Resolved once at boot and cached for the service's lifetime. |
| `model` | string | `mistralai/Mistral-7B-Instruct-v0.3` | Any model on HuggingFace's chat-completion-compatible Inference API. |
| `maxOutputTokens` | int (1–8192) | `1024` | Capped at the request layer; the model itself may stop earlier. |
| `retrievalK` | int (1–64) | `6` | Top-K chunks **per knowledge base**. The total injected into the prompt is `retrievalK * ceil(sqrt(numKbs))` (sub-linear in fan-out). |
| `systemPrompt` | string \| null | `null` | Override Bobbie's built-in persona. `null` keeps the default. |

## Data model

Persisted in the Stage-2 agentic tables; chat reuses them rather than
introducing parallel `wb_chat_*` tables. See
[`runtimes/typescript/src/astra-client/table-definitions.ts`](../runtimes/typescript/src/astra-client/table-definitions.ts).

| Table | What it stores |
|---|---|
| `wb_agentic_agents_by_workspace` | One **Bobbie** row per workspace. Deterministic `agent_id = sha256("bobbie:" + workspaceId)` so concurrent first-use callers converge on a single row instead of racing. |
| `wb_agentic_conversations_by_agent` | One row per chat. Carries `knowledge_base_ids: set<uuid>` for the per-conversation grounding filter. Empty / null = the conversation can draw from any KB in the workspace at retrieval time. |
| `wb_agentic_messages_by_conversation` | One row per turn. `role ∈ {user, agent, system}` (`tool` exists in the schema for future use but isn't surfaced today). `metadata` is a string map carrying RAG provenance, model id, finish reason, and any error message. |

Cascade behavior:

- **Workspace delete** → cascades agents → conversations → messages.
- **KB delete** → strips the kb id from every conversation's
  `knowledge_base_ids` set in the workspace.
- **Chat delete** → cascades its messages.

## HTTP surface

All routes are workspace-scoped, mounted under `/api/v1/workspaces/{w}/chats`.
Auth is enforced via `assertWorkspaceAccess`.

| Method | Path | Notes |
|---|---|---|
| `GET` | `/chats` | List Bobbie chats in the workspace, newest-first. Paginated. |
| `POST` | `/chats` | Create a chat. Body: `{ chatId?, title?, knowledgeBaseIds? }`. 409 on duplicate explicit `chatId`. |
| `GET` | `/chats/{chatId}` | Get one chat. |
| `PATCH` | `/chats/{chatId}` | Update title and / or `knowledgeBaseIds`. |
| `DELETE` | `/chats/{chatId}` | 204; cascades messages. |
| `GET` | `/chats/{chatId}/messages` | Oldest-first message log. Paginated. |
| `POST` | `/chats/{chatId}/messages` | **Synchronous** send: persists the user turn, retrieves KB context, calls the model, persists Bobbie's reply, returns `{ user, assistant }`. |
| `POST` | `/chats/{chatId}/messages/stream` | **SSE** send: emits `user-message`, then one `token` event per delta, then a terminal `done` (or `error`) carrying the persisted assistant row. |

### Streaming wire format

Browser clients use `fetch` with `Accept: text/event-stream` and parse
the response body manually — `EventSource` only supports `GET`. The
runtime helper that the web UI uses lives at
[`apps/web/src/lib/chatStream.ts`](../apps/web/src/lib/chatStream.ts).

```text
event: user-message
data: {"workspaceId":"…","chatId":"…","role":"user","content":"hi","messageId":"…","messageTs":"…","metadata":{}}

event: token
data: {"delta":"Hello"}

event: token
data: {"delta":" there"}

event: done
data: {"workspaceId":"…","chatId":"…","role":"agent","content":"Hello there","messageId":"…","messageTs":"…","metadata":{"model":"…","finish_reason":"stop","context_document_ids":"…"}}
```

On model failure the terminal event is `error` with the same
`ChatMessage` shape, where `metadata.finish_reason === "error"` and
the body contains the human-readable failure.

## Retrieval

Chat reuses the existing `dispatchSearch` helper that backs the
playground's vector / hybrid / rerank route. Per-conversation flow:

1. Resolve the effective KB set: `conversation.knowledge_base_ids` if
   non-empty, else every KB in the workspace.
2. Run vector search against each KB in parallel.
3. Merge results by score, cap at `retrievalK * ceil(sqrt(numKbs))`.
4. Inject the chunks into the system prompt as a labeled context
   block (Bobbie cites them inline with `[chunkId]` notation).
5. Capture the chunk IDs into `metadata.context_document_ids` on the
   assistant message for UI source-disclosure.

Per-KB failures are logged and skipped — Bobbie still answers with
partial grounding rather than 5xx-ing the whole reply.

## Persona

Built-in system prompt (override via `chat.systemPrompt`):

> You are Bobbie, an assistant grounded in the user's knowledge bases.
> Use the provided context to answer. When you draw on a context
> passage, cite it inline as `[chunkId]`. If the answer is not in the
> context, say so honestly rather than inventing it.

Defined alongside `bobbieAgentId` in
[`control-plane/defaults.ts`](../runtimes/typescript/src/control-plane/defaults.ts).

## UI

The web UI exposes chat at `/workspaces/{w}/chat`. Sidebar lists
existing conversations; the main pane shows the active conversation
with header (title + KB filter summary + Delete), message list, and
composer (Enter to send). While a stream is in flight, a streaming
bubble renders the in-flight tokens; when the terminal `done` (or
`error`) event lands, the bubble is replaced by the canonical
assistant row from the cache.

`?id=<chatId>` selects the active conversation — chats are
deep-linkable.

## Failure surface

| Symptom | Why | Fix |
|---|---|---|
| `503 chat_disabled` | No `chat:` block in `workbench.yaml`. | Add the block + token. |
| Boot fails with a SecretRef error | `tokenRef` couldn't be resolved (env var unset, file missing). | Set the env var or fix the path. |
| Assistant bubble shows red border + error text | Model returned an error or transport failed. | Check the runtime logs; `metadata.error_message` carries the provider message. |
| Tokens stop streaming halfway | Client disconnected (closed tab, navigated away). | The runtime aborts the model call cleanly and persists whatever was generated with `finish_reason: "stop"`. |
| Long delay before the first token | Retrieval + provider warm-up. The first token arrives after retrieval finishes. | Lower `retrievalK` or pin the model to a smaller variant. |

## Related docs

- [`configuration.md`](configuration.md) — full `workbench.yaml`
  schema, including the `chat` block.
- [`api-spec.md`](api-spec.md) — high-level API surface narrative.
- [`workspaces.md`](workspaces.md) — workspace semantics and cascade
  rules that chat inherits.
- [`architecture.md`](architecture.md) — how the runtime composes
  control plane, drivers, embedders, and (now) chat.
