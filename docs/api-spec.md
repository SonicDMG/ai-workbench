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

- All IDs are RFC 4122 v4 UUIDs rendered as lowercase hyphenated
  strings.
- Timestamps are ISO-8601 in UTC with millisecond precision
  (`2026-04-22T10:11:12.345Z`).
- Secrets never appear by value. Fields like `credentials` or
  `embedding.secretRef` hold pointers of the form `<provider>:<path>`
  (e.g. `env:ASTRA_DB_APPLICATION_TOKEN`).

### Resource scoping

Every nested resource carries its parent IDs in the path:

```
/api/v1/workspaces/{workspaceId}
/api/v1/workspaces/{workspaceId}/knowledge-bases/{knowledgeBaseId}
/api/v1/workspaces/{workspaceId}/knowledge-bases/{kb}/documents/{documentId}
/api/v1/workspaces/{workspaceId}/{chunking,embedding,reranking}-services/{serviceId}
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
    "message": "workspace '<workspaceId>' not found",
    "requestId": "b48e…"
  }
}
```

Codes are stable, lowercase, `snake_case`. Messages are
human-readable and may change. Currently emitted:

| Status | Code | When |
|---|---|---|
| 400 | `validation_error` | Request body / params / query failed Zod validation. `message` carries the first failing field path and its reason (`name: Name is required`, `credentials.token: expected '<provider>:<path>', e.g. 'env:FOO'`). |
| 401 | `unauthorized` | Missing / malformed / invalid bearer token. `WWW-Authenticate: Bearer` set. See [`auth.md`](auth.md). |
| 403 | `forbidden` | Token is valid but not authorized for the requested action — either the subject's `workspaceScopes` doesn't include the target workspace, or it's a scoped subject attempting a platform-level action (e.g. `POST /workspaces`). Also reserved for role-based checks in the upcoming RBAC phase. |
| 413 | `payload_too_large` | `/api/v1/workspaces/*` request body exceeded the runtime's 1 MB JSON body limit. |
| 404 | `not_found` | Unknown route |
| 404 | `workspace_not_found` | Workspace ID doesn't exist |
| 404 | `knowledge_base_not_found` | Knowledge-base ID doesn't exist in workspace |
| 404 | `document_not_found` | Document ID doesn't exist in the knowledge base |
| 404 | `chunking_service_not_found` / `embedding_service_not_found` / `reranking_service_not_found` | Service ID doesn't exist in workspace |
| 404 | `job_not_found` | Job ID doesn't exist in the workspace |
| 409 | `conflict` | Create with an already-taken ID, or service deletion refused while a KB still references it |
| 501 | `hybrid_not_supported` | Caller asked for hybrid search on a workspace kind whose driver doesn't implement `searchHybrid` |
| 501 | `rerank_not_supported` | Caller asked for rerank on a workspace kind whose driver doesn't implement `rerank` |
| 400 | `dimension_mismatch` | Supplied vector length doesn't match the KB's bound embedding service |
| 400 | `embedding_unavailable` | Text search/upsert fallback could not build an embedder for the KB's bound embedding service |
| 400 | `embedding_dimension_mismatch` | Embedder output dimension doesn't match the bound embedding service |
| 422 | `workspace_misconfigured` | Workspace is missing url, token, keyspace, or similar driver-required config |
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

List all workspaces, sorted by `createdAt` ascending with `workspaceId` as
tie-breaker. Every backend (memory / file / astra) produces the same
ordering so UI renders are deterministic.

**Response 200** — paginated `Workspace` records:

```json
{
  "items": [
    {
      "workspaceId": "…",
      "name": "prod",
      "url": "env:ASTRA_DB_API_ENDPOINT",
      "kind": "astra",
      "credentials": { "token": "env:ASTRA_DB_APPLICATION_TOKEN" },
      "keyspace": "default_keyspace",
      "createdAt": "2026-04-22T10:11:12.345Z",
      "updatedAt": "2026-04-22T10:11:12.345Z"
    }
  ],
  "nextCursor": null
}
```

### `POST /api/v1/workspaces`

Create a workspace. `workspaceId` is optional — the runtime generates one if
omitted.

