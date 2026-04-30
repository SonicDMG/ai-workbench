# Roadmap

AI Workbench is built in small, shippable phases. Each phase produces a
runnable artifact and a stable slice of the HTTP contract.

## Status snapshot

| Phase | Scope | Status |
|---|---|---|
| 0 | Runtime bootstrap + docs | ✅ Shipped |
| 1a | Control-plane CRUD (`/api/v1/workspaces`, `/catalogs`, `/vector-stores`) | ✅ Shipped (later refactored — see Phase KB) |
| 1b | Vector-store data plane (provisioning, upsert, search) | ✅ Shipped (later refactored — see Phase KB) |
| 2a | Document metadata CRUD (`/catalogs/{c}/documents`) | ✅ Shipped (later refactored — see Phase KB) |
| 2b | Ingest + catalog-scoped search + saved queries + cross-replica jobs + adopt + document chunks/delete cascade | ✅ Shipped (saved queries / adopt retired in Phase KB) |
| 2c | Server-side embedding (Astra `$vectorize`) for search + upsert | ✅ Shipped |
| 3 | Playground + UI | ✅ Shipped |
| Auth | Middleware, API keys, OIDC verifier, browser login, silent refresh | ✅ Shipped (1–3c); 4 (RBAC) planned |
| KB | Catalogs + vector-store descriptors → knowledge bases + chunking/embedding/reranking services | ✅ Shipped |
| Chat-1 | Workspace-level Chat with Bobbie page (UI scaffold) | ✅ Shipped |
| Chat-2 | Persistence — agentic tables wired through memory/file/astra | ✅ Shipped |
| Chat-3 | Chat + message CRUD routes, functional UI | ✅ Shipped |
| Chat-4 | HuggingFace chat completion + multi-KB RAG (sync) | ✅ Shipped |
| Chat-5 | SSE token streaming end-to-end | ✅ Shipped |
| MCP | Model Context Protocol façade — workspace as MCP tools | ✅ Shipped |
| Agents-1 | Agent + conversation CRUD over the agentic tables | ✅ Shipped |
| Agents-2 | Agent send + streaming pipeline (generalize chat-5 to any agent) + LLM-services CRUD + Bobbie retirement | ✅ Shipped |
| 7+ | Multi-provider LLM execution, MCP tool calls, polish | Planned (see "Next steps") |

## Phase 0 — Bootstrap ✅

Shipped with the initial runtime scaffold.

- `runtimes/typescript/src/root.ts` — Hono-based HTTP entry point.
- Config loader that reads `workbench.yaml`, interpolates env vars,
  validates the v1 schema.
- Operational endpoints: `GET /`, `/healthz`, `/readyz`, `/version`,
  `/docs`.
- Dockerfile producing a single image on port 8080.
- CI: lint, typecheck, unit tests, Docker build.

## Phase 1a — Control-plane CRUD ✅

Shipped across PRs #4, #5, #6, #7, #8.

- `ControlPlaneStore` interface with three backends: `memory`, `file`,
  `astra`.
- Full `/api/v1/*` CRUD for workspaces, catalogs, and vector-store
  descriptors.
