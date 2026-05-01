# User-defined agents

Agents are the unit of chat in a workspace. Create one or more per
workspace; each one carries its own persona, RAG defaults, optional
LLM service, and conversation history. The runtime's send + streaming
pipeline runs against any agent — there is no built-in chat surface
above this layer.

> **Historical note.** Earlier drafts of the runtime auto-provisioned
> a singleton "Bobbie" agent and exposed a parallel `/chats` route as
> a thin alias. Bobbie was retired alongside the chat surface; new
> workspaces start with zero agents and the chat UI prompts the user
> to create their first on first visit. Existing agent rows in
> production tables (including any that were originally Bobbie) keep
> working — they are ordinary agent records that can be renamed or
> deleted.

## Concepts

| Term | What it is |
|---|---|
| **Agent** | A row in `wb_agentic_agents_by_workspace`. Carries name, system / user prompts, RAG defaults (`ragEnabled`, `ragMaxResults`, `ragMinScore`, `knowledgeBaseIds`), reranker overrides, and an optional `llmServiceId` pointing at the LLM executor it uses. |
| **Conversation** | A row in `wb_agentic_conversations_by_agent`. One conversation belongs to exactly one (workspace, agent) pair. Carries `title` and a per-conversation `knowledgeBaseIds` filter that overrides the agent's default at retrieval time. |
| **Message** | A row in `wb_agentic_messages_by_conversation`. Same shape across all agents — `role ∈ {user, agent, system, tool}`, `metadata` carries RAG provenance / model id / finish reason. |

There is no built-in agent. Workspaces start with zero agents; the
chat UI prompts the user to create their first on first visit. When
you delete an agent the cascade goes agent → its conversations →
their messages. Workspace delete cascades workspace → agents →
conversations → messages.

## Data model

See
[`runtimes/typescript/src/astra-client/table-definitions.ts`](../runtimes/typescript/src/astra-client/table-definitions.ts)
for the wire-level types. The store-level shapes are in
[`runtimes/typescript/src/control-plane/types.ts`](../runtimes/typescript/src/control-plane/types.ts):

```ts
interface AgentRecord {
  workspaceId: string;
  agentId: string;
  name: string;
  description: string | null;
  systemPrompt: string | null;
  userPrompt: string | null;
  toolIds: readonly string[];     // unused in v0; reserved for tool-using agents
  llmServiceId: string | null;    // optional pointer to an LLM executor
  ragEnabled: boolean;
  knowledgeBaseIds: readonly string[];
  ragMaxResults: number | null;
  ragMinScore: number | null;
  rerankEnabled: boolean;
  rerankingServiceId: string | null;
  rerankMaxResults: number | null;
  createdAt: string;
  updatedAt: string;
}

interface ConversationRecord {
  workspaceId: string;
  agentId: string;
  conversationId: string;
  title: string | null;
  knowledgeBaseIds: readonly string[];
  createdAt: string;
}
```

`agent.knowledgeBaseIds` is the **default** RAG-grounding set.
`conversation.knowledgeBaseIds` overrides it for the conversation
when populated; empty means "fall back to the agent's default, or to
all KBs in the workspace if the agent's set is also empty".

## LLM service binding

`agent.llmServiceId` is mutable and optional. Resolution order at
send time:

1. **Per-agent service.** If `agent.llmServiceId` is set, the runtime
   fetches the matching `wb_config_llm_service_by_workspace` row and
   instantiates a chat service from it. Two providers are wired
   end-to-end today: `provider: "huggingface"` (via the HuggingFace
   Inference API) and `provider: "openai"` (the only one with native
   function calling, required for the agent tool-call loop). Any
   other provider returns `422 llm_provider_unsupported` until its
   adapter lands. A bound service without a `credentialRef` returns
   `422 llm_credential_missing`.
2. **Workspace fallback.** If `agent.llmServiceId` is unset, the
   runtime falls back to the global `chat:` block in
   `workbench.yaml`. The fallback only ever uses HuggingFace —
   `chat:` predates the per-agent LLM service surface and has no
   provider field.
3. **Hard stop.** If neither is configured, `POST .../messages` and
   `POST .../messages/stream` return `503 chat_disabled`. The agent
   record itself is unaffected; you can still list / patch / delete
   it without an LLM available.

The system prompt resolves in the same layered way:
`agent.systemPrompt` wins if set, otherwise `chatConfig.systemPrompt`
from `workbench.yaml`, otherwise the runtime falls back to
`DEFAULT_AGENT_SYSTEM_PROMPT` from
[`control-plane/defaults.ts`](../runtimes/typescript/src/control-plane/defaults.ts).
The same precedence holds for the system prompt regardless of which
chat service provider was selected — the prompt is added as the first
turn in the prompt envelope before any RAG-retrieved chunks.

**Tool calling.** The agent dispatcher's tool-execution loop (RAG
search, list KBs, summarize, etc.) requires the underlying provider
to support native function calling. OpenAI does. HuggingFace's chat-
completion API does not, so the dispatcher serves only the
no-tool-call path when bound to a HuggingFace service — the agent
still answers, but it can't dispatch tools. Default workspace seeds
ship one OpenAI `gpt-4o-mini` LLM service for this reason.

## HTTP surface

