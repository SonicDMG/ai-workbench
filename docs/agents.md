# User-defined agents

The chat-with-Bobbie surface is the workspace's first **agent** — a
named persona with a system prompt, a default RAG configuration, and
a stable identity in the Stage-2 agentic tables. The agents API lets
you define **more** agents per workspace and run conversations
against any of them.

This page documents the agents surface. The chat-with-Bobbie surface
([`chat.md`](chat.md)) stays as a thin alias — Bobbie is just an
agent with a deterministic id and a built-in persona that the
runtime auto-creates on first use.

## Concepts

| Term | What it is |
|---|---|
| **Agent** | A row in `wb_agentic_agents_by_workspace`. Carries name, system / user prompts, RAG defaults (`ragEnabled`, `ragMaxResults`, `ragMinScore`, `knowledgeBaseIds`), and reranker overrides. Bobbie is the singleton agent the chat surface auto-provisions; user-defined agents coexist in the same table with random UUIDs. |
| **Conversation** | A row in `wb_agentic_conversations_by_agent`. One conversation belongs to exactly one (workspace, agent) pair. Carries `title` and a per-conversation `knowledgeBaseIds` filter that overrides the agent's default at retrieval time. |
| **Message** | A row in `wb_agentic_messages_by_conversation`. Same shape across all agents — `role ∈ {user, agent, system, tool}`, `metadata` carries RAG provenance / model id / finish reason. |

The Bobbie chat at `/chats` is a thin wrapper over these primitives:

- `listChats(ws)` ≡ `listConversations(ws, bobbieAgentId(ws))`
- `createChat(ws, ...)` calls `ensureBobbieAgent` then
  `createConversation(...)`.

User-defined agents share the same primitives. When you delete an
agent the cascade goes agent → its conversations → their messages.
Deleting Bobbie is allowed; the next `/chats` send (or any
`ensureBobbieAgent` call) recreates it from the deterministic id.

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

## HTTP surface

All routes are workspace-scoped, mounted under
`/api/v1/workspaces/{w}/agents`. Auth is enforced via
`assertWorkspaceAccess`.

### Agents

| Method | Path | Notes |
|---|---|---|
| `GET` | `/agents` | List agents in the workspace, oldest-first. Paginated. Includes Bobbie (if she has been ensured). |
| `POST` | `/agents` | Create a new agent. Body: `{ agentId?, name, description?, systemPrompt?, userPrompt?, knowledgeBaseIds?, ragEnabled?, ragMaxResults?, ragMinScore?, rerankEnabled?, rerankingServiceId?, rerankMaxResults? }`. 409 on duplicate explicit `agentId`. |
| `GET` | `/agents/{agentId}` | Get one agent. |
| `PATCH` | `/agents/{agentId}` | Patch any of the optional fields above (except `agentId`). |
| `DELETE` | `/agents/{agentId}` | 204; cascades the agent's conversations and their messages. |

### Conversations (per-agent)

| Method | Path | Notes |
|---|---|---|
| `GET` | `/agents/{agentId}/conversations` | List the agent's conversations, newest-first. Paginated. |
| `POST` | `/agents/{agentId}/conversations` | Start a new conversation. Body: `{ conversationId?, title?, knowledgeBaseIds? }`. 404 if the agent doesn't exist. |
| `GET` | `/agents/{agentId}/conversations/{conversationId}` | Get one conversation. |
| `PATCH` | `/agents/{agentId}/conversations/{conversationId}` | Update title and / or `knowledgeBaseIds`. |
| `DELETE` | `/agents/{agentId}/conversations/{conversationId}` | 204; cascades messages. |

### Why no `/messages` here yet

The Bobbie chat surface owns the streaming + retrieval pipeline at
`/chats/{chatId}/messages` (sync) and
`/chats/{chatId}/messages/stream` (SSE). User-defined agents will get
the same pipeline in a follow-up PR — at that point the chat send
path is generalised to take `(agentId, agent)` and the same handler
backs both surfaces. Until then, user-defined agents support full
CRUD over the conversation log (you can drive them programmatically
from `appendChatMessage` at the store layer, but not from the HTTP
API yet).

## Cascade rules

- **Workspace delete** → agents → conversations → messages.
- **Agent delete** → that agent's conversations → their messages.
  Other agents in the workspace are untouched.
- **Conversation delete** → its messages.
- **KB delete** → strips the kb id from every conversation's
  `knowledgeBaseIds` set in the workspace (same sweep as for chats).
  The agent-level `knowledgeBaseIds` is **not** stripped today; if
  this becomes a problem we'll extend the cascade.

## Relationship to the chat surface

```
          ┌───────────── /chats route ─────────────┐
          │  thin alias: bobbieAgentId(ws) supplied │
          │  automatically; ensureBobbieAgent on    │
          │  first send                             │
          └─────────────────┬───────────────────────┘
                            │
                ┌───────────▼───────────┐
                │   ControlPlaneStore    │
                │   agent + conversation │
                │   + message methods    │
                └───────────┬────────────┘
                            │
            ┌───────────────┼───────────────┐
            │               │               │
       agents          conversations     messages
       (Bobbie +       (agent-scoped,    (conversation-
        user-           per-agent)        scoped)
        defined)
```

Both surfaces hit the same tables. The chat routes hide `agentId`
from the wire (callers don't pick the agent — the runtime does); the
agents routes surface it because callers explicitly drove the choice.

## Testing

- **Route-level**:
  [`runtimes/typescript/tests/agents.test.ts`](../runtimes/typescript/tests/agents.test.ts)
  exercises the agent + conversation CRUD via `app.request`.
- **Store contract**:
  [`runtimes/typescript/tests/control-plane/contract.ts`](../runtimes/typescript/tests/control-plane/contract.ts)
  runs the agent surface against memory / file / astra so all three
  backends behave identically.

## Related docs

- [`chat.md`](chat.md) — Bobbie chat (the singleton-agent alias).
- [`api-spec.md`](api-spec.md) — high-level API surface narrative.
- [`workspaces.md`](workspaces.md) — workspace cascade semantics.
- [`architecture.md`](architecture.md) — runtime composition.
