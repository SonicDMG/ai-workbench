# API Spec

The AI Workbench HTTP contract. Every green box — the default
TypeScript runtime and any future language-native runtime — serves this
surface. Conformance is enforced by
[cross-runtime fixtures](./conformance.md).

The machine-readable OpenAPI document is served at
`/api/v1/openapi.json`, and a Scalar-rendered reference UI is served
at `/docs`. This document exists to explain the shape narratively and
to flag what's coming.

## Conventions

### Base URL and versioning

- Functional routes live under `/api/v1/…`.
- Operational routes (`/`, `/healthz`, `/readyz`, `/version`, `/docs`)
  are unversioned.
- Breaking changes bump the prefix to `/api/v2/…`; `/api/v1/…` stays
  until deprecated.

### Content type

- Request and response bodies are JSON (`application/json`).
- Streaming endpoints (future: ingestion progress) will use
  `text/event-stream`.

### Identifiers

- All UIDs are RFC 4122 v4 UUIDs rendered as lowercase hyphenated
  strings.
- Timestamps are ISO-8601 in UTC with millisecond precision
  (`2026-04-22T10:11:12.345Z`).
- Secrets never appear by value. Fields like `credentialsRef` or
  `embedding.secretRef` hold pointers of the form `<provider>:<path>`
  (e.g. `env:ASTRA_DB_APPLICATION_TOKEN`).

### Resource scoping

Every nested resource carries its parent UIDs in the path:

```
/api/v1/workspaces/{workspaceId}
/api/v1/workspaces/{workspaceId}/catalogs/{catalogId}
/api/v1/workspaces/{workspaceId}/vector-stores/{vectorStoreId}
```

A request whose path references a non-existent workspace returns
`404 workspace_not_found` before the nested resource is ever
consulted.

### Error envelope

All error responses share one envelope:

```json
{
  "error": {
    "code": "workspace_not_found",
    "message": "workspace '<uid>' not found",
    "requestId": "b48e…"
  }
}
```

Codes are stable, lowercase, `snake_case`. Messages are
human-readable and may change. Currently emitted:

| Status | Code | When |
|---|---|---|
| 400 | (Zod-generated) | Request body / params fail validation |
| 404 | `not_found` | Unknown route |
| 404 | `workspace_not_found` | Workspace UID doesn't exist |
| 404 | `catalog_not_found` | Catalog UID doesn't exist in workspace |
| 404 | `vector_store_not_found` | Vector-store UID doesn't exist in workspace |
| 409 | `conflict` | Create with an already-taken UID |
| 500 | `internal_error` | Unhandled exception |
| 503 | `control_plane_unavailable` | Backing store is unreachable |

### Authentication

**Not enforced today.** The runtime sits behind whatever auth boundary
the operator deploys in front of it (a reverse proxy, an API gateway,
etc.).

Workspace-scoped API keys (`wb_workspace_api_keys`) are planned for
Phase 2+ — see [`roadmap.md`](roadmap.md).

### Request ID

Every response carries `X-Request-Id`. If the client supplies one,
the runtime echoes it; otherwise the runtime generates a UUID-hex
string. Error responses include the same value in `error.requestId`.

---

## Operational routes

### `GET /`

Service banner.

**Response 200**

```json
{
  "name": "ai-workbench",
  "version": "0.0.0",
  "commit": "abc1234",
  "docs": "/docs"
}
```

### `GET /healthz`

Liveness. Returns `200` as long as the process is running.

```json
{ "status": "ok" }
```

### `GET /readyz`

Readiness. Returns `200` once the control-plane store is reachable
and workspaces can be listed. The payload carries a workspace count
rather than a list — avoids O(N) responses when the store grows.

```json
{ "status": "ready", "workspaces": 3 }
```

### `GET /version`

Build metadata.

```json
{
  "version": "0.0.0",
  "commit": "abc1234",
  "buildTime": "2026-04-21T10:30:00Z",
  "node": "v22.11.0"
}
```

### `GET /docs`

Scalar-rendered OpenAPI reference UI. Human-facing.

### `GET /api/v1/openapi.json`

Machine-readable OpenAPI 3.1 document. Generated from the route
definitions — always in sync with the running runtime.

---

## `/api/v1/workspaces`

### `GET /api/v1/workspaces`

List all workspaces.

**Response 200** — array of `Workspace`:

```json
[
  {
    "uid": "…",
    "name": "prod",
    "url": null,
    "kind": "astra",
    "credentialsRef": { "token": "env:ASTRA_DB_APPLICATION_TOKEN" },
    "keyspace": "default_keyspace",
    "createdAt": "2026-04-22T10:11:12.345Z",
    "updatedAt": "2026-04-22T10:11:12.345Z"
  }
]
```

### `POST /api/v1/workspaces`

Create a workspace. `uid` is optional — the runtime generates one if
omitted.

**Request**

```json
{
  "name": "prod",
  "kind": "astra",
  "credentialsRef": { "token": "env:ASTRA_DB_APPLICATION_TOKEN" },
  "keyspace": "default_keyspace"
}
```

