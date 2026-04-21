# Architecture

AI Workbench is a single TypeScript runtime that sits in front of Astra DB and
exposes a cohesive workbench surface (UI + HTTP API) for developers operating
on vector stores, document catalogs, and ingestion pipelines.

## Design principles

1. **One runtime, many workspaces.** A single process hosts all environments
   (prod, dev, mock). Workspaces are configuration, not deployments.
2. **Thin, boring core.** The runtime is an HTTP server with a config loader,
   a workspace registry, and a driver abstraction. Complexity lives in
   pluggable services.
3. **Declarative config.** Every capability — a catalog, a vector store, an
   embedder — is declared in YAML. No imperative setup steps.
4. **Driver-based backends.** Astra is the primary driver. `mock` is a
   first-class driver used for tests and offline dev. New backends plug in
   behind the same interfaces.
5. **Contract-first.** The HTTP surface is versioned (`/v1/…`) and documented
   in [`api-spec.md`](api-spec.md) before implementation.
6. **No shared mutable state.** Configuration is loaded into immutable
   snapshots. Reloads produce new snapshots.

## Components

### Runtime (TypeScript, Docker)

The single process that serves the workbench. Entry point is
[`src/root.ts`](../src/root.ts) (Phase 0). Responsibilities:

- Load and validate `workbench.yaml`.
- Build the **workspace registry** — one resolved config per workspace.
- Mount HTTP routes under versioned prefixes.
- Provide health, readiness, and version endpoints.
- Wire middleware: request ID, logging, auth, error handler, workspace resolver.

### Workspace registry

A workspace is a named, isolated configuration (`prod`, `dev`, `mock`, …). It
owns:

- **Credentials** for its Astra instance (or the mock driver).
- **Catalogs** — 0..N document catalogs.
- **Vector stores** — each catalog binds to exactly one vector store, and
  each vector store is owned by exactly one catalog (strict 1:1).
- **Embedder and chunker** references.

Workspaces cannot read each other's data. Routing is explicit: every resource
request includes a workspace identifier (via path or header — see
[`api-spec.md`](api-spec.md)).

### Drivers

A driver implements the backend contract for a workspace.

- `astra` — talks to Astra DB via the Data API. The default.
- `mock` — in-memory implementation for tests and demos. Ships with the
  runtime and requires no external services.

Drivers are selected per-workspace in YAML.

### Services

Stateless HTTP/library services consumed by the runtime:

- **chunking_service** — splits documents into chunks.
- **embedding_service** — turns chunks into vectors.

Both are addressed by URL in config so they can run in-process, as sidecars,
or as external services.

### Data API surface (delegated)

The runtime does not reimplement Astra. It delegates to the Astra **Data API**
for:

- `vector_store` — collection-level CRUD and vector search.
- `document catalog` — document metadata and CRUD.
- `workspace (config)` — Astra-side workspace config.
- `collections` — underlying storage objects.

## Request flow (reference)

A typical "ingest a document" flow, once Phase 3 lands:

```
Client ──► POST /v1/workspaces/{ws}/catalogs/{cat}/ingest
            │
            ▼
   Decoupling API (auth, workspace resolve, request ID)
            │
            ├──► chunking_service   (split into chunks)
            │
            ├──► embedding_service  (chunks → vectors)
            │
            └──► Astra Data API
                    ├──► document catalog  (metadata)
                    └──► vector_store      (vectors + payload)
```

Phase 0 covers only the leftmost box — the runtime and its routing shell.

## Extensibility model

- **New driver.** Implement the driver interface, register it by name, and
  workspaces can opt in via `driver: <name>` in YAML.
- **New service.** Declare in YAML with a URL and an optional health probe.
  The runtime exposes it to routes via a typed client.
- **New route.** Add under `src/routes/<resource>/…` and register in the
  router. Every route is scoped to a workspace.

## Out of scope (for now)

- Multi-tenant SaaS concerns (quotas, billing, per-tenant encryption keys).
- Cluster coordination — the runtime is single-node. Horizontal scale comes
  later and does not change the config model.
- Direct database migrations — migrations are owned by Astra.

## Open questions

Tracked in [`roadmap.md`](roadmap.md) so the architecture doc stays focused.
