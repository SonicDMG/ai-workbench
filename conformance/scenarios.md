# Conformance Scenarios

Each scenario is a numbered list of HTTP requests against a running
green box's `/api/v1/*` surface. Every language-native runtime MUST be
able to execute all scenarios and produce responses that match (after
[normalization](./normalize.mjs)) the fixture at
`fixtures/<scenario-slug>.json`.

## Conventions

- Requests are written as `METHOD /path` with a JSON body where
  relevant. Every runtime's test harness issues them in order.
- Scenarios are ordered. Later steps may reference values from earlier
  responses via `$N.field` (1-indexed to step number) — e.g. `$1.workspaceId`
  means "the `workspaceId` from step 1's response body".
- Conformance runs with auth disabled. Auth-specific behavior is pinned
  by runtime tests; portable API-key lifecycle response shapes are
  still included here.
- The canonical TypeScript harness uses an in-memory control plane and
  the mock vector-store driver so fixtures stay deterministic.

---

## Scenario 1 — `workspace-crud-basic`

Minimum viable workspace lifecycle.

1. `POST /api/v1/workspaces` — body `{"name": "prod", "kind": "astra"}`
2. `GET  /api/v1/workspaces`
3. `GET  /api/v1/workspaces/$1.workspaceId`
4. `PATCH  /api/v1/workspaces/$1.workspaceId` — body `{"name": "production"}`
5. `DELETE /api/v1/workspaces/$1.workspaceId`

Fixture: `fixtures/workspace-crud-basic.json`.

---

## Scenario 2 — `workspace-kind-is-immutable`

A workspace's `kind` cannot change after creation. Every runtime MUST
reject a `PATCH` body containing `kind` with `400 validation_error`.

Fixture: `fixtures/workspace-kind-is-immutable.json`.

---

## Scenario 3 — `workspace-credentials-must-be-secret-ref`

Raw credential values are rejected with `400 validation_error` before
they can reach the `SecretResolver`.

Fixture: `fixtures/workspace-credentials-must-be-secret-ref.json`.

---

## Scenario 4 — `workspace-test-connection-mock`

`POST /workspaces/{workspaceId}/test-connection` on a mock workspace always
reports `ok: true` with the portable response shape.

Fixture: `fixtures/workspace-test-connection-mock.json`.

---

## Scenario 5 — `workspace-api-key-lifecycle`

Full workspace API-key lifecycle: issue, list, revoke, list. The
plaintext is returned exactly once; list responses expose metadata
without the stored hash.

Fixture: `fixtures/workspace-api-key-lifecycle.json`.

---

## Scenario 6 — `knowledge-base-crud-basic`

Knowledge-base CRUD lifecycle. Workspace POST auto-seeds the default
chunking + embedding services; the KB binds to one of each by id, then
we round-trip through GET / list / PATCH / DELETE.

Fixture: `fixtures/knowledge-base-crud-basic.json`.

---

## Scenario 7 — `kb-document-crud-basic`

Document CRUD on a knowledge base WITHOUT triggering ingest. Pins the
wire shape of the document record (status, sourceFilename, metadata,
chunkCount). Ingest-with-chunking is excluded from conformance because
chunk counts depend on the chunker's tokenization, which is allowed to
vary across runtimes.

Fixture: `fixtures/kb-document-crud-basic.json`.

---

## Scenario 8 — `kb-search-empty`

Search on an empty knowledge base returns an empty results array with
the canonical envelope. This pins the response shape every runtime
must emit when no documents have been ingested. Search-with-results
scenarios are excluded because they depend on embedder/chunker
behavior that's allowed to vary; conformance only pins the wire shape
on the empty-result path.

Fixture: `fixtures/kb-search-empty.json`.

---

## Scenario 9 — `agent-crud-basic`

Agent + conversation CRUD lifecycle WITHOUT triggering chat sends.
Workspace POST auto-seeds the default LLM service; we bind an agent to
it, open a conversation, and tear down. Sending messages is excluded
from conformance because chat completion depends on the upstream LLM
API that's not part of the runtime contract.

Fixture: `fixtures/agent-crud-basic.json`.

