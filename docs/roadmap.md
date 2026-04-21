# Roadmap

AI Workbench is being built in small, shippable phases. Each phase produces a
runnable artifact and a stable contract slice.

## Phase 0 — Bootstrap (current)

**Goal:** a runnable Hello-World TypeScript service plus the full documentation
set for what comes next.

Deliverables:

- `src/root.ts` — minimal HTTP entry point.
- Config loader that reads `workbench.yaml`, interpolates env vars, validates
  the v1 schema.
- Workspace registry that materializes workspaces from config (driver wiring
  is stubbed for `astra`; fully functional for `mock`).
- Endpoints:
  - `GET /`
  - `GET /healthz`
  - `GET /readyz`
  - `GET /version`
  - `GET /v1/workspaces`
  - `GET /v1/workspaces/{id}`
- Dockerfile producing a single image that runs on port 8080.
- Documentation in `docs/` (this set).
- CI: lint, typecheck, unit tests, Docker build.

Out of scope:

- Any Astra traffic beyond credential validation.
- Auth enforcement.
- Chunking, embedding, ingestion, playground.

## Phase 1 — Vector store pass-through

**Goal:** expose vector-store CRUD and search via the runtime for Astra and
mock drivers.

Deliverables:

- Driver interface: `VectorStoreDriver { list, upsert, delete, search }`.
- Astra and mock implementations.
- Routes under `/v1/workspaces/{id}/vector-stores/…`.
- Schema validation for search requests.
- Contract tests that run against the mock driver in CI.

## Phase 2 — Document catalog

**Goal:** register and manage documents independently of their vectors.

Deliverables:

- Catalog CRUD (`/v1/workspaces/{id}/catalogs/…`).
- Document metadata schema.
- Enforcement of catalog → vector-store binding on writes.
- Cascade semantics for document deletion (configurable).

## Phase 3 — Ingestion pipeline

**Goal:** turn raw documents into chunked, embedded, catalog-registered
records in one call.

Deliverables:

- Chunking service contract and reference implementation (in-process).
- Embedding service contract and reference implementation (in-process).
- `POST /v1/workspaces/{id}/catalogs/{cat}/ingest` with async job semantics.
- `GET /v1/workspaces/{id}/jobs/{jobId}` for status polling.
- Streaming progress (SSE).

## Phase 4 — Playground & UI

**Goal:** a browser UI for exploring workspaces, running searches, ingesting
files, and inspecting results.

Deliverables:

- `GET /playground` and `/ingest` served by the runtime.
- Playground API: `POST /v1/workspaces/{id}/playground/query`.
- UI is a first-class consumer of the existing `/v1/…` surface — no special
  admin API.

## Phase 5+ — Chats, MCP

Reserved for integrating:

- A chat harness that runs against the workspace's catalogs.
- An MCP server view of the workspace for external agents.

Contracts are intentionally undefined until Phase 4 is stable.

## Cross-cutting workstreams

These run continuously rather than as discrete phases:

- **Observability.** Structured logs with `workspaceId`, request IDs, and
  OpenTelemetry traces.
- **Auth.** Bearer tokens from Phase 1 onward; pluggable token validators
  (static, JWT, remote introspection).
- **Testing.** `mock` driver is the golden path — every feature must have
  coverage that runs with no external dependencies.
- **Docs.** Every route added to the runtime updates `docs/api-spec.md` in
  the same PR. An OpenAPI bundle is published from Phase 1 onward.

## Open questions

Things we have deliberately not decided and should revisit before the
corresponding phase:

- **Multi-tenant auth model.** Is a workspace the tenant, or is there a
  tenant-above-workspace concept for SaaS?
- **Secrets backend.** Env interpolation is fine for self-hosted; hosted
  deployments likely want a pluggable secret provider (Vault, AWS SM, etc.).
- **Chunker/embedder plugin model.** In-process only vs. external HTTP
  contract vs. both.
- **Hot reload.** Worth the complexity, or is restart-on-change sufficient?
- **Schema version 2.** What changes are we queueing that would force a
  bump, and how do we stage it?
