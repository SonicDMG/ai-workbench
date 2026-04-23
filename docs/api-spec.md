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
| 400 | `validation_error` | Request body / params / query failed Zod validation. `message` carries the first failing field path and its reason (`name: Name is required`, `credentialsRef.token: expected '<provider>:<path>', e.g. 'env:FOO'`). |
| 401 | `unauthorized` | Missing / malformed / invalid bearer token. `WWW-Authenticate: Bearer` set. See [`auth.md`](auth.md). |
| 403 | `forbidden` | Token is valid but the subject's `workspaceScopes` doesn't include the target workspace. Also reserved for role-based checks in the upcoming RBAC phase. |
| 404 | `not_found` | Unknown route |
| 404 | `workspace_not_found` | Workspace UID doesn't exist |
| 404 | `catalog_not_found` | Catalog UID doesn't exist in workspace |
| 404 | `vector_store_not_found` | Vector-store UID doesn't exist in workspace |
| 404 | `document_not_found` | Document UID doesn't exist in the catalog |
| 409 | `conflict` | Create with an already-taken UID |
| 500 | `internal_error` | Unhandled exception |
| 503 | `control_plane_unavailable` | Backing store is unreachable |

### Authentication

`/api/v1/*` runs through a configurable auth middleware. The
default posture (`auth.mode: disabled`) tags every request
anonymous and lets it through — same behavior as before the
middleware existed. Flip `auth.mode` to turn enforcement on. See
[`auth.md`](auth.md) for the full contract, config, and rollout
plan.

Header format is `Authorization: Bearer <token>` (RFC 6750). On
failure the response carries `WWW-Authenticate: Bearer` and the
canonical error envelope:

```json
{ "error": { "code": "unauthorized", "message": "…", "requestId": "…" } }
```

Operational routes (`/`, `/healthz`, `/readyz`, `/version`,
`/docs`, `/api/v1/openapi.json`) bypass the middleware so
load balancers and ops tooling can always reach them.

API-key issuance lands in a follow-up; OIDC after that. Both
flow through the same middleware — routes don't need to care
which verifier accepted the token.

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

List all workspaces, sorted by `createdAt` ascending with `uid` as
tie-breaker. Every backend (memory / file / astra) produces the same
ordering so UI renders are deterministic.

**Response 200** — array of `Workspace`:

```json
[
  {
    "uid": "…",
    "name": "prod",
    "endpoint": "env:ASTRA_DB_API_ENDPOINT",
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
  "endpoint": "env:ASTRA_DB_API_ENDPOINT",
  "credentialsRef": { "token": "env:ASTRA_DB_APPLICATION_TOKEN" },
  "keyspace": "default_keyspace"
}
```

`kind` is one of `astra | hcd | openrag | mock`. (`mock` stays a
first-class option for CI and offline work.) Once set, `kind` is
immutable — changing it would orphan any already-provisioned
vector-store collections.

`endpoint` is the workspace's data-plane URL (for `astra` / `hcd`,
the Astra Data API endpoint). Accepts either a literal URL or a
`SecretRef` — the driver resolves refs at dial time so the same
record works across dev and prod without code changes.

Each value in `credentialsRef` must be a `SecretRef`
(`<provider>:<path>`, e.g. `env:ASTRA_DB_APPLICATION_TOKEN` or
`file:/etc/workbench/secrets/astra-token`). Raw secret values are
rejected with `400`.

**Response 201** — the created `Workspace`.

### `GET /api/v1/workspaces/{workspaceId}`

Fetch a single workspace.

- **200** — `Workspace`
- **404** `workspace_not_found`

### `PUT /api/v1/workspaces/{workspaceId}`

Patch one or more of `name`, `endpoint`, `credentialsRef`,
`keyspace`. Every field is optional; omitted fields are preserved.

`kind` and `uid` are immutable after creation and are rejected with
`400`. Unknown fields are likewise rejected (strict body).

- **200** — updated `Workspace`
- **400** — body contains `kind` or an unknown field
- **404** `workspace_not_found`