- Astra backend talks to Data API **Tables** via
  [`@datastax/astra-db-ts`](https://github.com/datastax/astra-db-ts) —
  no wrapper libraries in between.
- `SecretResolver` with `env:` and `file:` providers.
- The multi-runtime "green box" model: default TypeScript runtime at
  `runtimes/typescript/`, alternative runtimes as siblings under
  `runtimes/`.
- Python runtime scaffold (FastAPI) under
  [`runtimes/python/`](../runtimes/python/).
- Cross-runtime conformance harness with committed fixtures.

## Phase 1b — Vector-store data plane ✅

Vectors are now first-class. Descriptors still manage metadata; the
actual data lives in a per-workspace backend (in-memory for `mock`,
Data API Collections for `astra`).

- `VectorStoreDriver` interface covering `createCollection`,
  `dropCollection`, `upsert`, `deleteRecord`, `search`.
- Two drivers registered today:
  - `MockVectorStoreDriver` — in-memory, cosine/dot/euclidean math
    built in, used by CI and workspaces with `kind: "mock"`.
  - `AstraVectorStoreDriver` — backed by Astra Data API Collections
    via `@datastax/astra-db-ts`. Per-workspace `DataAPIClient` cache.
- `POST /api/v1/workspaces/{w}/vector-stores` is transactional —
  descriptor row + collection, with rollback on provisioning failure.
- `DELETE` drops the collection then the descriptor.
- New routes:
  - `POST .../records` — batch upsert (1..500 per call)
  - `DELETE .../records/{id}` — single delete
  - `POST .../search` — vector + shallow-equal payload filter
- Shared driver contract suite runs against mock and against a fake
  Astra `Db` (faithful enough for cosine-ordering assertions). Real
  Astra integration — gated behind `ASTRA_DB_*` env vars — ships
  with Phase 2 when we have actual ingest flows to exercise it.
- Capability flags (lexical, rerank, hybrid) and Astra collection
  creation options (embedding service, source model) remain on the
  Phase 2+ shortlist.

## Phase 2a — Document metadata CRUD ✅

Shipped with the documents HTTP surface.

- `GET|POST /api/v1/workspaces/{w}/catalogs/{c}/documents` and
  `GET|PATCH|DELETE .../documents/{d}` on the canonical TypeScript
  runtime.
- Backed by the already-existing `ControlPlaneStore.*Document` methods
  across all three backends (memory, file, astra).
- Cross-catalog isolation enforced: a document registered under
  catalog A is invisible under catalog B in the same workspace
  (`404 document_not_found`).
- `DELETE /catalogs/{c}` cascade — already implemented in every
  backend — is now documented in
  [`api-spec.md`](api-spec.md).
- New conformance scenario `document-crud-basic`; fixture committed.
- The Python runtime still returns `501 NotImplemented` for documents
  and will close that gap separately (different owner).

## Phase 2b — Ingest, search, queries

**Goal:** end-to-end knowledge-base flow from raw file to searchable
result.

Shipped in this phase so far:

- **Embedding seam.** `Embedder` / `EmbedderFactory` landed in Phase 3
  for the Playground; reused verbatim by the ingest pipeline — no new
  contract needed.
- **Chunking seam.** `Chunker` contract at
  `runtimes/typescript/src/ingest/chunker.ts` plus a reference
  `RecursiveCharacterChunker` impl. Char-based, respects natural text
  boundaries (`\n\n`, `\n`, `. `, `? `, `! `, ` `), overlap-aware, with
  a shared contract suite (`tests/ingest/chunker-contract.ts`) that
  any future chunker must pass.
- `POST .../catalogs/{c}/documents/search` — catalog-scoped search
  that delegates to the catalog's bound vector store. Merges
  `catalogUid = catalog.workspaceId` into the filter so a search cannot
  escape its catalog. Covered by scenario
  `catalog-scoped-document-search`.
- **Hybrid + rerank lanes** on the search route. Driver contract
  extended with optional `searchHybrid` and `rerank` methods; mock
  driver implements both with a cheap tokenizer + min-max
  normalization. Request body gains `hybrid`, `lexicalWeight`, and
  `rerank` flags; descriptor-level `lexical.enabled` /
  `reranking.enabled` feed the defaults. Drivers that lack either
  method return 501 (`hybrid_not_supported` /
  `rerank_not_supported`).
- **Astra-native hybrid + rerank**. `searchHybrid` on the Astra
  driver uses `findAndRerank` (astra-db-ts's native hybrid API):
  vector + lexical + reranker combined in one call. Requires the
  descriptor to opt into both `lexical.enabled` and
  `reranking.enabled`; `createCollection` passes those options to
  the Data API so the collection is provisioned with a lexical
  index + reranker service. Standalone `rerank` stays unimplemented
  on Astra (astra-db-ts doesn't expose that primitive); callers set
  `hybrid: true` to get the combined path. `lexicalWeight` is a
  no-op on Astra — the reranker owns the blend.
- `POST .../catalogs/{c}/ingest` — **synchronous** end-to-end ingest.
  Chunks the input text, embeds each chunk (server-side via
  `$vectorize` when supported, otherwise client-side), upserts into
  the catalog's bound store, and creates a `Document` row with
  `status: ready`. Failures mark the row `failed` with
  `errorMessage` before re-raising. Chunk payloads carry
  `catalogUid`, `documentId`, `chunkIndex`, plus caller metadata.
  Covered by scenario `catalog-ingest-basic`.
- `POST .../catalogs/{c}/ingest?async=true` — same pipeline, returned
  to the caller as a 202 with a `job` pointer. Background worker
  updates the job record (`processed`, `total`, `status`,
  `errorMessage`) through a `JobStore`. `GET .../jobs/{jobId}`
  polls; `GET .../jobs/{jobId}/events` streams updates via SSE,
  closing on terminal states. In-flight jobs don't resume across
  restart (the pipeline's owning worker is gone); durable stores
  still keep the record around for the operator. Not in conformance
  (timing-dependent); covered by TypeScript runtime tests.
- **Durable `JobStore` backends.** File (`<root>/jobs.json`) and
  Astra (`wb_jobs_by_workspace`) impls auto-matched to
  `controlPlane.driver`. Memory stays the default for ephemeral runs.
  Shared contract suite (`tests/jobs/contract.ts`) runs the same
  assertions against each backend.
- **Cross-replica subscription fan-out.** The Astra job store polls
  subscribed records (default 500ms, tunable via
  `controlPlane.jobPollIntervalMs`) so an SSE client connected to
  replica B sees updates that landed on replica A. Same-replica
  updates still fire instantly through the in-process listener
  registry — the poller only catches the cross-replica case and
  is a no-op when no one is subscribed.
- **Lease + heartbeat on running jobs.** Workers stamp `leasedBy`
  + `leasedAt` when they pick a job up and refresh on every
  progress tick, so a stalled worker is detectable.
- **Orphan sweeper.** Off by default; clustered deployments opt in
  via `controlPlane.jobsResume`. When on, every replica scans for
  `running` jobs whose lease is older than `graceMs` and CAS-claims
  them.
- **Pipeline resume after orphan reclaim.** Async-ingest jobs
  persist an `IngestInputSnapshot` alongside the job record (the
  `ingest_input_json` column on `wb_jobs_by_workspace`). When the
  sweeper claims an orphan, it replays the original ingest through
  the shared `runIngestJob` worker — chunk IDs are deterministic
  (`${documentId}:${chunk.index}`) so the upsert is idempotent.
  Wasted embedding cost on the second pass, correct final state.
  Older jobs without a snapshot, and any future non-`ingest` kinds,
  fall back to the original mark-failed path.
- **Saved queries** — `/api/v1/workspaces/{w}/catalogs/{c}/queries`
  CRUD + `POST /{q}/run` that replays through the catalog-scoped
  search path. Text-only; the `/run` endpoint merges the catalog's
  UID into the filter unconditionally so saved queries cannot escape
  their catalog. New control-plane table
  (`wb_saved_queries_by_catalog` on astra); cascades on
  workspace/catalog delete. Covered by scenario
  `catalog-saved-queries`.
- **Adopt existing collections** —
  `GET /vector-stores/discoverable` + `POST /vector-stores/adopt`.
  Operators with collections that already exist in their Astra DB
  (created by another tool, by hand, or by an older workbench
  install whose state was wiped) can wrap them in a workbench
  descriptor without re-provisioning. The driver's
  `listAdoptable(workspace)` reads the live collection's vector /
  lexical / rerank options off the data plane; the adopt route
  stamps a descriptor mirroring them.
- **Document chunks listing + delete cascade** —
  `GET /catalogs/{c}/documents/{d}/chunks` returns the chunks under
  one document (id, chunkIndex, text, payload). The ingest pipeline
  stamps a reserved `chunkText` payload key so the text is always
  retrievable through the new endpoint, regardless of whether
  `$vectorize` was used. `DELETE /catalogs/{c}/documents/{d}` now
  cascades into the bound vector store via the new driver method
  `deleteRecords(ctx, filter)` so chunks no longer orphan when a
  document is removed.

Phase 2b is closed.

Workspace-scoped API keys moved into their own dedicated auth
track — see [`auth.md`](auth.md) for the phased rollout.

## Phase 2c — Server-side embedding (Astra vectorize) ✅

Astra Data API collections created under this runtime opt into
server-side embedding when the descriptor's `embedding` names a
supported provider (`openai`, `azureOpenAI`, `cohere`, `jinaAI`,
`mistral`, `nvidia`, `voyageAI`). The driver:

- Passes `vector.service: { provider, modelName }` at
  `createCollection`.
- Routes `search(text)` via `find(sort: { $vectorize: text })` in
  `searchByText`.
- Routes `upsert([{text}])` via `insertMany({ $vectorize, ... })` in
  `upsertByText`.
- Attaches the resolved embedding API key as
  `x-embedding-api-key` per request (header auth, not Astra KMS).

Legacy collections without a `service` block raise
`COLLECTION_VECTORIZE_NOT_CONFIGURED`; the driver catches and
rethrows as `NotSupportedError`, after which the route layer falls
back to client-side embedding via LangChain JS. No migration
required on existing data. See [`docs/playground.md`](playground.md)
for the dispatch model.

## Phase 3 — Playground & UI ✅

Browser UI for exploring workspaces, managing their vector stores,
and running searches against them.

Shipped:

- **`/`** — workspace list + onboarding wizard.
- **`/workspaces/{workspaceId}`** — detail, test-connection, vector-store
  CRUD panel, API-key issue/revoke panel.
- **`/playground`** — ad-hoc vector + text queries with expandable
  results. See [`docs/playground.md`](playground.md).
- Playground API: text queries via an extension of the existing
  `POST .../search` route (accepts either `{ vector }` or `{ text }`
  — no new endpoint). Upsert followed the same pattern for text
  records.
- UI consumes the existing `/api/v1/*` surface — no special admin
  API.
- UI + default TS runtime ship as one Docker image — the image
  builds `apps/web` in a first stage and serves it out of
  `/app/public`. See
  [`runtimes/typescript/Dockerfile`](../runtimes/typescript/Dockerfile)
  and [`docs/configuration.md`](configuration.md)'s `runtime.uiDir`.

Subsequently shipped under Phase 2b (and surfaced through the
workspace UI rather than the playground itself):

- Ingest UI — file upload + paste-text dialog under
  Workspace → Catalogs, sync and async (SSE-streamed progress).
- Catalog/document browsing — Catalogs panel with per-catalog
  document list on the workspace detail page.
- Saved queries — catalog-scoped CRUD + run, with a panel under
  the workspace UI. The playground itself remains a stateless
  scratchpad by design.

## Phase KB — Knowledge bases & execution services ✅

Refactored the catalog / vector-store / saved-query model into a
single first-class concept: the **knowledge base**. A KB owns its
Astra collection end-to-end and binds the chunking + embedding +
(optional) reranking services that produce its content.

Shipped:

- **Knowledge bases.** New `wb_config_knowledge_bases_by_workspace`
  table. KB create transactionally provisions the underlying
  `wb_vectors_<kb_id>` collection through the workspace's driver,
  using the bound embedding service to determine vector dimensions
  and similarity. KB delete drops the collection and cascades RAG
  documents.
- **Execution services.** Three new tables —
  `wb_config_chunking_service_by_workspace`,
  `wb_config_embedding_service_by_workspace`,
  `wb_config_reranking_service_by_workspace`. Multiple KBs may
  share a service definition; deleting an in-use embedding /
  chunking service is blocked with `409 conflict`.
- **Service immutability for vector-determining bindings.** A KB's
  `embeddingServiceId` and `chunkingServiceId` are pinned at create
  time (the collection's dimensions follow the embedding service);
  `rerankingServiceId` stays mutable.
- **`resolveKb` synthesis layer.** Existing driver / dispatch /
  ingest code keeps a vector-store-shaped descriptor view by
  resolving a KB + its bound services on demand, so the data-plane
  surface stayed stable across the refactor.
- **Routes.** All catalog / vector-store / saved-query routes
  retired in favor of:
  - `/api/v1/workspaces/{w}/{chunking,embedding,reranking}-services`
  - `/api/v1/workspaces/{w}/knowledge-bases[/{kb}]`
  - `.../knowledge-bases/{kb}/{records,search,documents,ingest}`
- **UI.** Catalogs panel + vector-stores panel removed; replaced
  with `KnowledgeBasesPanel` and `ServicesPanel`. Playground now
  picks a KB rather than a vector-store descriptor.

Saved queries and the adopt-existing-collection flow were retired
in this phase — the new shape doesn't need them, and re-adding
either would land cleaner under the new model than as a port.

## Chat phases ✅ — retired in favor of the agent surface

The `/chats` route surface (Chat-1 through Chat-5) shipped first as
a singleton-Bobbie HTTP layer over the agentic tables. With
Agents-2 the chat send + streaming pipeline was generalised to any
user-defined agent and the `/chats` route was deleted; the chat UI
now talks directly to the agent endpoints. Existing data on the
agentic tables (originally written under the Bobbie row) is
untouched and continues to work as ordinary agent records. See
[`agents.md`](agents.md) for the current shape.

The historical phase breakdown is preserved below for context — it
maps directly onto the agent surface today.

- **Chat-1.** Workspace-level chat page scaffold with placeholder
  UI; route + navigation entry from the workspace detail page.
- **Chat-2.** Persistence layer. Stage-2 agentic tables
  (`wb_agentic_agents_by_workspace`,
  `wb_agentic_conversations_by_agent`,
  `wb_agentic_messages_by_conversation`) wired through all three
  control-plane backends. Cascade behavior covers workspace delete,
  KB delete (kb-id stripped from any conversation's
  `knowledge_base_ids` set), and conversation delete.
- **Chat-3.** CRUD HTTP surface plus a functional ChatPage with
  sidebar conversation list, composer, and URL-driven conversation
  selection.
- **Chat-4.** HuggingFace integration. New `chat/` module with
  `ChatService`, `HuggingFaceChatService` (over
  `@huggingface/inference`'s `chatCompletion`), prompt-assembly,
  and multi-KB retrieval. Optional `chat:` block in
  `workbench.yaml`; without it (and without an agent-bound LLM
  service), agent send returns `503 chat_disabled`.
- **Chat-5.** SSE token streaming. The stream emits `user-message`,
  then one `token` event per delta, then a terminal `done`/`error`
  event carrying the persisted assistant row. The browser uses
  fetch streaming (not `EventSource`) since the request is `POST`
  with a JSON body. Cancel button wires the `AbortSignal` through
  to the HF stream so the runtime stops paying for tokens nobody
  will see.

## MCP phase ✅ — Model Context Protocol façade

Workspace-scoped MCP server mounted at
`/api/v1/workspaces/{w}/mcp`. See [`mcp.md`](mcp.md) for the
walkthrough.

- **Streamable HTTP transport** (modern MCP). Stateless: each
  request constructs a fresh server, no session-id tracking.
- **Tools** (read-mostly):
  `list_knowledge_bases`, `list_documents`, `search_kb`
  (vector / hybrid / rerank), `list_chats`, `list_chat_messages`.
  Plus `chat_send` (opt-in via `mcp.exposeChat: true`) which routes
  through the runtime's global chat service.
- **Auth.** Reuses `assertWorkspaceAccess`, so a scoped workspace
  API key for workspace A cannot call MCP tools on workspace B.
- **Off by default.** `mcp.enabled: true` opts in.

Tools deliberately don't include write operations
(`ingest`, KB CRUD, workspace CRUD) yet — see "Next steps" for
when to add them.

Followups deferred:
- **stdio transport** (`npx ai-workbench-mcp`) for local Claude /
  IDE integrations that don't want to round-trip through HTTP.
- **Per-tool auth scopes** so write tools can be enabled
  per-API-key.
- **MCP resources** (vs tools) — currently every read is a tool
  call. Some clients prefer resources for read-only data.

## Next steps (not yet started)

The phases below are sequenced loosely; each is independently
shippable so reordering doesn't burn earlier work.

### User-defined agents (Agents-1 ✅, Agents-2 ✅)

Agents-1 shipped the CRUD surface — agent + conversation
primitives, with the chat surface still talking to its own
deterministic singleton row. Agents-2 generalised the chat-5 send +
streaming pipeline to any agent, wired
`wb_config_llm_service_by_workspace` end-to-end as
`/api/v1/workspaces/{w}/llm-services` (workspace-scoped CRUD), and
retired the `/chats` route + Bobbie singleton entirely. See
[`agents.md`](agents.md) for the current shape, including the
`agent.llmServiceId` resolution order.

Remaining open work in this area:

- **Multi-provider chat**. Today only `provider: "huggingface"` is
  wired in the chat-service factory; LLM services with other
  providers (OpenAI, Cohere, Anthropic, …) can be created and
  stored, but agent send returns `422 llm_provider_unsupported`
  until the dispatcher grows a case for them. The `ChatService`
  abstraction is already provider-agnostic; this is mechanical.
- **Tool execution via MCP**. Now that the MCP server façade is in,
  the inverse — letting an agent **call** MCP tools — is the same
  SDK, just on the client side. Lands alongside
  `wb_config_mcp_tools_by_workspace` CRUD.

### Per-KB / per-agent rate limiting

Chat costs HF tokens; today the runtime relies on the global
`/api/v1/*` IP-based limiter. Per-workspace and per-chat token
buckets would let operators bound spend without blocking other
endpoints.

### Markdown rendering + citation linkbacks ✅

Shipped. The assistant bubble renders sanitized GitHub-flavored
markdown via `react-markdown` + `remark-gfm` + `rehype-sanitize`.
Inline `[chunkId]` citations rewrite into deep links that auto-open
the cited document's detail dialog in the KB explorer and scroll the
matching chunk into view. The runtime persists the chunk → (KB,
document) map on each assistant turn at `metadata.context_chunks`
(JSON-encoded compact tuples), so the UI doesn't need a follow-up
fetch.

### Multi-provider chat backends

`ChatService` is provider-agnostic. Adding an `OpenAIChatService`
and a `CohereChatService` is mostly mechanical — the prompt
assembler and route are unchanged. Worth doing once we have a
reason to compare quality / latency / cost across providers.

### Production-grade chat persistence

The agentic tables are write-heavy under streaming load (one row
per assistant turn, plus the user turn before it). Astra handles
that fine, but the file backend writes the whole `messages.json`
on every append. Worth either:

- A per-chat append-only log file, or
- A SQLite-backed `file` driver variant for chat-heavy
  deployments.

### Conformance for the chat surface

Every other route surface has a cross-runtime conformance fixture.
Chat doesn't yet — partly because the streaming SSE shape is
trickier to fixture, partly because there's no Python runtime
implementation yet. Add a fixture set covering the CRUD surface
(easy) and the SSE happy path with a deterministic fake provider
(less easy but worth it before a second runtime).

## Cross-cutting workstreams

These run continuously rather than as discrete phases:

- **Observability.** Structured logs with `workspaceId`, request
  IDs, and OpenTelemetry traces. Logs today; OTel in Phase 2+.
- **Conformance.** Every route added lands with a scenario and
  regenerated fixtures. Every language runtime updates in the same
  PR. Enforced by the drift-guard test.
- **Docs.** Every route addition updates
  [`api-spec.md`](api-spec.md) in the same PR. The generated
  OpenAPI at `/api/v1/openapi.json` is always in sync with the
  running runtime.
- **Polyglot runtimes.** Each language green box that gets taken out
  of scaffold status adds a row to the "current runtimes" table in
  [`green-boxes.md`](green-boxes.md).

## Open questions

Things we have deliberately not decided and should revisit before the
corresponding phase:

- **Multi-tenant auth model.** Is a workspace the tenant, or is
  there a tenant-above-workspace concept for SaaS deployments?
- **Secrets backends.** `env` and `file` providers are fine for
  single-node self-hosted. Hosted deployments likely want pluggable
  providers (Vault, AWS Secrets Manager, etc.). `SecretProvider`
  already supports this.
- **Chunker/embedder plugin model.** In-process only, external HTTP
  contract, or both?
- **Hot reload.** Worth the complexity, or is restart-on-change
  sufficient? (Leaning restart-only — the blast radius of config
  changes is small now that workspaces are runtime data.)
- **Schema version 2.** What changes are we queueing that would
  force a bump, and how do we stage it?
