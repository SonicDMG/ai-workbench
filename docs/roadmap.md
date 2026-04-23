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
| 2b | Ingest + catalog-scoped search + saved queries | Planned |
| 3 | Playground + UI | Planned |
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

Deliverables:

- Chunking service contract and reference implementation (in-process).
- Embedding service contract and reference implementation.
- `POST .../catalogs/{c}/ingest` with async job semantics.
- `GET .../jobs/{jobId}` for status polling.
- Streaming progress via SSE.
- `POST .../catalogs/{c}/documents/search` — catalog-scoped hybrid
  search (vector + lexical + rerank if enabled on the bound vector
  store).
- Saved queries per catalog
  (`/api/v1/workspaces/{w}/catalogs/{c}/queries[/{q}]`) from Cédrick's
  spec.
- Workspace-scoped API keys (`wb_workspace_api_keys`) — the runtime
  finally grows an auth boundary.

## Phase 3 — Playground & UI

**Goal:** a browser UI for exploring workspaces, running searches,
ingesting files, and inspecting results.

Deliverables:

- Static `/playground` and `/ingest` assets served by the runtime.
- Playground API: `POST /api/v1/workspaces/{w}/playground/query`.
- UI consumes the existing `/api/v1/*` surface — no special admin API.
- UI + default TS runtime ship as one Docker image.

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
- **Workspace ↔ data-plane routing.** Today's control plane stores
  the workspace's `kind` and `credentialsRef` but doesn't yet dial
  into per-workspace backends. Lands with Phase 1b.
- **Chunker/embedder plugin model.** In-process only, external HTTP
  contract, or both?
- **Hot reload.** Worth the complexity, or is restart-on-change
  sufficient? (Leaning restart-only — the blast radius of config
  changes is small now that workspaces are runtime data.)
- **Schema version 2.** What changes are we queueing that would
  force a bump, and how do we stage it?