`kind` is one of `astra | hcd | openrag | mock`. (`mock` stays a
first-class option for CI and offline work.)

**Response 201** — the created `Workspace`.

### `GET /api/v1/workspaces/{workspaceId}`

Fetch a single workspace.

- **200** — `Workspace`
- **404** `workspace_not_found`

### `PUT /api/v1/workspaces/{workspaceId}`

Patch one or more fields. The body is identical to the create body
with every field optional (except `uid`, which is read-only).

- **200** — updated `Workspace`
- **404** `workspace_not_found`

### `DELETE /api/v1/workspaces/{workspaceId}`

Cascades to the workspace's catalogs, vector-store descriptors, and
documents.

- **204** — deleted
- **404** `workspace_not_found`

---

## `/api/v1/workspaces/{workspaceId}/catalogs`

### `GET`

List catalogs in the workspace.

- **200** — array of `Catalog`
- **404** `workspace_not_found`

A `Catalog`:

```json
{
  "workspace": "…",
  "uid": "…",
  "name": "support",
  "description": null,
  "vectorStore": "…",
  "createdAt": "…",
  "updatedAt": "…"
}
```

### `POST`

Create a catalog. `vectorStore` is optional and refers to a vector
store in the same workspace (N:1 — multiple catalogs may share a
single vector store).

**Request**

```json
{ "name": "support", "vectorStore": "<vector-store-uid>" }
```

- **201** — the created `Catalog`
- **404** `workspace_not_found`
- **409** `conflict` — `uid` collision

### `GET /{catalogId}` / `PUT /{catalogId}` / `DELETE /{catalogId}`

Fetch / patch / delete. `DELETE` cascades to the catalog's documents
(Phase 2+).

---

## `/api/v1/workspaces/{workspaceId}/vector-stores`

### `GET`

List vector-store descriptors in the workspace.

A `VectorStore` descriptor:

```json
{
  "workspace": "…",
  "uid": "…",
  "name": "support-vectors",
  "vectorDimension": 1536,
  "vectorSimilarity": "cosine",
  "embedding": {
    "provider": "openai",
    "model": "text-embedding-3-small",
    "endpoint": null,
    "dimension": 1536,
    "secretRef": "env:OPENAI_API_KEY"
  },
  "lexical":   { "enabled": false, "analyzer": null, "options": {} },
  "reranking": { "enabled": false, "provider": null, "model": null, "endpoint": null, "secretRef": null },
  "createdAt": "…",
  "updatedAt": "…"
}
```

### `POST`

Create a descriptor. `vectorSimilarity` defaults to `cosine`;
`lexical` and `reranking` default to `{ enabled: false, ... }` if
omitted.

**Required fields:** `name`, `vectorDimension`, `embedding`.

- **201** — the created `VectorStore`
- **404** `workspace_not_found`
- **409** `conflict`

### `GET /{vectorStoreId}` / `PUT /{vectorStoreId}` / `DELETE /{vectorStoreId}`

Standard CRUD. These endpoints manage the **descriptor row only**;
the underlying Data API Collection holding vectors is a separate
artifact provisioned in Phase 1b.

---

## Planned routes

These do not exist yet. Shapes may shift before they land.

### Phase 1b — Vector-store data plane

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/api/v1/workspaces/{w}/vector-stores/{v}/records` | Upsert records |
| `DELETE` | `/api/v1/workspaces/{w}/vector-stores/{v}/records/{id}` | Delete one |
| `POST` | `/api/v1/workspaces/{w}/vector-stores/{v}/search` | Vector search |

`POST /vector-stores` in this phase also provisions the backing
Data API Collection (currently descriptor-only).

### Phase 2 — Documents, ingest, search, queries

| Method | Path | Purpose |
|---|---|---|
| (CRUD) | `/api/v1/workspaces/{w}/catalogs/{c}/documents[/{d}]` | Document metadata CRUD. `PUT` updates metadata only; content changes go through ingest. |
| `POST` | `/api/v1/workspaces/{w}/catalogs/{c}/ingest` | Chunk + embed + write (async job) |
| `GET` | `/api/v1/workspaces/{w}/jobs/{jobId}` | Poll an ingest job |
| `POST` | `/api/v1/workspaces/{w}/catalogs/{c}/documents/search` | Catalog-scoped hybrid search |
| (CRUD) | `/api/v1/workspaces/{w}/catalogs/{c}/queries[/{q}]` | Saved queries per catalog |

### Phase 3 — Playground

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/api/v1/workspaces/{w}/playground/query` | Free-form harness over catalog + vector store |

Also a static `/playground` UI route served by the runtime.

### Phase 4+ — Chats, MCP

Reserved:

- `/api/v1/workspaces/{w}/chats/…`
- `/api/v1/workspaces/{w}/mcp/…`

Contracts finalized as those phases approach.

---

## OpenAPI

The generated document at `/api/v1/openapi.json` is always in sync
with the running runtime (routes register their Zod schemas directly).
Share it with downstream tooling (client generators, API gateway
configs, etc.).

To consume locally:

```bash
curl -s http://localhost:8080/api/v1/openapi.json > openapi.json
```