All routes are workspace-scoped, mounted under
`/api/v1/workspaces/{w}/agents`. Auth is enforced by the shared
workspace-route wrapper.

### Agents

| Method | Path | Notes |
|---|---|---|
| `GET` | `/agents` | List agents in the workspace, oldest-first. Paginated. |
| `POST` | `/agents` | Create a new agent. Body: `{ agentId?, name, description?, systemPrompt?, userPrompt?, llmServiceId?, knowledgeBaseIds?, ragEnabled?, ragMaxResults?, ragMinScore?, rerankEnabled?, rerankingServiceId?, rerankMaxResults? }`. 409 on duplicate explicit `agentId`. |
| `GET` | `/agents/{agentId}` | Get one agent. |
| `PATCH` | `/agents/{agentId}` | Patch any of the optional fields above (except `agentId`). `llmServiceId` accepts `null` to clear the binding. |
| `DELETE` | `/agents/{agentId}` | 204; cascades the agent's conversations and their messages. |

### Conversations (per-agent)

| Method | Path | Notes |
|---|---|---|
| `GET` | `/agents/{agentId}/conversations` | List the agent's conversations, newest-first. Paginated. |
| `POST` | `/agents/{agentId}/conversations` | Start a new conversation. Body: `{ conversationId?, title?, knowledgeBaseIds? }`. 404 if the agent doesn't exist. |
| `GET` | `/agents/{agentId}/conversations/{conversationId}` | Get one conversation. |
| `PATCH` | `/agents/{agentId}/conversations/{conversationId}` | Update title and / or `knowledgeBaseIds`. |
| `DELETE` | `/agents/{agentId}/conversations/{conversationId}` | 204; cascades messages. |

### Messages (per-conversation)

| Method | Path | Notes |
|---|---|---|
| `GET` | `/agents/{agentId}/conversations/{conversationId}/messages` | Oldest-first message log. Paginated. |
| `POST` | `/agents/{agentId}/conversations/{conversationId}/messages` | **Synchronous** send. Body: `{ content }`. Persists the user turn, retrieves grounding context, calls the agent's LLM (per the resolution order above), persists the assistant turn, returns `{ user, assistant }`. |
| `POST` | `/agents/{agentId}/conversations/{conversationId}/messages/stream` | **SSE** send. Same body. Emits `user-message`, then one `token` event per delta, then a terminal `done` (or `error`) carrying the persisted assistant row. |

`POST /messages` and `POST /messages/stream` return:

- **404** when the conversation does not belong to the named agent
  (or when the workspace, agent, or conversation does not exist).
- **422** `llm_provider_unsupported` when `agent.llmServiceId`
  points at an LLM service whose `provider` is not `huggingface`.
- **422** `llm_credential_missing` when the bound HuggingFace
  service has no `credentialRef`.
- **503** `chat_disabled` when the runtime has no global `chat:`
  block configured **and** the agent has no `llmServiceId` — there
  is no executor available.

The streaming wire format is identical to what the now-retired
`/chats/.../messages/stream` route emitted. Browser clients use
`fetch` with `Accept: text/event-stream` and parse the response
body manually (`EventSource` only supports `GET`). The runtime helper
the web UI uses lives at
[`apps/web/src/lib/chatStream.ts`](../apps/web/src/lib/chatStream.ts).

```text
event: user-message
data: {"workspaceId":"…","conversationId":"…","role":"user","content":"hi","messageId":"…","messageTs":"…","metadata":{}}

event: token
data: {"delta":"Hello"}

event: token
data: {"delta":" there"}

event: done
data: {"workspaceId":"…","conversationId":"…","role":"agent","content":"Hello there","messageId":"…","messageTs":"…","metadata":{"model":"…","finish_reason":"stop","context_document_ids":"…"}}
```

On model failure the terminal event is `error` with the same shape,
where `metadata.finish_reason === "error"` and the body carries the
human-readable failure.

## Cascade rules

- **Workspace delete** → agents → conversations → messages.
- **Agent delete** → that agent's conversations → their messages.
  Other agents in the workspace are untouched.
- **Conversation delete** → its messages.
- **KB delete** → strips the kb id from every conversation's
  `knowledgeBaseIds` set in the workspace. The agent-level
  `knowledgeBaseIds` is **not** stripped today; if this becomes a
  problem we'll extend the cascade.
- **LLM service delete** → refused with `409 conflict` while any
  agent still references the service via `llmServiceId`. Reassign
  or delete the dependent agents first.

## Testing

- **Route-level**:
  [`runtimes/typescript/tests/agents.test.ts`](../runtimes/typescript/tests/agents.test.ts)
  exercises the agent + conversation + message CRUD via `app.request`.
- **Store contract**:
  [`runtimes/typescript/tests/control-plane/contract.ts`](../runtimes/typescript/tests/control-plane/contract.ts)
  runs the agent surface against memory / file / astra so all three
  backends behave identically.

## Related docs

- [`api-spec.md`](api-spec.md) — high-level API surface narrative.
- [`workspaces.md`](workspaces.md) — workspace cascade semantics.
- [`architecture.md`](architecture.md) — runtime composition.
- [`configuration.md`](configuration.md) — `chat:` block (the
  runtime-wide default executor) and other deployment knobs.
