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
- Streaming endpoints use `text/event-stream`. Today: async-ingest
  job progress at `GET /jobs/{jobId}/events`.

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
/api/v1/workspaces/{workspaceUid}
/api/v1/workspaces/{workspaceUid}/catalogs/{catalogUid}
/api/v1/workspaces/{workspaceUid}/vector-stores/{vectorStoreUid}
```

A request whose path references a non-existent workspace returns
`404 workspace_not_found` before the nested resource is ever
consulted.

### Pagination

Control-plane list endpoints accept:

- `limit` — number of items to return, 1–200, default 50.
- `cursor` — opaque value from the previous page's `nextCursor`.

Paginated responses use:

```json
{
  "items": [],
  "nextCursor": null
}
```

When `nextCursor` is non-null, pass it back as `?cursor=...` to read
the next page. Malformed cursors return `400 invalid_cursor`.

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
| 403 | `forbidden` | Token is valid but not authorized for the requested action — either the subject's `workspaceScopes` doesn't include the target workspace, or it's a scoped subject attempting a platform-level action (e.g. `POST /workspaces`). Also reserved for role-based checks in the upcoming RBAC phase. |
| 413 | `payload_too_large` | `/api/v1/workspaces/*` request body exceeded the runtime's 1 MB JSON body limit. |
| 404 | `not_found` | Unknown route |
| 404 | `workspace_not_found` | Workspace UID doesn't exist |
| 404 | `catalog_not_found` | Catalog UID doesn't exist in workspace |
| 404 | `vector_store_not_found` | Vector-store UID doesn't exist in workspace |
| 404 | `document_not_found` | Document UID doesn't exist in the catalog |
| 404 | `job_not_found` | Job ID doesn't exist in the workspace |
| 404 | `saved_query_not_found` | Saved query UID doesn't exist in the catalog |
| 409 | `conflict` | Create with an already-taken UID |
| 409 | `catalog_not_bound_to_vector_store` | Catalog-scoped search against a catalog whose `vectorStore` is `null` |
| 501 | `hybrid_not_supported` | Caller asked for hybrid search on a workspace kind whose driver doesn't implement `searchHybrid` |
| 501 | `rerank_not_supported` | Caller asked for rerank on a workspace kind whose driver doesn't implement `rerank` |
| 409 | `catalog_not_bound_to_vector_store` | Catalog-scoped search, ingest, or saved-query run against a catalog whose `vectorStore` is `null` |
| 400 | `dimension_mismatch` | Supplied vector length doesn't match the vector-store descriptor |
| 400 | `embedding_unavailable` | Text search/upsert fallback could not build an embedder for the descriptor |
| 400 | `embedding_dimension_mismatch` | Embedder output dimension doesn't match the descriptor |
| 422 | `workspace_misconfigured` | Workspace is missing endpoint, token, keyspace, or similar driver-required config |
| 500 | `internal_error` | Unhandled exception |
| 503 | `control_plane_unavailable` | Backing store is unreachable |
| 503 | `collection_unavailable` | Underlying vector collection is unreachable or missing |
| 503 | `driver_unavailable` | Workspace kind has no registered vector-store driver |

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

API-key issuance, OIDC bearer verification, browser OIDC login, and
silent token refresh are all implemented. All verifier modes flow
through the same middleware — routes don't need to care which
verifier accepted the token. Browser-only `/auth/*` routes
(`/auth/config`, `/auth/login`, `/auth/callback`, `/auth/me`,
`/auth/refresh`, `/auth/logout`) are documented in
[`auth.md`](auth.md) rather than here.

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

Readiness. `200` once the control-plane store is reachable and
workspaces can be listed. The payload carries a workspace count
rather than a list — avoids O(N) responses when the store grows.

```json
{ "status": "ready", "workspaces": 3 }
```

Returns `503 draining` during graceful shutdown (`SIGINT` /
`SIGTERM`). Kubernetes-style readiness probes will stop routing
traffic while the runtime finishes in-flight requests. See
[`configuration.md`](configuration.md#graceful-shutdown) for the
drain sequence. `/healthz` stays `200` throughout so
`livenessProbe` doesn't restart a healthy, draining process.

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

**Response 200** — paginated `Workspace` records:

```json
{
  "items": [
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
  ],
  "nextCursor": null
}
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

### `GET /api/v1/workspaces/{workspaceUid}`

Fetch a single workspace.

- **200** — `Workspace`
- **404** `workspace_not_found`

### `PUT /api/v1/workspaces/{workspaceUid}`

Patch one or more of `name`, `endpoint`, `credentialsRef`,
`keyspace`. Every field is optional; omitted fields are preserved.

`kind` and `uid` are immutable after creation and are rejected with
`400`. Unknown fields are likewise rejected (strict body).

- **200** — updated `Workspace`
- **400** — body contains `kind` or an unknown field
- **404** `workspace_not_found`

### `DELETE /api/v1/workspaces/{workspaceUid}`

Cascades to the workspace's catalogs, vector-store descriptors, and
documents. Before removing the control-plane rows, the runtime drops
each underlying vector-store collection through the workspace's driver.

- **204** — deleted
- **404** `workspace_not_found`
- **503** `driver_unavailable` — workspace has vector stores but no
  registered driver to drop their collections

### `POST /api/v1/workspaces/{workspaceUid}/test-connection`

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

## `/api/v1/workspaces/{workspaceUid}/api-keys`

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

- **200** — paginated `ApiKey` records
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

## `/api/v1/workspaces/{workspaceUid}/catalogs`

### `GET`

List catalogs in the workspace.

- **200** — paginated `Catalog` records
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
- **404** `vector_store_not_found` — `vectorStore` points at a missing descriptor
- **409** `conflict` — `uid` collision

### `GET /{catalogUid}` / `PUT /{catalogUid}` / `DELETE /{catalogUid}`

Fetch / patch / delete. `DELETE` cascades to the catalog's documents.

---

## `/api/v1/workspaces/{workspaceUid}/vector-stores`

### `GET`

List vector-store descriptors in the workspace.

- **200** — paginated `VectorStore` records
- **404** `workspace_not_found`

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

### `GET /discoverable`

List collections that exist in the workspace's data plane but aren't
yet wrapped in a workbench descriptor — useful for adopting
collections created by another tool, by hand, or by an older
workbench install whose control-plane state was lost. Returns `[]`
for drivers that don't expose external collections (the mock
driver).

```json
[
  {
    "name": "legacy_openai_coll",
    "vectorDimension": 1536,
    "vectorSimilarity": "cosine",
    "embedding": { "provider": "openai", "model": "text-embedding-3-small" },
    "lexicalEnabled": true,
    "rerankEnabled": false,
    "rerankProvider": null,
    "rerankModel": null
  }
]
```

- **200** — list of `AdoptableCollection`s (already-adopted
  collections are filtered out)
- **404** `workspace_not_found`
- **503** `driver_unavailable` — no driver registered for the
  workspace's `kind`

### `POST /adopt`

Wrap an existing data-plane collection in a workbench descriptor
without re-provisioning it. The route reads the live collection's
vector / lexical / rerank options off the data plane and stamps a
descriptor matching them; the descriptor's `name` equals the
collection's name (which is already a valid Astra identifier by
construction).

**Request:**

```json
{ "collectionName": "legacy_openai_coll" }
```

- **201** — the created `VectorStore` descriptor
- **404** `collection_not_found` — the named collection isn't on
  the data plane (or the driver no longer reports it)
- **409** `collection_already_adopted` — a descriptor with that name
  already exists in this workspace
- **503** `adopt_not_supported` — driver doesn't expose
  `listAdoptable`

Vectorless / vector-only collections (no `$vectorize` service
configured) get a placeholder `embedding: { provider: "external",
model: "external", … }` — clients still need to supply vectors at
upsert / search time. Create a new vector store when you need a
different provider or dimension; descriptors intentionally mirror the
underlying collection and are immutable after creation.

### `GET /{vectorStoreUid}` / `PUT /{vectorStoreUid}` / `DELETE /{vectorStoreUid}`

`GET` reads the descriptor. `PUT` accepts an empty patch and returns
the existing descriptor, but rejects any field changes with
`409 conflict` because dimensions, similarity, embedding, lexical,
rerank, and collection naming are physical collection properties.
`DELETE` drops the underlying Data API Collection **and** removes the descriptor.
If any catalog still references the vector store, `DELETE` returns
`409 conflict`; clear or move those catalog bindings first.

### `POST /{vectorStoreUid}/records` — upsert records

**Request** — each record carries exactly one of `vector` or `text`:

```json
{
  "records": [
    { "id": "doc-1", "vector": [0.01, -0.02, ...], "payload": { "title": "…" } },
    { "id": "doc-2", "text": "winter sweater in blue" },
    { "id": "doc-3", "text": "summer shorts", "payload": { "tag": "apparel" } }
  ]
}
```

- `records` — 1..500 items per request.
- `id` is the application's identifier; re-upsert replaces the prior
  value.
- `vector.length` must equal the descriptor's `vectorDimension`.
- **Text dispatch** mirrors search: the route tries
  `driver.upsertByText()` for all-text batches (Astra `$vectorize`
  inserts for collections with a service block). On
  `NotSupportedError` the runtime embeds each text record via the
  vector store's `embedding` config and retries through plain
  `upsert`. Mixed batches always embed client-side so the whole
  batch stays in one transactional call. See
  [`docs/playground.md`](playground.md).

**Response 200**

```json
{ "upserted": 2 }
```

- **400** `validation_error` — a record has neither or both of `vector`/`text`
- **400** `dimension_mismatch` — at least one vector has the wrong length
- **400** `embedding_unavailable` — text records + descriptor's embedding config can't be resolved
- **400** `embedding_dimension_mismatch` — provider returned a vector whose length doesn't match the descriptor
- **404** `workspace_not_found` / `vector_store_not_found`

### `DELETE /{vectorStoreUid}/records/{recordId}`

Delete a single record. `recordId` is the application's `id` (not a
UUID — any non-empty string).

**Response 200**

```json
{ "deleted": true }    // or false, if the record wasn't present
```

### `POST /{vectorStoreUid}/search` — vector or text search

**Request** — exactly one of `vector` or `text`:

```json
{
  "vector": [0.01, -0.02, ...],
  "topK": 10,
  "filter": { "tag": "keep" },
  "includeEmbeddings": false
}
```

```json
{
  "text": "winter sweater in blue",
  "topK": 10
}
```

- `topK` defaults to 10, clamped to `[1, 1000]`.
- `filter` is shallow-equal on payload keys. Backends with richer
  filter languages may accept more; the portable subset is
  shallow-equal.
- `includeEmbeddings: true` returns the stored vector on each hit.

**Text dispatch**: the route tries the driver's `searchByText()`
first — for Astra collections whose descriptor names a supported
vectorize provider (`openai`, `azureOpenAI`, `cohere`, `jinaAI`,
`mistral`, `nvidia`, `voyageAI`) and carries a `secretRef`, the
driver opens a collection handle with the resolved API key as
`embeddingApiKey` and issues `find(sort: { $vectorize: text })`.
The runtime never sees or transmits the vector. Legacy
collections (no `service` block) return a "vectorize not
configured" error; the driver catches it and rethrows as
`NotSupportedError`, after which the runtime falls back to a
client-side embedding (built from the vector store's `embedding`
config via the Vercel AI SDK) and runs a normal vector search.
See [`docs/playground.md`](playground.md) for the mental model.

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

- **400** `validation_error` — neither or both of `vector`/`text`
- **400** `dimension_mismatch` — supplied vector length mismatched
- **400** `embedding_unavailable` — text search but the vector
  store's `embedding` config can't be resolved (missing secret,
  unknown provider, ...)
- **400** `embedding_dimension_mismatch` — provider returned a
  vector whose length doesn't match the store's declared dim
- **404** `workspace_not_found` / `vector_store_not_found`

---

## `/api/v1/workspaces/{workspaceUid}/catalogs/{catalogUid}/documents`

Document **metadata** CRUD. A `Document` is a named entry in a
catalog — the metadata row the in-process ingest pipeline attaches
vectors to. `PUT` updates metadata only; content changes go through
`POST /ingest` (sync) or `POST /ingest?async=true` (returns 202 with
a job pointer), both documented further down.

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
failed`. The in-process ingest pipeline (sync + async) is the
canonical writer of `status` / `errorMessage` / `chunkTotal` /
`ingestedAt`. Clients can also set these directly via `PUT` so an
external ingest driver can own the lifecycle if it prefers.

### `GET`

List documents in the catalog.

- **200** — paginated `Document` records
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

### `GET /{documentUid}` / `PUT /{documentUid}` / `DELETE /{documentUid}`

Fetch / patch / delete. `PUT` accepts every field from the create body
(all optional) and updates only the fields present. Cross-catalog
access — requesting a document from a catalog it does not belong to —
returns `404 document_not_found`.

`DELETE` cascades into the bound vector store: the document's chunks
(matched by `payload.documentUid`) are removed before the document
row is dropped, so a successful delete leaves no traces in
catalog-scoped search. Drivers exposing `deleteRecords` use a single
bulk call; older drivers fall back to a `listRecords` + per-row
delete loop. Catalogs with no `vectorStore` binding skip the cascade
and only drop the row.

### `GET /{documentUid}/chunks`

Lists the chunks the ingest pipeline extracted from this document.
Reads raw records out of the catalog's bound vector store filtered
on `documentUid`, sorts by the `chunkIndex` payload key, and
returns:

```json
[
  {
    "id": "<documentUid>:0",
    "chunkIndex": 0,
    "text": "First paragraph about apples.",
    "payload": {
      "catalogUid": "…",
      "documentUid": "…",
      "chunkIndex": 0,
      "chunkText": "First paragraph about apples.",
      "source": "seed"
    }
  }
]
```

Query params:

- `limit` (1–1000, default 1000) — caps the number of chunks
  returned.

The ingest pipeline stamps the chunk's text into the reserved
`chunkText` payload key, so the response always carries the source
text — even on collections with no `$vectorize` round-trip.
Records ingested before the `chunkText` key landed return
`text: null`.

- **200** — array of chunks, sorted by `chunkIndex` ascending
- **404** `workspace_not_found` / `catalog_not_found` /
  `document_not_found` / `vector store_not_found`
- **409** `catalog_not_bound_to_vector_store`
- **501** `list_records_not_supported` — driver doesn't expose
  `listRecords`

### `POST /search`

Catalog-scoped vector / text search. Delegates to the vector store
bound at `catalog.vectorStore`, merging `catalogUid = catalog.uid`
into the effective filter so records outside the catalog are
invisible.

**Request** — identical envelope to
`POST /vector-stores/{vectorStoreUid}/search`. Either `vector` OR `text` is
required; never both.

```json
{
  "text": "how do refunds work?",
  "topK": 5,
  "filter": { "section": "billing" },
  "hybrid": true,
  "lexicalWeight": 0.3,
  "rerank": true
}
```

**Response** — `200` array of `SearchHit`, highest score first.

**Scope merging.** The server sets `filter.catalogUid` to the path's
catalog UID unconditionally. Any caller-supplied `catalogUid` is
overridden — a search can never escape its catalog. Other filter
keys merge normally.

**Hybrid + rerank lanes.**

- `hybrid: true` runs the driver's combined vector + lexical lane.
  Defaults to the bound store's `lexical.enabled`. Requires `text` —
  the lexical signal has nothing to score against without it.
  `lexicalWeight` (0..1, default 0.5) tunes how much the lexical
  score contributes vs. the vector score.
- `rerank: true` post-processes the retrieval hits through the
  driver's reranker. Defaults to the bound store's
  `reranking.enabled`. Also requires `text`.

Drivers can support either, both, or neither.

- `mock` — supports both when the descriptor's `embedding.provider`
  is `"mock"`. Hybrid and rerank are two separate phases in the
  dispatcher.
- `astra` — supports hybrid natively via `findAndRerank` (astra-
  db-ts's built-in API). Requires the descriptor to opt into both
  `lexical.enabled: true` **and** `reranking.enabled: true` — the
  collection is provisioned with a lexical index and reranker
  service at create time. Standalone `rerank` is **not** exposed on
  Astra because the Data API combines retrieval + reranking in one
  call; callers that want rerank set `hybrid: true`. `lexicalWeight`
  is ignored on Astra — the reranker owns the blend. A
  `rerank: true` request against an Astra workspace therefore
  returns 501 unless paired with `hybrid: true`.

**Errors**

- **400** `validation_error` — `vector` / `text` presence rules,
  including "hybrid: true requires text" and "rerank: true requires
  text"
- **400** `embedding_unavailable` — the fallback embedder could not be
  built (text path only)
- **400** `embedding_dimension_mismatch` — provider returned a vector
  whose length doesn't match the bound store's declared dim
- **404** `workspace_not_found` / `catalog_not_found`
- **404** `vector_store_not_found` — the binding exists but the
  referenced store no longer does (stale binding)
- **409** `catalog_not_bound_to_vector_store` — `catalog.vectorStore`
  is `null`
- **501** `hybrid_not_supported` / `rerank_not_supported` — the
  workspace kind's driver doesn't implement the requested lane

Text records written through `POST /ingest` carry a `catalogUid`
stamp on every chunk payload — that's what lets this route scope
correctly. The route also works against any records that carry a
matching `catalogUid` regardless of how they arrived.

### `POST /ingest`

Synchronous end-to-end ingest. Chunks the input text, embeds every
chunk (server-side via `$vectorize` where the bound store supports
it, otherwise client-side via the descriptor's `embedding` config),
upserts the chunks into the bound vector store, and creates a
`Document` metadata row with `status: ready` + `chunkTotal`.

**Request**

```json
{
  "text": "Apples are red. Bananas are yellow.",
  "sourceFilename": "fruit.md",
  "metadata": { "source": "seed" },
  "chunker": { "maxChars": 1000, "minChars": 100, "overlapChars": 150 }
}
```

All fields except `text` are optional. `chunker` overrides the
runtime defaults for this call only. `metadata` is merged onto every
chunk's payload; the reserved keys `catalogUid`, `documentUid`, and
`chunkIndex` are always set by the runtime and will override any
caller-supplied values. `text` is capped at 200,000 characters.

**Response 201**

```json
{
  "document": { "status": "ready", "chunkTotal": 3, "...": "..." },
  "chunks": 3
}
```

**Chunk payloads.** Every chunk upserted to the vector store carries:

- `catalogUid` — the catalog's UID (used by `/documents/search`)
- `documentUid` — the UID of the `Document` row this ingest created
- `chunkIndex` — 0-based position within the source document
- `chunker.id` — the chunker impl that produced the slice
  (`recursive-char:1` today)
- Plus every caller-supplied `metadata` key

**Errors**

- **400** `validation_error` — missing/empty `text`, bad chunker
  config, or the Zod schema otherwise fails
- **400** `embedding_unavailable` — client-side embedding fallback
  could not build an embedder (missing secret, etc.)
- **400** `embedding_dimension_mismatch` — embedder dimension
  disagrees with the bound store
- **404** `workspace_not_found` / `catalog_not_found`
- **404** `vector_store_not_found` — stale binding (catalog points at
  a deleted store)
- **409** `catalog_not_bound_to_vector_store` — `catalog.vectorStore`
  is `null`

**Failure semantics.** When chunking or upsert throws, the
`Document` row is marked `status: failed` with `errorMessage` before
the error is re-raised. Operators can inspect the row via
`GET /documents/{documentUid}`.

### `POST /ingest?async=true`

Same request body as the sync variant. The pipeline runs in the
background; the response returns immediately with a job pointer so
the UI doesn't block on long uploads.

**Response 202**

```json
{
  "job": {
    "workspace": "…",
    "jobId": "…",
    "kind": "ingest",
    "catalogUid": "…",
    "documentUid": "…",
    "status": "pending",
    "processed": 0,
    "total": null,
    "result": null,
    "errorMessage": null,
    "createdAt": "…",
    "updatedAt": "…"
  },
  "document": { "status": "writing", "…": "…" }
}
```

Errors are the same set as the sync path — validation /
embedding / not-found / 409. A 4xx means the request was rejected
outright; nothing was enqueued and no job row exists.

Once a job is running, failures are captured into the job record
(`status: failed`, `errorMessage` populated) and the document row
(also `status: failed`). The HTTP response has already been sent by
then.

**Progress callbacks.** The background worker reports
`{processed, total}` via `JobStore.update`. Today it fires once
before upsert (`processed: 0`) and once after (`processed: total`);
later slices can emit per-batch updates without a contract change.

---

## `/api/v1/workspaces/{workspaceUid}/jobs/{jobId}`

Job poll surface for anything that runs in the background. Today
only async ingest creates jobs; future bulk ops (reindex, export,
batch delete) plug in with the same record shape.

### `GET /{jobId}`

Point-in-time fetch, suitable for polling. Returns the `Job`
record described above.

- **200** — `Job`
- **404** `job_not_found`

### `GET /{jobId}/events`

Server-Sent Events stream. Emits `event: job` with the full record
as JSON on every update, plus a final `event: done` carrying
`{ status }` when the job hits a terminal state. The current record
is replayed as the first `job` event so clients don't race the
first update.

Headers: `Content-Type: text/event-stream`, `Cache-Control:
no-cache`.

Single-replica only at this slice — the `JobStore` pub/sub lives
in-process. Cross-process job fan-out (Redis etc.) ships alongside
persistent job backends.

### Job record

| Field | Type | Notes |
|---|---|---|
| `workspace` | uuid | Owning workspace |
| `jobId` | uuid | |
| `kind` | `"ingest"` | Discriminator — more kinds arrive with more async ops |
| `catalogUid` | uuid or null | Set for ingest jobs |
| `documentUid` | uuid or null | Set for ingest jobs |
| `status` | `"pending"` \| `"running"` \| `"succeeded"` \| `"failed"` | Terminal: succeeded, failed |
| `processed` | int | Units completed |
| `total` | int or null | Units expected (null if unknown) |
| `result` | object or null | Kind-specific summary on success (ingest: `{ chunks: N }`) |
| `errorMessage` | string or null | Populated on `failed` |
| `createdAt` | iso-8601 | |
| `updatedAt` | iso-8601 | |

**Persistence.** The job store auto-matches the control-plane
driver:

- `controlPlane.driver: memory` → jobs live in-process (lost on
  restart).
- `controlPlane.driver: file` → jobs serialize to
  `<controlPlane.root>/jobs.json` alongside workspaces.json, survive
  restart.
- `controlPlane.driver: astra` → jobs live in `wb_jobs_by_workspace`,
  reusing the existing Data API connection; durable across restart
  and across replicas.

In-flight jobs (`pending` / `running` at restart) are NOT resumed —
the worker that owned them is gone. The record keeps its
pre-restart status until a human or a follow-up slice with a
resume-worker promotes it to `failed`. Callers that need
restart-resume today should treat any `running` job older than a
heartbeat threshold as failed and resubmit.

---

## `/api/v1/workspaces/{workspaceUid}/catalogs/{catalogUid}/queries`

Saved search recipes scoped to a catalog. Each `SavedQuery` carries a
`text` plus optional `topK` and `filter`, and is replayed through the
catalog-scoped search path by `POST /{queryUid}/run`.

Deleting a workspace or catalog cascades to its saved queries (every
backend — memory, file, astra).

A `SavedQuery`:

```json
{
  "workspace": "…",
  "catalogUid": "…",
  "queryUid": "…",
  "name": "refunds",
  "description": "billing questions",
  "text": "how do refunds work?",
  "topK": 5,
  "filter": { "section": "billing" },
  "createdAt": "…",
  "updatedAt": "…"
}
```

Text-only by design — saved vectors are rarely the right abstraction
and serialize heavily. Callers wanting vector-form queries write the
search body directly against `POST /documents/search`.

### `GET`

List saved queries in the catalog.

- **200** — paginated `SavedQuery` records
- **404** `workspace_not_found` / `catalog_not_found`

### `POST`

Create a saved query. `uid` is optional.

```json
{
  "name": "refunds",
  "description": "billing questions",
  "text": "how do refunds work?",
  "topK": 5,
  "filter": { "section": "billing" }
}
```

- **201** — the created `SavedQuery`
- **404** `workspace_not_found` / `catalog_not_found`
- **409** `conflict` — `uid` collision within the same catalog

### `GET /{queryUid}` / `PUT /{queryUid}` / `DELETE /{queryUid}`

Fetch / patch / delete. `PUT` accepts every field from create (all
optional). Deleting a non-existent query returns
`404 saved_query_not_found`.

### `POST /{queryUid}/run`

Execute a saved query and return the hits. The catalog's UID is
merged into the effective filter — a saved filter carrying a
different `catalogUid` is silently overridden, so a saved query can
never escape its catalog.

**Response 200** — array of `SearchHit` (same shape as
`/documents/search`).

**Errors**

- **400** `embedding_unavailable` / `embedding_dimension_mismatch`
  (client-side embedding fallback path)
- **404** `workspace_not_found` / `catalog_not_found` /
  `saved_query_not_found` / `vector_store_not_found`
- **409** `catalog_not_bound_to_vector_store`

---

## Planned routes

These do not exist yet. Shapes may shift before they land.

The Phase 2 routes (saved queries CRUD + `/run`, async ingest, jobs
poll + SSE) and the Phase 3 playground dispatch (text/vector via the
existing `POST .../search` route) shipped in #53–#60 and are
documented above.

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
