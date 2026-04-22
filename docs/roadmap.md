# Roadmap

AI Workbench is built in small, shippable phases. Each phase produces a
runnable artifact and a stable slice of the HTTP contract.

## Status snapshot

| Phase | Scope | Status |
|---|---|---|
| 0 | Runtime bootstrap + docs | ✅ Shipped |
| 1a | Control-plane CRUD (`/api/v1/workspaces`, `/catalogs`, `/vector-stores`) | ✅ Shipped |
| 1b | Vector-store data plane (provisioning, upsert, search) | Planned |
| 2 | Documents + ingest + catalog-scoped search + saved queries | Planned |
| 3 | Playground + UI | Planned |
| 4+ | Chats, MCP | Reserved |

## Phase 0 — Bootstrap ✅

Shipped with the initial runtime scaffold.

- `src/root.ts` — Hono-based HTTP entry point.
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
  `src/`, alternative runtimes under `clients/*-runtime/`.
- Python runtime scaffold (FastAPI) under
  [`clients/python-runtime/`](../clients/python-runtime/).
- Cross-runtime conformance harness with committed fixtures.

## Phase 1b — Vector-store data plane

**Goal:** make vector stores hold actual vectors, not just descriptors.

Deliverables:

- `VectorStoreDriver` interface: `createCollection`, `upsert`,
  `delete`, `search`, `getCollectionInfo`, `getCollectionSchema`,
  `getSearchCapabilities` (capability flags inspired by
  [VectorDBZ](https://github.com/vectordbz/vectordbz)).
- `POST /api/v1/workspaces/{w}/vector-stores` becomes transactional:
  writes the descriptor row AND provisions the underlying Data API
  Collection.
- New routes:
  - `POST .../records` — upsert
  - `DELETE .../records/{id}` — delete one
  - `POST .../search` — vector + filter search
- Contract tests that run against the mock driver in CI.
- Real-Astra integration test gated on `ASTRA_DB_*` env vars.

## Phase 2 — Documents, ingest, search, queries

**Goal:** end-to-end knowledge-base flow from raw file to searchable
result.

Deliverables:

- Document metadata CRUD
  (`/api/v1/workspaces/{w}/catalogs/{c}/documents[/{d}]`). `PUT`
  updates metadata only; content changes go through `/ingest`.
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
