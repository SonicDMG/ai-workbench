# Architecture

AI Workbench is a polyglot HTTP runtime sitting in front of Astra DB.
It exposes a stable `/api/v1/*` contract for workspaces, document
catalogs, vector-store descriptors, and (in later phases) documents,
ingestion, and search. Each **language-native implementation of the
runtime** is a "green box"; the default TypeScript green box is
embedded with the UI, and alternatives live under
[`clients/`](../clients/README.md).

## Design principles

1. **One HTTP contract, N runtimes.** Workspaces, catalogs, and
   vector-store descriptors are defined by the HTTP API — not by any
   one runtime's internals. Every language green box honors the same
   contract, enforced by
   [fixture-based conformance tests](./conformance.md).
2. **Thin, boring runtime core.** The runtime is an HTTP server + a
   pluggable control-plane store. Complexity lives in pluggable
   services (chunking, embedding, reranking in later phases).
3. **Workspaces are runtime data, not config.** `workbench.yaml`
   picks which control-plane backend to use; workspaces themselves
   are mutable records managed via the HTTP API.
4. **Driver-based control plane.** `memory` for CI and demos, `file`
   for single-node self-hosted, `astra` for production. Same
   contract.
5. **Astra-native where real.** The `astra` backend uses
   [`@datastax/astra-db-ts`](https://github.com/datastax/astra-db-ts)
   directly. The Python runtime uses
   [`astrapy`](https://github.com/datastax/astrapy). No wrapper
   libraries in between.
6. **Secrets by reference.** Credentials live behind
   `SecretRef` pointers (`env:FOO` / `file:/path`) resolved at use
   time by a pluggable provider. No raw secrets in config, records,
   or logs.
7. **Immutable records.** Every update returns a new object. The
   in-memory backend holds `Map<uid, Record>`; the file backend
   rewrites atomically; the astra backend does `$set` updates
   through the Data API.
8. **Contract-first for new surfaces.** The HTTP API is versioned
   (`/api/v1/…`) and documented in [`api-spec.md`](api-spec.md) and
   the generated OpenAPI at `/api/v1/openapi.json`.

## The "green box" model

Cédrick's architecture diagram has one green box per language-native
runtime. Every green box:

- Serves the same `/api/v1/*` surface.
- Speaks Astra via its own language-native SDK internally.
- Runs as a standalone HTTP server (a Docker container in production).

The UI picks which green box to target via the `BACKEND_URL`
environment variable at deploy time. The default shipping path is
**UI + TypeScript runtime in one container**, so `BACKEND_URL` is
same-origin; alternative deployments point it at a Python or Java
green box.

See [`green-boxes.md`](green-boxes.md) for the full model, and
[`clients/README.md`](../clients/README.md) for the list of current
runtimes.

## Components

### Runtime (default: TypeScript, Docker)

The default process lives at [`src/`](../src/) in the repo root and
boots from [`src/root.ts`](../src/root.ts). Responsibilities:

- Load and validate `workbench.yaml`.
- Build a `SecretResolver` from the configured secret providers.
- Build a `ControlPlaneStore` from the configured backend.
- Create and serve the Hono app (routes + middleware).
- Emit structured logs with request IDs and (soon) OpenTelemetry
  traces.

### Control-plane store

Backend-agnostic interface in
[`src/control-plane/store.ts`](../src/control-plane/store.ts). Three
implementations:

| Backend | File | When to use |
|---|---|---|
| `memory` | [`memory/store.ts`](../src/control-plane/memory/store.ts) | CI, tests, `docker run` demos. Not durable. |
| `file` | [`file/store.ts`](../src/control-plane/file/store.ts) | Single-node self-hosted. Per-table mutex + atomic rename. |
| `astra` | [`astra/store.ts`](../src/control-plane/astra/store.ts) | Production. Data API Tables via `astra-db-ts`. |

All three pass the same 14-assertion shared contract suite in
[`tests/control-plane/contract.ts`](../tests/control-plane/contract.ts).

### Vector-store drivers (`src/drivers/`)

Data-plane counterparts to the control-plane store. Where
`ControlPlaneStore` owns **descriptors**, the `VectorStoreDriver`
owns **actual vectors** on a per-workspace backend.

| File | Purpose |
|---|---|
| [`vector-store.ts`](../src/drivers/vector-store.ts) | Driver interface — `createCollection`, `dropCollection`, `upsert`, `deleteRecord`, `search` |
| [`mock/store.ts`](../src/drivers/mock/store.ts) | In-memory driver; used by workspaces with `kind: "mock"` and by the conformance suite |
| [`astra/store.ts`](../src/drivers/astra/store.ts) | Data API Collections via `astra-db-ts`; per-workspace `DataAPIClient` cache, lazy init |
| [`registry.ts`](../src/drivers/registry.ts) | Dispatches based on `workspace.kind`; unknown kinds surface as `503 driver_unavailable` |
| [`factory.ts`](../src/drivers/factory.ts) | Wires the registry at startup from the `SecretResolver` |

`POST /api/v1/workspaces/{w}/vector-stores` is the transactional
entry point: it writes the descriptor, calls the driver to create
the collection, and rolls back the descriptor on failure so the
control plane and data plane never diverge.

Both drivers pass the same 8-assertion
[driver contract suite](../tests/drivers/contract.ts). The Astra
driver runs it against an in-memory fake `Db` that mimics
`$vector` sort semantics faithfully; real-Astra integration is
gated on `ASTRA_DB_*` env vars and lives in a follow-up.

### Astra client (`src/astra-client/`)

Thin layer over `astra-db-ts` scoped to the four `wb_*` tables:

- [`table-definitions.ts`](../src/astra-client/table-definitions.ts) —
  Data API Table DDL.
- [`row-types.ts`](../src/astra-client/row-types.ts) — snake_case JSON
  row shapes.
- [`converters.ts`](../src/astra-client/converters.ts) — pure
  record ↔ row conversion.
- [`tables.ts`](../src/astra-client/tables.ts) — `TablesBundle` —
  narrow structural interface used by the astra store (lets tests
  inject fakes).
- [`client.ts`](../src/astra-client/client.ts) — `openAstraClient()`:
  creates the four tables idempotently at init and returns a
  `TablesBundle`.

The Python runtime has a symmetric internal layer that wraps
`astrapy` for the same tables — no shared library, just a shared
schema.

### Secrets (`src/secrets/`)

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
| [`operational.ts`](../src/routes/operational.ts) | (unversioned) | `/`, `/healthz`, `/readyz`, `/version` |
| [`api-v1/workspaces.ts`](../src/routes/api-v1/workspaces.ts) | `/api/v1/workspaces` | Workspace CRUD |
| [`api-v1/catalogs.ts`](../src/routes/api-v1/catalogs.ts) | `/api/v1/workspaces/{w}/catalogs` | Catalog CRUD |
| [`api-v1/vector-stores.ts`](../src/routes/api-v1/vector-stores.ts) | `/api/v1/workspaces/{w}/vector-stores` | Descriptor CRUD |
| [`api-v1/helpers.ts`](../src/routes/api-v1/helpers.ts) | — | Error mapping (invoked from app-level `onError`) |

Route handlers validate with Zod (via `@hono/zod-openapi`) and
delegate to the `ControlPlaneStore`. Typed errors (`ControlPlaneNot
FoundError`, `…ConflictError`, `…UnavailableError`) bubble to the
top-level `onError` handler which maps them to the canonical HTTP
envelope.

## Data model

Four `wb_*` Data API tables backed by CQL-style schemas. The exact
DDL lives in
[`src/astra-client/table-definitions.ts`](../src/astra-client/table-definitions.ts);
here's the logical shape:

```
wb_workspaces                  PK (uid)
    uid, name, url, kind, credentials_ref, keyspace, created_at, updated_at

wb_catalog_by_workspace        PK ((workspace), uid)
    name, description, vector_store, created_at, updated_at

wb_vector_store_by_workspace   PK ((workspace), uid)
    name, vector_dimension, vector_similarity,
    embedding_{provider,model,endpoint,dimension,secret_ref},
    lexical_{enabled,analyzer,options},
    reranking_{enabled,provider,model,endpoint,secret_ref},
    created_at, updated_at

wb_documents_by_catalog        PK ((workspace, catalog_uid), document_uid)
    source_*, file_*, md5_hash, chunk_total, ingested_at, updated_at,
    status, error_message, metadata
```

**`kind`** on workspaces is one of `astra | hcd | openrag | mock`. It
describes the backend that *the workspace itself* targets (useful
later, when a single runtime routes requests to different
data-plane backends per workspace). The runtime's own control plane
is separate — chosen via `workbench.yaml`.

**`wb_vector_store_by_workspace` is a DESCRIPTOR row**, not the
vector data. The actual Data API Collection holding vectors is a
separate object provisioned when Phase 1b lands.

## Isolation and scoping

- Every request targeting a specific resource carries the workspace
  UID in the path: `/api/v1/workspaces/{workspaceId}/...`.
- The control-plane store asserts the workspace exists before
  returning nested resources. Requests against a non-existent
  workspace return `404 workspace_not_found`.
- Cascade delete:
  - `DELETE /api/v1/workspaces/{w}` → drops the workspace, its
    catalogs, its vector-store descriptors, and its documents.
  - `DELETE /api/v1/workspaces/{w}/catalogs/{c}` → drops the
    catalog and its documents.
- **Catalog → vector-store binding is N:1** (multiple catalogs may
  share one underlying collection). This was a deliberate relaxation
  from an earlier draft's strict 1:1 constraint.

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

Future ingestion (Phase 2+) will extend the same shape with calls to
chunking and embedding services before writing to a catalog's vector
store.

## Conformance

Every language green box must produce byte-identical `/api/v1/*`
responses for the shared scenarios in
[`clients/conformance/scenarios.json`](../clients/conformance/scenarios.json).
Fixtures in
[`clients/conformance/fixtures/`](../clients/conformance/fixtures/)
are the source of truth; they're materialized from the canonical
TypeScript runtime via `npm run conformance:regenerate`.

See [`conformance.md`](conformance.md) for details.

## Out of scope (for now)

- Multi-tenant SaaS concerns (quotas, billing, per-tenant encryption
  keys).
- Cluster coordination — the runtime is single-process. Horizontal
  scale comes from running multiple containers behind a load
  balancer, with an `astra` (or future `hcd`) control plane as the
  shared source of truth.
- Direct database migrations — Astra manages its own.
- Workspace-scoped API keys (`wb_workspace_api_keys`). Auth arrives
  in Phase 2+.

## Open questions

Tracked in [`roadmap.md`](roadmap.md) so the architecture doc stays
focused.