### `DELETE /api/v1/workspaces/{workspaceId}`

Cascades to the workspace's catalogs, vector-store descriptors, and
documents.

- **204** — deleted
- **404** `workspace_not_found`

### `POST /api/v1/workspaces/{workspaceId}/test-connection`

Probe the workspace's credentials. Resolves every value in
`credentialsRef` via the runtime's `SecretResolver` and reports the
first failure. For `mock` workspaces, always returns `ok: true`
without touching any secrets. Verifies refs only — does NOT dial the
backend or validate a resolved token against the remote service.

**Response 200** — always 200 regardless of probe outcome; the
`ok` field distinguishes success from failure:

```json
{
  "ok": true,
  "kind": "astra",
  "details": "1 credential resolved. Note: this verifies refs only, not the backend token against the remote service."
}
```

```json
{
  "ok": false,
  "kind": "astra",
  "details": "credential 'token' could not be resolved: env var 'ASTRA_DB_APPLICATION_TOKEN' is not set"
}
```

- **200** — probe executed; inspect `ok` for pass/fail
- **404** `workspace_not_found`

---

## `/api/v1/workspaces/{workspaceId}/api-keys`

Workspace-scoped bearer tokens. Documented in [`auth.md`](auth.md);
re-capped here for the route contract.

### `GET`

List every key ever issued for the workspace, including revoked
ones. Never exposes the `hash` column.

An `ApiKey`:

```json
{
  "workspace": "…",
  "keyId": "…",
  "prefix": "abc123xyz789",
  "label": "ci",
  "createdAt": "…",
  "lastUsedAt": null,
  "revokedAt": null,
  "expiresAt": null
}
```

- **200** — array of `ApiKey`
- **404** `workspace_not_found`

### `POST`

Issue a new key. The plaintext is returned **exactly once** — the
runtime stores only a scrypt digest.

**Request**

```json
{ "label": "ci", "expiresAt": null }
```

**Response 201**

```json
{
  "plaintext": "wb_live_abc123xyz789_…",
  "key": { "...ApiKey..." }
}
```

- **201** — created; `plaintext` is the only time you'll see the token
- **400** — missing / empty label
- **404** `workspace_not_found`

### `DELETE /{keyId}`

Soft-revoke: stamps `revokedAt`, leaves the row visible so audit
tools still see the history. The next request bearing this token
gets `401 unauthorized`. Re-revoking an already-revoked key is a
no-op that still returns `204`.

- **204** — revoked (or was already revoked)
- **404** `workspace_not_found` / `api_key_not_found`

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

Fetch / patch / delete. `DELETE` cascades to the catalog's documents.

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

Create a descriptor **and** provision the underlying Data API
Collection via the workspace's driver. Transactional — if collection
provisioning fails, the descriptor row is rolled back so the control
plane and data plane never drift.

`vectorSimilarity` defaults to `cosine`; `lexical` and `reranking`
default to `{ enabled: false, ... }` if omitted.

**Required fields:** `name`, `vectorDimension`, `embedding`.

- **201** — the created `VectorStore` (collection now exists)
- **404** `workspace_not_found`
- **409** `conflict`
- **422** `workspace_misconfigured` — workspace is missing `endpoint` or `credentialsRef.token` required by its driver
- **503** `driver_unavailable` — no driver registered for the workspace's `kind`

### `GET /{vectorStoreId}` / `PUT /{vectorStoreId}` / `DELETE /{vectorStoreId}`

`GET` and `PUT` operate on the descriptor only. `DELETE` drops the
underlying Data API Collection **and** removes the descriptor.

`PUT` does NOT re-provision the collection — changing
`vectorDimension` on a populated store is a data-migration operation
not yet supported.

### `POST /{vectorStoreId}/records` — upsert vectors

**Request**

```json
{
  "records": [
    { "id": "doc-1", "vector": [0.01, -0.02, ...], "payload": { "title": "…" } },
    { "id": "doc-2", "vector": [...] }
  ]
}
```

