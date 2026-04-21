# Configuration (`workbench.yaml`)

All AI Workbench behavior is driven by a single YAML file, conventionally
named `workbench.yaml`. The runtime loads it at startup, validates it against
a strict schema, and exposes the resolved (redacted) view at
`GET /v1/workspaces/{id}`.

## Resolution order

1. Path from `--config <file>` CLI flag, if present.
2. Path from `WORKBENCH_CONFIG` environment variable.
3. `./workbench.yaml` in the current working directory.
4. `/etc/workbench/workbench.yaml` inside the container.

The first file found wins. No merging across sources — the config is a single
declarative document.

## Environment variable interpolation

Any string value may reference an environment variable with `${VAR}` or
`${VAR:-default}` syntax. Interpolation happens before schema validation, so
required fields can be sourced from the environment:

```yaml
workspaces:
  - id: prod
    driver: astra
    astra:
      token: ${ASTRA_TOKEN}
```

References to unset variables without a default fail loudly at startup.

## Top-level schema

```yaml
version: 1                    # required. Config schema version.
runtime:                      # optional. Runtime-level settings.
  port: 8080
  logLevel: info              # trace | debug | info | warn | error
services:                     # optional. Shared services.
  chunking:
    url: http://chunking:8080
  embedding:
    url: http://embedding:8080
workspaces:                   # required. 1..N workspaces.
  - id: prod
    driver: astra
    ...
```

### `version`

Schema version. Currently `1`. The runtime refuses to start on an unknown
version.

### `runtime`

| Field | Type | Default | Notes |
|-------|------|---------|-------|
| `port` | int | `8080` | HTTP listen port. |
| `logLevel` | enum | `info` | `trace`, `debug`, `info`, `warn`, `error`. |
| `requestIdHeader` | string | `X-Request-Id` | Request ID header name. |

### `services`

Shared service endpoints used by all workspaces unless a workspace overrides
them.

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `chunking.url` | URL | no (Phase 3+) | Chunking service base URL. |
| `embedding.url` | URL | no (Phase 3+) | Embedding service base URL. |

Not required in Phase 0 / 1.

### `workspaces`

An array of workspace definitions. Each entry must have a unique `id`.

#### Common workspace fields

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `id` | string | yes | `^[a-z][a-z0-9-]{0,63}$`. Used in URLs. |
| `description` | string | no | Human-readable. |
| `driver` | enum | yes | `astra` or `mock`. |
| `auth` | object | no | Workspace-level auth. See below. |
| `catalogs` | array | no | 0..N catalogs bound to this workspace. |
| `services` | object | no | Per-workspace service overrides. |

#### `driver: astra`

```yaml
workspaces:
  - id: prod
    driver: astra
    astra:
      endpoint: https://<db-id>-<region>.apps.astra.datastax.com
      token: ${ASTRA_TOKEN}
      keyspace: default_keyspace
```

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `astra.endpoint` | URL | yes | Astra Data API endpoint for this workspace. |
| `astra.token` | string | yes | Astra application token. Use env interpolation. |
| `astra.keyspace` | string | no | Default keyspace. |

#### `driver: mock`

```yaml
workspaces:
  - id: mock
    driver: mock
    mock:
      seed: ./examples/mock-data.json   # optional
```

In-memory store. Resets on process restart. Intended for local dev and tests.

#### `auth`

Per-workspace auth for inbound requests.

```yaml
auth:
  kind: bearer          # none | bearer
  tokens:
    - ${WORKBENCH_TOKEN}
```

- `kind: none` — no auth required. Suitable for local/mock only.
- `kind: bearer` — the request must carry `Authorization: Bearer <token>`
  and the token must match one of the entries in `tokens`.

Phase 0 ignores `auth` (no auth enforced yet). The field is reserved so
config files written today won't need to change when auth lands.

#### `catalogs`

Each catalog is a named document collection bound to **exactly one** vector
store. The binding is strict 1:1 — a vector store may be referenced by at
most one catalog within a workspace (see [`workspaces.md`](workspaces.md)).

```yaml
catalogs:
  - id: support-docs
    description: "Customer-facing support docs"
    vectorStore: support-vectors
    chunker: default
    embedder: openai-small
```

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `id` | string | yes | Unique within the workspace. |
| `description` | string | no | Human-readable. |
| `vectorStore` | string | yes | Vector store id (see below). |
| `chunker` | string | no (Phase 3+) | Reference to a chunker definition. |
| `embedder` | string | no (Phase 3+) | Reference to an embedder definition. |

The `vectorStore` value references a vector store defined in the same
workspace:

```yaml
vectorStores:
  - id: support-vectors
    collection: support_vectors     # Astra collection name
    dimensions: 1536
    metric: cosine
```

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `id` | string | yes | Unique within the workspace. |
| `collection` | string | yes | Underlying Astra collection. |
| `dimensions` | int | yes | Vector dimensionality. |
| `metric` | enum | no | `cosine` (default), `dot`, `euclidean`. |

#### `embedders` and `chunkers` (Phase 3+)

Reserved top-level lists, referenced by name from catalogs:

```yaml
embedders:
  - id: openai-small
    provider: openai
    model: text-embedding-3-small
    apiKey: ${OPENAI_API_KEY}

chunkers:
  - id: default
    strategy: recursive
    chunkSize: 800
    chunkOverlap: 120
```

Full schemas will be defined when Phase 3 starts.

## Validation rules

At startup the runtime enforces:

- All `id` fields unique within their scope.
- Every `catalog.vectorStore` resolves to a `vectorStores[].id` in the same
  workspace.
- Each `vectorStores[].id` is referenced by **at most one** catalog (strict
  1:1 binding). Two catalogs naming the same vector store is a validation
  error.
- Every `catalog.embedder` / `catalog.chunker` resolves (once those sections
  land).
- Every `${VAR}` reference resolves or has a default.
- Driver-specific required fields are present (e.g. `astra.token` when
  `driver: astra`).

Validation failures abort startup with a non-zero exit code and a
human-readable error message naming the offending path.

## Hot reload

**Not supported in Phase 0.** A SIGHUP-driven reload is a candidate for a
later phase; the current model is "restart the process to pick up changes."

## Secrets handling

- Secrets must come from environment interpolation, never literal values in
  YAML checked into source control.
- The `/v1/workspaces/{id}` endpoint redacts any field whose key matches
  `token`, `apiKey`, `password`, or `secret` (case-insensitive).

## Example

See [`examples/workbench.yaml`](examples/workbench.yaml) for a fully annotated
sample config.
