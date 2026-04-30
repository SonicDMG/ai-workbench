# Architecture

AI Workbench is a polyglot HTTP runtime sitting in front of Astra DB.
It exposes a stable `/api/v1/*` contract for workspaces, knowledge
bases, execution services (chunking / embedding / reranking),
documents, ingestion, and search. Each **language-native
implementation of the runtime** is a "green box"; the default
TypeScript green box is embedded with the UI, and alternatives live
under [`runtimes/`](../runtimes/README.md).

## Design principles

1. **One HTTP contract, N runtimes.** Workspaces, knowledge bases,
   execution services, and RAG documents are defined by the HTTP API
   — not by any one runtime's internals. Every language green box
   honors the same contract, enforced by
   [fixture-based conformance tests](./conformance.md).
2. **Thin, boring runtime core.** The runtime is an HTTP server + a
   pluggable control-plane store. Complexity lives in pluggable
   services bound to a knowledge base (chunking, embedding,
   reranking).
3. **Workspaces are runtime data, not config.** `workbench.yaml`
   picks which control-plane backend to use; workspaces themselves
   are mutable records managed via the HTTP API.
4. **A KB owns its collection end-to-end.** Creating a knowledge
   base auto-provisions the underlying Astra collection
   (`wb_vectors_<kb_id>`), sized to the bound embedding service's
   dimension; deleting the KB drops the collection. The control
   plane and data plane never diverge.
5. **Driver-based control plane.** `memory` for CI and demos, `file`
   for single-node self-hosted, `astra` for production. Same
   contract.