- `records` — 1..500 items per request.
- `id` is the application's identifier; re-upsert replaces the prior
  value.
- `vector.length` must equal the descriptor's `vectorDimension`.

**Response 200**

```json
{ "upserted": 2 }
```

- **400** `dimension_mismatch` — at least one vector has the wrong length
- **404** `workspace_not_found` / `vector_store_not_found`

### `DELETE /{vectorStoreId}/records/{recordId}`

Delete a single record. `recordId` is the application's `id` (not a
UUID — any non-empty string).

**Response 200**

```json
{ "deleted": true }    // or false, if the record wasn't present
```

### `POST /{vectorStoreId}/search` — vector search

**Request**

```json
{
  "vector": [0.01, -0.02, ...],
  "topK": 10,
  "filter": { "tag": "keep" },
  "includeEmbeddings": false
}
```

- `topK` defaults to 10, clamped to `[1, 1000]`.
- `filter` is shallow-equal on payload keys. Backends with richer
  filter languages may accept more; the portable subset is
  shallow-equal.
- `includeEmbeddings: true` returns the stored vector on each hit.

**Response 200** — array of hits, sorted by `score` descending:

```json
[
  { "id": "doc-1", "score": 0.94, "payload": { "title": "…" } },
  { "id": "doc-2", "score": 0.87, "payload": { "title": "…" } }
]
```

Score semantics match the descriptor's `vectorSimilarity`:

| Metric | Score |
|---|---|
| `cosine` | Cosine similarity in `[-1, 1]`; 1 = exact match |
| `dot` | Raw dot product; unbounded |
| `euclidean` | `1 / (1 + distance)` so higher = closer |

- **400** `dimension_mismatch`
- **404** `workspace_not_found` / `vector_store_not_found`

---

## `/api/v1/workspaces/{workspaceId}/catalogs/{catalogId}/documents`

Document **metadata** CRUD. A `Document` is a named entry in a catalog
— the metadata row that the future ingest pipeline (chunk + embed)
attaches vectors to. `PUT` updates metadata only; content changes go
through `/ingest` once that lands in a later Phase 2 slice.

A `Document`:

```json
{
  "workspace": "…",
  "catalogUid": "…",
  "documentUid": "…",
  "sourceDocId": null,
  "sourceFilename": "readme.md",
  "fileType": "text/markdown",
  "fileSize": 1024,
  "md5Hash": null,
  "chunkTotal": null,
  "ingestedAt": null,
  "updatedAt": "…",
  "status": "pending",
  "errorMessage": null,
  "metadata": { "source": "upload" }
}
```

`status` is one of `pending | chunking | embedding | writing | ready |
failed`. Clients setting `status` / `errorMessage` / `chunkTotal` /
`ingestedAt` directly via `PUT` is supported today so an external
ingest driver can own the lifecycle; the in-process ingest pipeline
(later Phase 2 slice) will own these fields once it lands.

### `GET`

List documents in the catalog.

- **200** — array of `Document`
- **404** `workspace_not_found` / `catalog_not_found`

### `POST`

Register a document in the catalog.

**Request** — all fields optional except uniqueness of `uid` within
the catalog:

```json
{
  "sourceFilename": "readme.md",
  "fileType": "text/markdown",
  "fileSize": 1024,
  "metadata": { "source": "upload" }
}
```

- **201** — the created `Document` (`status` defaults to `pending`,
  `metadata` defaults to `{}`)
- **404** `workspace_not_found` / `catalog_not_found`
- **409** `conflict` — `uid` collision within the same catalog

### `GET /{documentId}` / `PUT /{documentId}` / `DELETE /{documentId}`

Fetch / patch / delete. `PUT` accepts every field from the create body
(all optional) and updates only the fields present. Cross-catalog
access — requesting a document from a catalog it does not belong to —
returns `404 document_not_found`.

---

## Planned routes

These do not exist yet. Shapes may shift before they land.

### Phase 2 — Ingest, search, queries

| Method | Path | Purpose |
|---|---|---|
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