**Request**

```json
{
  "name": "prod",
  "kind": "astra",
  "url": "env:ASTRA_DB_API_ENDPOINT",
  "credentials": { "token": "env:ASTRA_DB_APPLICATION_TOKEN" },
  "keyspace": "default_keyspace"
}
```

`kind` is one of `astra | hcd | openrag | mock`. (`mock` stays a
first-class option for CI and offline work.) Once set, `kind` is
immutable — changing it would orphan any already-provisioned
KB collections.

`url` is the workspace's data-plane URL (for `astra` / `hcd`,
the Astra Data API endpoint). Accepts either a literal URL or a
`SecretRef` — the driver resolves refs at dial time so the same
record works across dev and prod without code changes.

Each value in `credentials` must be a `SecretRef`
(`<provider>:<path>`, e.g. `env:ASTRA_DB_APPLICATION_TOKEN` or
`file:/etc/workbench/secrets/astra-token`). Raw secret values are
rejected with `400`.

**Response 201** — the created `Workspace`.

### `GET /api/v1/workspaces/{workspaceId}`

Fetch a single workspace.

- **200** — `Workspace`
- **404** `workspace_not_found`

### `PATCH /api/v1/workspaces/{workspaceId}`

Patch one or more of `name`, `url`, `credentials`,
`keyspace`. Every field is optional; omitted fields are preserved.

`kind` and `workspaceId` are immutable after creation and are rejected with
`400`. Unknown fields are likewise rejected (strict body).

- **200** — updated `Workspace`
- **400** — body contains `kind` or an unknown field
- **404** `workspace_not_found`

### `DELETE /api/v1/workspaces/{workspaceId}`

Cascades to the workspace's knowledge bases, execution services,
RAG documents, and API keys. Before removing the control-plane
rows, the runtime drops each KB's underlying Astra collection
through the workspace's driver.

- **204** — deleted
- **404** `workspace_not_found`
- **503** `driver_unavailable` — workspace has knowledge bases but
  no registered driver to drop their collections

### `POST /api/v1/workspaces/{workspaceId}/test-connection`

Run a live workspace connection check. For `mock` workspaces, this
always returns `ok: true`. Remote backends resolve their configured
connection details and ask the driver to make a data-plane call.

**Response 200** — always 200 regardless of check outcome; the
`ok` field distinguishes success from failure:

```json
{
  "ok": true,
  "kind": "astra",
  "details": "Astra Data API responded to listCollections."
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
  "workspaceId": "…",
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

## `/api/v1/workspaces/{workspaceId}/{chunking,embedding,reranking}-services`

Workspace-scoped execution services. Knowledge bases compose one
chunking + one embedding + (optionally) one reranking service at
create time. The three surfaces share an identical CRUD shape; only
the body fields differ.

### `GET`

List services in the workspace.

- **200** — paginated `ChunkingService` / `EmbeddingService` /
  `RerankingService` records (sorted by `createdAt` ascending,
  `*ServiceId` as tie-breaker)
- **404** `workspace_not_found`

### `POST`

Create a service. The runtime generates the service ID if omitted.
Required fields by kind:

| Kind | Required |
|---|---|
| chunking | `name`, `engine` |
| embedding | `name`, `provider`, `modelName`, `embeddingDimension` |
| reranking | `name`, `provider`, `modelName` |

Optional fields cover endpoint config (`endpointBaseUrl`,
`endpointPath`, `requestTimeoutMs`, `authType`, `credentialRef`),
provider/engine tuning, and supported language/content tags. See
the OpenAPI spec for the full per-kind shape.

```json
{
  "name": "openai-3-small",
  "provider": "openai",
  "modelName": "text-embedding-3-small",
  "embeddingDimension": 1536,
  "distanceMetric": "cosine",
  "endpointBaseUrl": "https://api.openai.com/v1",
  "credentialRef": "env:OPENAI_API_KEY",
  "supportedLanguages": ["en", "fr"],
  "supportedContent": ["text"]
}
```

`supportedLanguages` and `supportedContent` arrive as arrays and are
returned deduplicated + sorted on the wire. (Astra-row layer keeps
them as `SET<TEXT>`; the converter normalises at the boundary.)

- **201** — the created record (with the generated `*ServiceId`)
- **400** `validation_error` — schema failure
- **404** `workspace_not_found`
- **409** `conflict` — `*ServiceId` collision

### `GET /{serviceId}` / `PATCH /{serviceId}` / `DELETE /{serviceId}`

Fetch / patch / delete. `PATCH` accepts every field from create
(all optional). Strict bodies — unknown keys return `400`.

`DELETE` is **refused with `409 conflict` while any KB still
references the service**. Drop or rebind the dependent KBs first.
The error message names the offending KB so operators can navigate
straight to it.

---

## `/api/v1/workspaces/{workspaceId}/knowledge-bases`

### `GET`

List knowledge bases in the workspace.

- **200** — paginated `KnowledgeBase` records
- **404** `workspace_not_found`

A `KnowledgeBase`:

```json
{
  "workspaceId": "…",
  "knowledgeBaseId": "…",
  "name": "support-docs",
  "description": "customer support knowledge base",
  "status": "active",
  "embeddingServiceId": "…",
  "chunkingServiceId": "…",
  "rerankingServiceId": null,
  "language": "en",
  "vectorCollection": "wb_vectors_<kb_id>",
  "lexical": { "enabled": false, "analyzer": null, "options": {} },
  "createdAt": "…",
  "updatedAt": "…"
}
```

### `POST`

Create a KB **and** auto-provision its underlying Astra collection.
Transactional — if collection provisioning fails, the KB row is
rolled back so the control plane and data plane never drift.

`vectorCollection` is generated as `wb_vectors_<kb_id>` (hyphen-
stripped) by default; supply your own to adopt a pre-existing
collection.

**Request**

```json
{
  "name": "support-docs",
  "description": "customer support",
  "embeddingServiceId": "…",
  "chunkingServiceId": "…",
  "rerankingServiceId": null,
  "language": "en"
}
```

`embeddingServiceId` and `chunkingServiceId` are required. Both
must reference services that exist in the same workspace.

- **201** — the created `KnowledgeBase` (collection now exists)
- **404** `workspace_not_found` / `embedding_service_not_found` /
  `chunking_service_not_found` / `reranking_service_not_found`
- **409** `conflict` — `knowledgeBaseId` collision
- **422** `workspace_misconfigured` — workspace is missing
  `url` or `credentials.token` required by its driver
- **503** `driver_unavailable` — no driver registered for the
  workspace's `kind`

### `GET /{knowledgeBaseId}` / `PATCH /{knowledgeBaseId}` / `DELETE /{knowledgeBaseId}`

`GET` reads the record. `PATCH` accepts a partial — `name`,
`description`, `status`, `rerankingServiceId`, `language`, `lexical`
are mutable; **`embeddingServiceId` and `chunkingServiceId` are
immutable post-create** and the schema is `.strict()`, so accidentally
including them in a body returns `400`. `DELETE` drops the underlying
Astra collection first, then the KB row, then cascades RAG document
rows.

### `POST /{knowledgeBaseId}/records` — upsert records

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
- `vector.length` must equal the bound embedding service's
  `embeddingDimension`.
- **Text dispatch** mirrors search: the route tries
  `driver.upsertByText()` for all-text batches (Astra `$vectorize`
  inserts for collections with a service block). On
  `NotSupportedError` the runtime embeds each text record via the
  KB's bound embedding service and retries through plain `upsert`.
  Mixed batches always embed client-side so the whole batch stays
  in one transactional call.

**Response 200**

```json
{ "upserted": 2 }
```

- **400** `validation_error` — record has neither/both of `vector`/`text`
- **400** `dimension_mismatch` — vector length doesn't match the
  bound embedding service's `embeddingDimension`
- **400** `embedding_unavailable` / `embedding_dimension_mismatch`
- **404** `workspace_not_found` / `knowledge_base_not_found`

### `DELETE /{knowledgeBaseId}/records/{recordId}`

Delete a single record. `recordId` is the application's `id` (any
non-empty string).

```json
{ "deleted": true }
```

### `POST /{knowledgeBaseId}/search` — vector or text search

**Request** — exactly one of `vector` or `text`, plus optional
`hybrid` / `lexicalWeight` / `rerank`:

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

- `topK` defaults to 10, clamped to `[1, 1000]`.
- `filter` is shallow-equal on payload keys.
- `hybrid: true` runs the driver's vector + lexical lane (defaults
  to the KB's `lexical.enabled`). Requires `text`.
- `rerank: true` reorders hits through the KB's bound reranking
  service. Defaults to `true` when `rerankingServiceId` is non-null.
  Requires `text`.

The route synthesises a driver-facing descriptor from the KB plus
its bound services (see `kb-descriptor.ts`) so the dispatch layer
stays unchanged.

**Response 200** — array of hits, sorted by `score` descending:

```json
[
  { "id": "doc-1", "score": 0.94, "payload": { "title": "…" } },
  { "id": "doc-2", "score": 0.87, "payload": { "title": "…" } }
]
```

Score semantics match the bound embedding service's
`distanceMetric`:

| Metric | Score |
|---|---|
| `cosine` | Cosine similarity in `[-1, 1]`; 1 = exact match |
| `dot` | Raw dot product; unbounded |
| `euclidean` | `1 / (1 + distance)` so higher = closer |

- **400** `validation_error` — neither/both of `vector`/`text`,
  or `hybrid`/`rerank` without `text`
- **400** `dimension_mismatch` / `embedding_unavailable` /
  `embedding_dimension_mismatch`
- **404** `workspace_not_found` / `knowledge_base_not_found`
- **501** `hybrid_not_supported` / `rerank_not_supported`

### `GET /{knowledgeBaseId}/documents`

List RAG documents in the KB.

- **200** — paginated `RagDocument` records
- **404** `workspace_not_found` / `knowledge_base_not_found`

A `RagDocument`:

```json
{
  "workspaceId": "…",
  "knowledgeBaseId": "…",
  "documentId": "…",
  "sourceDocId": null,
  "sourceFilename": "readme.md",
  "fileType": "text/markdown",
  "fileSize": 1024,
  "contentHash": "sha256:…",
  "chunkTotal": null,
  "ingestedAt": null,
  "updatedAt": "…",
  "status": "pending",
  "errorMessage": null,
  "metadata": { "source": "upload" }
}
```

`status` is one of `pending | chunking | embedding | writing | ready
| failed`. The KB ingest pipeline is the canonical writer of
`status` / `errorMessage` / `chunkTotal` / `ingestedAt`. Clients
can also set these directly via `PATCH` if they own the lifecycle
externally.

### `POST /{knowledgeBaseId}/documents`

Register a document in the KB without running the ingest pipeline.

```json
{
  "sourceFilename": "readme.md",
  "fileType": "text/markdown",
  "fileSize": 1024,
  "contentHash": "sha256:…",
  "metadata": { "source": "upload" }
}
```

- **201** — the created `RagDocument` (`status` defaults to
  `pending`, `metadata` defaults to `{}`)
- **404** `workspace_not_found` / `knowledge_base_not_found`
- **409** `conflict` — `workspaceId` collision within the same KB

### `GET /{knowledgeBaseId}/documents/{documentId}` / `PATCH /{documentId}` / `DELETE /{documentId}`

Fetch / patch / delete. `PATCH` accepts every field from create (all
optional). `DELETE` cascades into the KB's collection: chunks
matched by `payload.documentId` are removed before the row is
dropped, so a successful delete leaves no traces in KB-scoped
search. Drivers exposing `deleteRecords` use a single bulk call;
older drivers fall back to a `listRecords` + per-row delete loop.

### `GET /{knowledgeBaseId}/documents/{documentId}/chunks`

Lists the chunks the ingest pipeline extracted from this document.
Reads raw records out of the KB's collection filtered on
`documentId`, sorts by the `chunkIndex` payload key, and returns:

```json
[
  {
    "id": "<documentId>:0",
    "chunkIndex": 0,
    "text": "First paragraph about apples.",
    "payload": {
      "knowledgeBaseId": "…",
      "documentId": "…",
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

- **200** — array of chunks, sorted by `chunkIndex` ascending
- **404** `workspace_not_found` / `knowledge_base_not_found` /
  `document_not_found`
- **501** `list_records_not_supported` — driver doesn't expose
  `listRecords`

### `POST /{knowledgeBaseId}/ingest`

Synchronous end-to-end ingest. Chunks the input text, embeds every
chunk through the KB's bound embedding service (server-side via
`$vectorize` where the driver supports it, otherwise client-side),
upserts the chunks into the KB's collection, and creates a
`RagDocument` row with `status: ready` + `chunkTotal`.

**Request**

```json
{
  "text": "Apples are red. Bananas are yellow.",
  "sourceFilename": "fruit.md",
  "metadata": { "source": "seed" },
  "chunker": { "maxChars": 1000, "minChars": 100, "overlapChars": 150 }
}
```

`chunker` overrides the runtime defaults for this call only.
`metadata` is merged onto every chunk's payload; the reserved keys
`knowledgeBaseId`, `documentId`, `chunkIndex`, and `chunkText` are
always set by the runtime and override any caller-supplied values.
`text` is capped at 200,000 characters.

**Response 201**

```json
{
  "document": { "status": "ready", "chunkTotal": 3, "...": "..." },
  "chunks": 3
}
```

**Chunk payloads.** Every chunk upserted carries:

- `knowledgeBaseId` — the KB's ID (used by `/search`)
- `documentId` — the ID of the `RagDocument` row this ingest created
- `chunkIndex` — 0-based position within the source document
- `chunkText` — the chunk's raw text (read back through `/chunks`)
- Plus every caller-supplied `metadata` key

**Failure semantics.** When chunking or upsert throws, the
`RagDocument` row is marked `status: failed` with `errorMessage`
before the error is re-raised.

### `POST /{knowledgeBaseId}/ingest?async=true`

Same body. The pipeline runs in the background; the response
returns immediately with a job pointer.

**Response 202**

```json
{
  "job": {
    "workspaceId": "…",
    "jobId": "…",
    "kind": "ingest",
    "knowledgeBaseId": "…",
    "documentId": "…",
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

Errors are the same set as the sync path. A 4xx means the request
was rejected outright; nothing was enqueued and no job row exists.

Once the job is running, failures are captured into the job record
(`status: failed`, `errorMessage` populated) and the document row.
The `runKbIngestJob` worker resolves the KB descriptor on every
call so renames or service swaps mid-flight don't drift.

---

## `/api/v1/workspaces/{workspaceId}/jobs/{jobId}`

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
| `workspaceId` | uuid | Owning workspace |
| `jobId` | uuid | |
| `kind` | `"ingest"` | Discriminator — more kinds arrive with more async ops |
| `knowledgeBaseId` | uuid or null | Set for ingest jobs |
| `documentId` | uuid or null | Set for ingest jobs |
| `status` | `"pending"` \| `"running"` \| `"succeeded"` \| `"failed"` | Terminal: succeeded, failed |
| `processed` | int | Units completed |
| `total` | int or null | Units expected (null if unknown) |
| `result` | object or null | Kind-specific summary on success (ingest: `{ chunks: N }`) |
| `errorMessage` | string or null | Populated on `failed` |
| `leasedAt` | iso-8601 or null | Last heartbeat from the lease holder |
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


## Planned routes

These do not exist yet. Shapes may shift before they land.

### Stage 2 — agents, conversations, messages

The schema for `wb_agentic_*` and `wb_config_llm_service_*` /
`wb_config_mcp_tools_*` is provisioned at boot but not yet wired
through the runtime. The route shapes are reserved:

- `/api/v1/workspaces/{w}/llm-services` — CRUD
- `/api/v1/workspaces/{w}/mcp-tools` — CRUD
- `/api/v1/workspaces/{w}/agents` — CRUD; an agent composes one LLM
  + a list of MCP tools + a list of knowledge bases
- `/api/v1/workspaces/{w}/agents/{a}/conversations` — CRUD; nested
  `messages` resource
- `/api/v1/workspaces/{w}/agents/{a}/run` — execution loop

See [`roadmap.md`](roadmap.md) for the phase plan.

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
