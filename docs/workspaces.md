# Workspaces

A **workspace** is the unit of isolation in AI Workbench. Each workspace
represents a distinct environment — typically `prod`, `dev`, or `mock` — with
its own credentials, catalogs, and vector stores.

## Why workspaces?

A single runtime process needs to serve developer workflows that span
environments without mixing them. Instead of standing up one container per
environment, we run **one process with N workspaces**. Each workspace is an
immutable configuration slice, bound by routing rules.

## Properties

### Identity

- `id` is unique across the runtime (`^[a-z][a-z0-9-]{0,63}$`).
- The id is a path segment: `/v1/workspaces/{id}/…`.
- The id is stable — renaming a workspace is a config-breaking change.

### Isolation

- A request carrying workspace id `A` can never read or mutate resources in
  workspace `B`. The workspace resolver middleware enforces this before any
  handler runs.
- Workspaces do not share credentials, drivers, or service configurations
  unless the top-level `services` block explicitly provides shared defaults.
- Logs are tagged with `workspaceId`. Metrics are dimensioned by workspace.

### Driver binding

Each workspace picks exactly one driver:

- `astra` — production-path, backed by the Astra Data API.
- `mock` — in-memory, for local development and tests.

A workspace cannot switch drivers at runtime. Switching is a redeploy.

### Catalogs and vector stores

A workspace owns:

- **Vector stores** — 0..N named vector collections.
- **Catalogs** — 0..N document catalogs, each bound to **exactly one** vector
  store in the same workspace.

Binding is **strictly 1:1**: every catalog references exactly one vector
store, and every vector store is referenced by at most one catalog. The
runtime enforces this at config validation time and rejects configurations
in which two catalogs name the same `vectorStore` id.

The relationship is:

```
workspace ──► catalog ──► vectorStore
                │              (1:1)
                └──► documents (metadata)
```

Rationale: tying a catalog to its own vector store keeps ownership, schema
evolution, retention, and cascade-delete semantics unambiguous. If two
logical catalogs need to share an embedding space, define two catalogs over
two vector stores and replicate ingestion — don't alias.

## The `mock` workspace

Every example ships with a `mock` workspace. The mock driver:

- Keeps all state in memory.
- Accepts the same HTTP surface as the Astra driver.
- Is the default target for tests and the recommended starting point for
  local development.

A CI run should be able to boot the runtime against `driver: mock` with no
network access and execute the full API surface.

## Lifecycle

Workspaces are resolved once at process start:

1. Runtime loads `workbench.yaml`.
2. For each workspace entry, the runtime instantiates the declared driver,
   validates credentials (for `astra`) or seeds initial state (for `mock`),
   and wires up service clients.
3. `/readyz` flips to `ready` only once every workspace has resolved.

A workspace that fails to resolve blocks readiness but does not crash the
process. Other workspaces continue to serve. The failing workspace's id is
reported via `/readyz` and `/v1/workspaces`.

## Example

```yaml
version: 1

workspaces:
  - id: prod
    driver: astra
    astra:
      endpoint: ${ASTRA_PROD_ENDPOINT}
      token: ${ASTRA_PROD_TOKEN}
    vectorStores:
      - id: support-vectors
        collection: support_vectors
        dimensions: 1536
    catalogs:
      - id: support-docs
        vectorStore: support-vectors

  - id: dev
    driver: astra
    astra:
      endpoint: ${ASTRA_DEV_ENDPOINT}
      token: ${ASTRA_DEV_TOKEN}
    vectorStores:
      - id: support-vectors
        collection: support_vectors_dev
        dimensions: 1536
    catalogs:
      - id: support-docs
        vectorStore: support-vectors

  - id: mock
    driver: mock
    vectorStores:
      - id: support-vectors
        collection: support_vectors
        dimensions: 1536
    catalogs:
      - id: support-docs
        vectorStore: support-vectors
```

In this setup, the same logical schema (`support-docs` catalog, 1536-dim
vectors) is available in all three environments. Clients only change the
workspace id in the URL.