6. **Astra-native where real.** The `astra` backend uses
   [`@datastax/astra-db-ts`](https://github.com/datastax/astra-db-ts)
   directly. The Python runtime uses
   [`astrapy`](https://github.com/datastax/astrapy). No wrapper
   libraries in between.
7. **Secrets by reference.** Credentials live behind
   `SecretRef` pointers (`env:FOO` / `file:/path`) resolved at use
   time by a pluggable provider. No raw secrets in config, records,
   or logs.
8. **Immutable records.** Every update returns a new object. The
   in-memory backend holds `Map<workspaceId, Record>`; the file backend
   rewrites atomically; the astra backend does `$set` updates
   through the Data API.
9. **Contract-first for new surfaces.** The HTTP API is versioned
   (`/api/v1/…`) and documented in [`api-spec.md`](api-spec.md) and
   the generated OpenAPI at `/api/v1/openapi.json`.

## The "green box" model

The architecture is one green box per language-native runtime.
Every green box:

- Serves the same `/api/v1/*` surface.
- Speaks Astra via its own language-native SDK internally.
- Runs as a standalone HTTP server (a Docker container in production).

The UI picks which green box to target via the `BACKEND_URL`
environment variable at deploy time. The shipping path is **UI +
TypeScript runtime in one container**, so `BACKEND_URL` is
same-origin. The Python (FastAPI) and Java (Spring Boot) green boxes
are **preview scaffolds**: they boot, serve operational endpoints,
and answer every `/api/v1/*` route with HTTP 501 until handlers are
implemented. The cross-runtime contract and conformance harness exist
specifically so those handlers can land incrementally without
breaking parity guarantees.

See [`green-boxes.md`](green-boxes.md) for the full model, and
[`runtimes/README.md`](../runtimes/README.md) for the per-runtime
status table.

## Components

### Runtime (default: TypeScript, Docker)

The default process lives at [`runtimes/typescript/`](../runtimes/typescript/) and
boots from [`runtimes/typescript/src/root.ts`](../runtimes/typescript/src/root.ts). Responsibilities:

- Load and validate `workbench.yaml`.
- Build a `SecretResolver` from the configured secret providers.
- Build a `ControlPlaneStore` from the configured backend.
- Create and serve the Hono app (routes + middleware).
- Emit structured logs with request IDs and (soon) OpenTelemetry
  traces.

### Control-plane store

Backend-agnostic interface in
[`runtimes/typescript/src/control-plane/store.ts`](../runtimes/typescript/src/control-plane/store.ts). Three
implementations:

| Backend | File | When to use |
|---|---|---|
| `memory` | [`memory/store.ts`](../runtimes/typescript/src/control-plane/memory/store.ts) | CI, tests, `docker run` demos. Not durable. |
| `file` | [`file/store.ts`](../runtimes/typescript/src/control-plane/file/store.ts) | Single-node self-hosted. Per-table mutex + atomic rename. |
| `astra` | [`astra/store.ts`](../runtimes/typescript/src/control-plane/astra/store.ts) | Production. Data API Tables via `astra-db-ts`. |

All three pass the same shared contract suite in
[`runtimes/typescript/tests/control-plane/contract.ts`](../runtimes/typescript/tests/control-plane/contract.ts)
(24 assertions today; grows as routes ship).

### Vector-store drivers (`runtimes/typescript/src/drivers/`)

Data-plane counterparts to the control-plane store. Where
`ControlPlaneStore` owns **records** (workspaces, KBs, services,
RAG documents), the `VectorStoreDriver` owns **actual vectors** in
the per-KB Astra collection.

| File | Purpose |
|---|---|
| [`vector-store.ts`](../runtimes/typescript/src/drivers/vector-store.ts) | Driver interface — `createCollection`, `dropCollection`, `upsert`, `deleteRecord`, `search`, plus optional `searchByText`, `upsertByText`, `searchHybrid`, `rerank`, `listRecords` (chunks under a document), `deleteRecords` (delete-document cascade) |
| [`mock/store.ts`](../runtimes/typescript/src/drivers/mock/store.ts) | In-memory driver; used by workspaces with `kind: "mock"` and by the conformance suite |
| [`astra/store.ts`](../runtimes/typescript/src/drivers/astra/store.ts) | Data API Collections via `astra-db-ts`; per-workspace `DataAPIClient` cache, lazy init |
| [`registry.ts`](../runtimes/typescript/src/drivers/registry.ts) | Dispatches based on `workspace.kind`; unknown kinds surface as `503 driver_unavailable` |
| [`factory.ts`](../runtimes/typescript/src/drivers/factory.ts) | Wires the registry at startup from the `SecretResolver` |

The route layer in
[`api-v1/kb-descriptor.ts`](../runtimes/typescript/src/routes/api-v1/kb-descriptor.ts)
materialises a driver-facing descriptor on the fly from a KB plus
its bound embedding/reranking services. Drivers and the search /
upsert dispatch surfaces consume this synthesised shape unchanged —
they don't need to know KBs exist.

`POST /api/v1/workspaces/{w}/knowledge-bases` is the transactional
entry point: it writes the KB row, calls the driver to create the
collection, and rolls back the row on failure so the control plane
and data plane never diverge. `DELETE` reverses this — drop the
collection first, then the row.

Both drivers pass the same 8-assertion
[driver contract suite](../runtimes/typescript/tests/drivers/contract.ts). The Astra
driver runs it against an in-memory fake `Db` that mimics
`$vector` sort semantics faithfully; real-Astra integration is
gated on `ASTRA_DB_*` env vars and lives in a follow-up.

### Astra client (`runtimes/typescript/src/astra-client/`)

Thin layer over `astra-db-ts` scoped to the `wb_*` tables:

- [`table-definitions.ts`](../runtimes/typescript/src/astra-client/table-definitions.ts) —
  Data API Table DDL.
- [`row-types.ts`](../runtimes/typescript/src/astra-client/row-types.ts) — snake_case JSON
  row shapes.
- [`converters.ts`](../runtimes/typescript/src/astra-client/converters.ts) — pure
  record ↔ row conversion.
- [`tables.ts`](../runtimes/typescript/src/astra-client/tables.ts) — `TablesBundle` —
  narrow structural interface used by the astra store (lets tests
  inject fakes).
- [`client.ts`](../runtimes/typescript/src/astra-client/client.ts) — `openAstraClient()`:
  creates the tables idempotently at init and returns a
  `TablesBundle`.

The Python runtime has a symmetric internal layer that wraps
`astrapy` for the same tables — no shared library, just a shared
schema.

### Secrets (`runtimes/typescript/src/secrets/`)

- `SecretResolver` — dispatches a `SecretRef` to the matching
  provider based on its prefix.
- `EnvSecretProvider` — resolves `env:VAR` → `process.env.VAR`.
- `FileSecretProvider` — resolves `file:/path` → trimmed file
  contents.

Used at startup to resolve `controlPlane.astra.tokenRef`. Future
uses include per-workspace `credentialsRef` when the runtime starts
talking to workspace-scoped backends.

### Routes

| Module | Prefix | Contents |
|---|---|---|
| [`operational.ts`](../runtimes/typescript/src/routes/operational.ts) | (unversioned) | `/`, `/healthz`, `/readyz`, `/version` |
| [`api-v1/workspaces.ts`](../runtimes/typescript/src/routes/api-v1/workspaces.ts) | `/api/v1/workspaces` | Workspace CRUD |
| [`api-v1/knowledge-bases.ts`](../runtimes/typescript/src/routes/api-v1/knowledge-bases.ts) | `/api/v1/workspaces/{w}/knowledge-bases` | KB CRUD (POST auto-provisions collection) |
| [`api-v1/kb-data-plane.ts`](../runtimes/typescript/src/routes/api-v1/kb-data-plane.ts) | `…/knowledge-bases/{kb}/{records,search}` | Upsert / delete record / search |
| [`api-v1/kb-documents.ts`](../runtimes/typescript/src/routes/api-v1/kb-documents.ts) | `…/knowledge-bases/{kb}/{documents,ingest}` | Document metadata, sync + async ingest, chunk listing |
| [`api-v1/kb-descriptor.ts`](../runtimes/typescript/src/routes/api-v1/kb-descriptor.ts) | — | `resolveKb()` — synthesises a driver-facing descriptor from a KB + bound services |
| [`api-v1/{chunking,embedding,reranking}-services.ts`](../runtimes/typescript/src/routes/api-v1/) | `…/{chunking,embedding,reranking}-services` | Service CRUD |
| [`api-v1/jobs.ts`](../runtimes/typescript/src/routes/api-v1/jobs.ts) | `/api/v1/workspaces/{w}/jobs` | Job poll + SSE stream |
| [`api-v1/api-keys.ts`](../runtimes/typescript/src/routes/api-v1/api-keys.ts) | `/api/v1/workspaces/{w}/api-keys` | Per-workspace API-key management |
| [`api-v1/helpers.ts`](../runtimes/typescript/src/routes/api-v1/helpers.ts) | — | Error mapping (invoked from app-level `onError`) |

Route handlers validate with Zod (via `@hono/zod-openapi`) and
delegate to the `ControlPlaneStore`. Typed errors (`ControlPlaneNot
FoundError`, `…ConflictError`, `…UnavailableError`) bubble to the
top-level `onError` handler which maps them to the canonical HTTP
envelope.

## Data model

Data API tables backed by CQL-style schemas. The exact DDL lives in
[`runtimes/typescript/src/astra-client/table-definitions.ts`](../runtimes/typescript/src/astra-client/table-definitions.ts);
here's the logical shape:

```
wb_workspaces                                 PK (workspaceId)
    workspaceId, name, endpoint, kind, credentials_ref, keyspace,
    created_at, updated_at

wb_config_knowledge_bases_by_workspace        PK ((workspace_id), knowledge_base_id)
    name, description, status,
    embedding_service_id, chunking_service_id, reranking_service_id,
    language, vector_collection,
    lexical_{enabled,analyzer,options},
    created_at, updated_at

wb_config_chunking_service_by_workspace       PK ((workspace_id), chunking_service_id)
    name, description, status,
    engine, engine_version, strategy,
    {min,max}_chunk_size, chunk_unit,
    overlap_size, overlap_unit, preserve_structure,
    language, max_payload_size_kb,
    enable_ocr, extract_tables, extract_figures, reading_order,
    endpoint_*, request_timeout_ms, auth_type, credential_ref,
    created_at, updated_at

wb_config_embedding_service_by_workspace      PK ((workspace_id), embedding_service_id)
    name, description, status,
    provider, model_name, embedding_dimension, distance_metric,
    max_batch_size, max_input_tokens,
    supported_languages SET<TEXT>, supported_content SET<TEXT>,
    endpoint_*, request_timeout_ms, auth_type, credential_ref,
    created_at, updated_at

wb_config_reranking_service_by_workspace      PK ((workspace_id), reranking_service_id)
    name, description, status,
    provider, engine, model_name, model_version,
    max_candidates, scoring_strategy,
    score_normalized, return_scores, max_batch_size,
    supported_languages SET<TEXT>, supported_content SET<TEXT>,
    endpoint_*, request_timeout_ms, auth_type, credential_ref,
    created_at, updated_at

wb_rag_documents_by_knowledge_base            PK ((workspace_id, knowledge_base_id), document_id)
    source_*, file_*, content_hash, chunk_total,
    ingested_at, updated_at,
    status, error_message, metadata

wb_rag_documents_by_knowledge_base_and_status (secondary index, by status)
wb_rag_documents_by_content_hash              (dedup lookup)

wb_jobs_by_workspace                          PK ((workspace), job_id)
    kind, knowledge_base_uid, document_uid, status,
    processed, total, result_json, error_message,
    leased_by, leased_at, ingest_input_json,
    created_at, updated_at

wb_api_key_by_workspace, wb_api_key_lookup    (per-workspace tokens)
```

**`kind`** on workspaces is one of `astra | hcd | openrag | mock`. It
describes the backend that *the workspace itself* targets (useful
later, when a single runtime routes requests to different
data-plane backends per workspace). The runtime's own control plane
is separate — chosen via `workbench.yaml`.

**Knowledge bases own their collection.** `vector_collection` on
the KB row is the auto-provisioned Astra collection name
(`wb_vectors_<kb_id>`, hyphen-stripped). The actual vector data
lives in that Data API Collection, provisioned transactionally
when the KB is created and dropped when it's deleted.

**Reserved chunk-payload keys.** The KB-scoped ingest pipeline
stamps `knowledgeBaseId`, `documentId`, `chunkIndex`, and
`chunkText` onto every chunk's payload so KB-scoped search and the
chunk listing endpoint can filter / display them without a
secondary lookup.

**Stage 2 schema.** Five additional control-plane tables back the
agent surface:
`wb_config_llm_service_by_workspace` (LLM executors;
`/api/v1/workspaces/{w}/llm-services` CRUD),
`wb_config_mcp_tools_by_workspace` (provisioned, not yet wired —
lands with agent tool-use),
`wb_agentic_agents_by_workspace`,
`wb_agentic_conversations_by_agent`, and
`wb_agentic_messages_by_conversation`. The agent surface — CRUD
plus send + streaming — runs against the last three tables; an
agent's optional `llmServiceId` points at a row in the LLM-service
table for per-agent provider selection.

## Isolation and scoping

- Every request targeting a specific resource carries the workspace
  UID in the path: `/api/v1/workspaces/{workspaceId}/...`.
- The control-plane store asserts the workspace exists before
  returning nested resources. Requests against a non-existent
  workspace return `404 workspace_not_found`.
- Cascade delete:
  - `DELETE /api/v1/workspaces/{w}` → drops the workspace, all
    knowledge bases (and their underlying collections), all
    execution services, all RAG documents, all API keys.
  - `DELETE /api/v1/workspaces/{w}/knowledge-bases/{kb}` → drops
    the underlying Astra collection first, then the KB row, then
    cascades RAG document rows.
- **Service → KB binding is N:1.** A KB binds exactly one
  embedding service, one chunking service, and (optionally) one
  reranking service. Multiple KBs can share the same service. A
  service deletion is refused (409) while any KB still references
  it.
- **Service references are immutable post-create.** The
  `embeddingServiceId` and `chunkingServiceId` on a KB are pinned
  at creation time — vectors and chunks on disk are bound to the
  models that produced them. Re-embedding requires a new KB; the
  PATCH schema is `.strict()` so accidentally including those keys
  in an update body returns 400.

## Request flow (reference)

Workspace creation today:

```
Client ──► POST /api/v1/workspaces  body={name, kind}
            │
            ▼
   Hono middleware (request ID, JSON body parse)
            │
            ▼
   Zod validation via @hono/zod-openapi
            │
            ▼
   workspaceRoutes.createWorkspace handler
            │
            ▼
   ControlPlaneStore.createWorkspace(input)   ◄── one of memory / file / astra
            │
            ▼                                      (astra only)
   TablesBundle.workspaces.insertOne(row)  ────►  @datastax/astra-db-ts
                                                        │
                                                        ▼
                                             Astra Data API Table insert
            │
            ▼
   c.json(record, 201)
```

The KB ingest pipeline extends the same shape with calls to a
`Chunker`, an `Embedder`, and the KB's auto-provisioned vector
collection (resolved through `resolveKb`), plus a `RagDocument`
row that tracks ingest status. Synchronous and async
(`?async=true`) variants live at
`POST /knowledge-bases/{kb}/ingest`; the async path returns 202
with a job pointer and updates progress through the `JobStore`
until terminal.

## Conformance

Every language green box must produce byte-identical `/api/v1/*`
responses for the shared scenarios in
[`conformance/scenarios.json`](../conformance/scenarios.json).
Fixtures in
[`conformance/fixtures/`](../conformance/fixtures/)
are the source of truth; they're materialized from the canonical
TypeScript runtime via `npm run conformance:regenerate`.

See [`conformance.md`](conformance.md) for details.

## Out of scope (for now)

- Multi-tenant SaaS concerns (quotas, billing, per-tenant encryption
  keys).
- Cluster coordination — the runtime is single-process today.
  Horizontal scale comes from running multiple containers behind a
  load balancer, with an `astra` (or future `hcd`) control plane as
  the shared source of truth. The job-store subscriber fan-out is
  in-process; cross-replica push is on the roadmap, see
  [`cross-replica-jobs.md`](cross-replica-jobs.md).
- Direct database migrations — Astra manages its own.

## Open questions

Tracked in [`roadmap.md`](roadmap.md) so the architecture doc stays
focused.