---

## Scenario 10 — `chunking-service-crud-lifecycle`

Workspace-scoped chunking service CRUD: create explicit (independent
of the default seed), GET, PATCH, DELETE, GET-after-delete (404 with
`chunking_service_not_found`). Pins the chunking-service record wire
shape and the per-aggregate `chunkingServiceId` identity column.

Fixture: `fixtures/chunking-service-crud-lifecycle.json`.

---

## Scenario 11 — `embedding-service-crud-lifecycle`

Workspace-scoped embedding service CRUD with the `mock` provider so
every runtime can exercise the path without real embedding
credentials. Pins `provider`, `modelName`, `embeddingDimension`, and
`distanceMetric`.

Fixture: `fixtures/embedding-service-crud-lifecycle.json`.

---

## Scenario 12 — `knowledge-filter-crud-lifecycle`

Knowledge-filter CRUD on a freshly-created KB. Filters are
opaque `Record<string, unknown>` predicates the search route applies
at query time; the conformance pin is that the predicate is preserved
verbatim across create / get / patch / delete.

Fixture: `fixtures/knowledge-filter-crud-lifecycle.json`.

---

## Scenario 13 — `agent-error-envelopes`

Pins canonical error envelopes on the agent surface:

- Caller-supplied `agentId` honored on first POST.
- Same `agentId` re-POST → `409 conflict`.
- GET unknown `agentId` → `404 agent_not_found`.
- PATCH with an empty body is a no-op and returns `200` with the
  unchanged record. Pinning this matters: it documents that empty-
  patch validation is NOT gated, so cross-runtime parity doesn't
  drift on the easy case.

Every error envelope must be `{ error: { code, message, requestId } }`.

Fixture: `fixtures/agent-error-envelopes.json`.

---

## Scenario 14 — `chat-message-sync`

Synchronous `POST /agents/{a}/conversations/{c}/messages` happy path.
The agent is created without an `llmServiceId`, so dispatch falls
through to the runtime's global chat service — which the conformance
harness injects as a deterministic `FixtureChatService` driven by the
scenario's `chatScript`. Pins the user + assistant message wire shape,
including persisted `tokenCount` and `finish_reason`.

> **`chatScript` is conformance-only.** It is NOT part of the public
> API surface; it tells the harness how to script the fixture chat
> provider so the chat reply is deterministic without standing up a
> live LLM. A runtime that can't inject a fixture chat service may
> stub these scenarios — the wire contract is the request/response
> shape, not the reply text.

Fixture: `fixtures/chat-message-sync.json`.

---

## Scenario 15 — `chat-message-stream`

Server-sent-events happy path for
`POST /agents/{a}/conversations/{c}/messages/stream`. The fixture chat
service emits the scripted token stream; the harness parses the SSE
body into a deterministic array of `{event, data}` records via
[`runner.parseSseBody`](./runner.mjs) so the capture is stable across
runs. Pins the terminal-`done` happy path:
`user-message` → `token`* → `done`.

Fixture: `fixtures/chat-message-stream.json`.

---

## Scenario 16 — `chat-message-crud-basic`

End-to-end agentic chat CRUD against the fixture chat provider: create
an agent, open a conversation, **list** + **GET** that conversation,
send one **synchronous** message, then **list** the persisted turns.
Pins the conversation list/get envelope AND the user + assistant
message wire shape in one round-trip — the slice
`agent-crud-basic` deliberately omits (it never sends) and
`chat-message-sync` omits (it never lists/gets the conversation).

Fixture: `fixtures/chat-message-crud-basic.json`.

---

## Scenario 17 — `chat-sse-tool-call`

Server-sent-events **tool-call** happy path for the streaming send. A
multi-turn `chatScript` drives the dispatcher's tool-call loop
deterministically: turn 1 emits a `list_kbs` tool call (a built-in
tool that needs no external dependency and returns a fixed string on
an empty workspace), turn 2 emits the final answer. Pins the full
intermediate-iteration SSE shape:
`user-message` → `token-reset` → `tool-call` → `tool-result` →
`token`* → terminal `done`. The closing `GET /messages` confirms the
user-facing transcript is just the user turn + final assistant row —
the tool-call / tool-result scaffolding rows are persisted but
filtered from the message list.

