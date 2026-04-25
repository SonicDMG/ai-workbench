# Roadmap

AI Workbench is built in small, shippable phases. Each phase produces a
runnable artifact and a stable slice of the HTTP contract.

## Status snapshot

| Phase | Scope | Status |
|---|---|---|
| 0 | Runtime bootstrap + docs | ✅ Shipped |
| 1a | Control-plane CRUD (`/api/v1/workspaces`, `/catalogs`, `/vector-stores`) | ✅ Shipped |
| 1b | Vector-store data plane (provisioning, upsert, search) | ✅ Shipped |
| 2a | Document metadata CRUD (`/catalogs/{c}/documents`) | ✅ Shipped |
| 2b | Ingest + catalog-scoped search + saved queries | In progress — search, sync+async ingest, jobs/SSE shipped ingest, saved queries shipped |
| 2c | Server-side embedding (Astra `$vectorize`) for search + upsert | ✅ Shipped |
| 3 | Playground + UI | ✅ Shipped |
| Auth | Middleware, API keys, OIDC verifier, browser login | ✅ Shipped (1–3b); 3c (silent refresh) + 4 (RBAC) planned |
| 4+ | Chats, MCP | Reserved |

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
  `GET|PUT|DELETE .../documents/{d}` on the canonical TypeScript
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
  `catalogUid = catalog.uid` into the filter so a search cannot
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
  `catalogUid`, `documentUid`, `chunkIndex`, plus caller metadata.
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
  Shared contract suite (`tests/jobs/contract.ts`) runs the same 8
  assertions against each backend. In-process pub/sub for SSE
  subscribers; cross-replica fan-out remains future work.
- **Saved queries** — `/api/v1/workspaces/{w}/catalogs/{c}/queries`
  CRUD + `POST /{q}/run` that replays through the catalog-scoped
  search path. Text-only; the `/run` endpoint merges the catalog's
  UID into the filter unconditionally so saved queries cannot escape
  their catalog. New control-plane table
  (`wb_saved_queries_by_catalog` on astra); cascades on
  workspace/catalog delete. Covered by scenario
  `catalog-saved-queries`.

Planned for the rest of 2b:

- Cross-replica job pub/sub + in-flight resume after restart (today
  the record survives restart but the owning worker doesn't).

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
back to client-side embedding via the Vercel AI SDK. No migration
required on existing data. See [`docs/playground.md`](playground.md)
for the dispatch model.

## Phase 3 — Playground & UI ✅

Browser UI for exploring workspaces, managing their vector stores,
and running searches against them.

Shipped:

- **`/`** — workspace list + onboarding wizard.
- **`/workspaces/{uid}`** — detail, test-connection, vector-store
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

## Phase 4+ — Chats, MCP

Reserved for integrating:

- A chat harness that runs against a workspace's catalogs.
- An MCP server view of the workspace for external agents.

Contracts will be defined as those phases approach.

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