Fixture: `fixtures/chat-sse-tool-call.json`.

---

## Scenario 18 — `rlac-principals-lifecycle`

RLAC principal CRUD. Create a principal with attributes, list, `GET` it,
`PATCH` its role + label, reject a duplicate `principalId` with `409
conflict`, `DELETE` it (`204`), and confirm the list is empty afterward.
Pins the principals-registry contract — request/response shapes, the
`viewer` role default, and the duplicate / `204` status codes — that
every runtime must reproduce.

Fixture: `fixtures/rlac-principals-lifecycle.json`.

---

## Scenario 19 — `rlac-policy-compile-preview`

RLAC policy compile-preview. The canonical visibility DSL
(`current_principal_id() = ANY(visible_to) OR '*' = ANY(visible_to)`)
compiles, for principal `alice`, to the Data API filter
`{ "$or": [{ "visible_to": "alice" }, { "visible_to": "*" }] }` with
`ok: true` — pinning the policy compiler's output shape across runtimes.
An unparseable DSL returns `ok: false` with a `parseError` and a null
`compiledFilter`. Neither call persists anything.

Fixture: `fixtures/rlac-policy-compile-preview.json`.

---

## Scenario 20 — `api-key-fine-scopes-roundtrip`

Fine-grained API-key scopes (0.5.0). A key minted with a mix of coarse
and fine scopes (`tools:invoke`, `read`, `write:ingest`, supplied
unordered) echoes the normalized set — canonical `ALL_API_KEY_SCOPES`
order, `["read", "write:ingest", "tools:invoke"]` — on the create
response and again on the list. Pins the fine-scope mint/round-trip
contract across runtimes; enforcement (a scoped key reaching only its
own routes) is covered by the runtime unit/integration suites, since the
conformance harness has no per-step auth-header seam yet (see #326).

Fixture: `fixtures/api-key-fine-scopes-roundtrip.json`.

---

## Scenario 21 — `api-key-scope-normalization`

Scope normalization on mint. An unordered set with a duplicate
(`["manage:access", "read", "write:kb", "read"]`) is canonicalized to
`ALL_API_KEY_SCOPES` order with duplicates removed
(`["read", "write:kb", "manage:access"]`), so equivalent scope sets
persist identically across runtimes.

Fixture: `fixtures/api-key-scope-normalization.json`.

---

## Scenario 22 — `agent-toolid-rejects-unresolved-mcp`

Save-time `toolId` validation (Feature ③ MCP P1). Creating an agent with
a namespaced `mcp:{serverId}:{tool}` id that doesn't resolve to a
registered + enabled server in this workspace returns `422
agent_tool_unresolved`. Bare built-in names and empty `toolIds` are
unaffected (see `agent-crud-basic`).

Fixture: `fixtures/agent-toolid-rejects-unresolved-mcp.json`.

---

## Scenario 23 — `mcp-server-crud-lifecycle`

External MCP server registry CRUD (Feature ③). A raw `credentialRef` is
rejected (`400 validation_error`) before it reaches the SecretResolver —
only a `scheme:name` SecretRef (`env:MCP_TOKEN`) is accepted. Then create,
list, get, patch (pause + rename), delete (`204`), and confirm the list is
empty. Pins the mcp-servers registry contract + SecretRef enforcement,
mirroring `workspace-credentials-must-be-secret-ref`.

Fixture: `fixtures/mcp-server-crud-lifecycle.json`.

---

## Scenario 24 — `available-tools-catalog`

The agent-form tool catalog wire shape (Feature ③ P4). `GET
/available-tools` on a mock workspace returns the built-in tool pool —
each item carries `id`, `description`, `source`, and the JSON-Schema
`inputSchema`. Pins the `AvailableTool` envelope (incl. the 0.5.0
`serverId` / `serverLabel` / `inputSchema` fields) cross-runtime; live
remote-MCP tool enumeration needs a reachable server and stays in the
runtime unit / integration tests.

Fixture: `fixtures/available-tools-catalog.json`.
