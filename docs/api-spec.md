# API Spec

This document is the contract for the AI Workbench HTTP surface. It covers:

- **Phase 0** — the minimal bootstrap surface that the initial `root.ts` will
  implement.
- **Forward-looking (Phase 1+)** — the shape the surface will grow into. These
  endpoints are **not implemented yet** and are included so the team can align
  on the contract early.

Forward-looking endpoints are marked `status: planned` with the phase in which
they are expected to land.

## Conventions

### Base URL and versioning

- All functional routes live under `/v1/…`.
- Operational routes (`/`, `/healthz`, `/readyz`, `/version`) are unversioned.
- Breaking changes bump the prefix to `/v2/…`; `/v1/…` remains until deprecated.

### Content type

- Request and response bodies are JSON unless otherwise stated.
- Streaming endpoints (future: ingestion progress) use `text/event-stream`.

### Workspace addressing

Every resource beyond workspace listing is scoped to a workspace. The scope is
carried in the path:

```
/v1/workspaces/{workspaceId}/...
```

`workspaceId` matches the `id` field in `workbench.yaml`.

### Error envelope

All error responses share a single envelope:

```json
{
  "error": {
    "code": "workspace_not_found",
    "message": "Workspace 'dev' is not defined in workbench.yaml",
    "requestId": "01HY2Z..."
  }
}
```

Codes are stable, lowercase, `snake_case`. The `message` field is
human-readable and may change.

### Authentication

- Phase 0: no authentication. The runtime is expected to be behind a trusted
  boundary for now.
- Phase 1+: bearer tokens via `Authorization: Bearer <token>`. Token
  validation is configured per workspace (see `configuration.md`).

### Request ID

Every response includes `X-Request-Id`. If the client sends one, the runtime
echoes it; otherwise the runtime generates a ULID.

---

## Phase 0 — Bootstrap

Implemented by the initial `root.ts`.

### `GET /`

Service banner. Useful for humans hitting the root URL.

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

Liveness probe. Returns `200 OK` as long as the process is running.

**Response 200**

```json
{ "status": "ok" }
```

### `GET /readyz`

Readiness probe. Returns `200 OK` only if:

- Config has been loaded and validated.
- Every workspace in the config resolved its driver and services without error.

Otherwise returns `503 Service Unavailable` with an error envelope listing
which workspaces failed.

**Response 200**

```json
{
  "status": "ready",
  "workspaces": ["prod", "dev", "mock"]
}
```

**Response 503**

```json
{
  "error": {
    "code": "workspace_unready",
    "message": "Workspace 'prod' failed to initialize: astra credentials missing",
    "requestId": "01HY2Z..."
  }
}
```

### `GET /version`

Returns build metadata for the runtime.

**Response 200**

```json
{
  "version": "0.0.0",
  "commit": "abc1234",
  "buildTime": "2026-04-21T10:30:00Z",
  "node": "20.x"
}
```

### `GET /v1/workspaces`

List all workspaces defined in `workbench.yaml`.

**Response 200**

```json
{
  "data": [
    { "id": "prod",  "driver": "astra", "description": "Production Astra DB" },
    { "id": "dev",   "driver": "astra", "description": "Development Astra DB" },
    { "id": "mock",  "driver": "mock",  "description": "In-memory mock" }
  ]
}
```

### `GET /v1/workspaces/{workspaceId}`

Inspect a single workspace's resolved configuration. Secrets are redacted.

**Response 200**

```json
{
  "data": {
    "id": "dev",
    "driver": "astra",
    "description": "Development Astra DB",
    "endpoint": "https://...apps.astra.datastax.com",
    "credentials": "****",
    "catalogs": [
      { "id": "support-docs", "vectorStore": "support-vectors" }
    ],
    "services": {
      "chunking":  { "url": "http://chunking:8080" },
      "embedding": { "url": "http://embedding:8080" }
    }
  }
}
```

**Response 404**

```json
{
  "error": {
    "code": "workspace_not_found",
    "message": "Workspace 'foo' is not defined",
    "requestId": "..."
  }
}
```

---

## Phase 1 — Vector store (planned)

Direct pass-through to Astra's vector_store under the Data API. The runtime
adds authentication, workspace resolution, and schema validation, then
delegates.

### `GET /v1/workspaces/{workspaceId}/vector-stores`

List vector stores bound to this workspace. Status: **planned (Phase 1).**

### `POST /v1/workspaces/{workspaceId}/vector-stores/{storeId}/search`

Vector similarity search. Status: **planned (Phase 1).**

**Request**

```json
{
  "vector": [0.01, -0.02, ...],
  "topK": 10,
  "filter": { "tenant": "acme" },
  "includeEmbeddings": false
}
```

**Response 200**

```json
{
  "data": [
    { "id": "doc-1", "score": 0.94, "payload": { "title": "..." } }
  ]
}
```

### `POST /v1/workspaces/{workspaceId}/vector-stores/{storeId}/records`

Upsert records (vectors + payloads). Status: **planned (Phase 1).**

### `DELETE /v1/workspaces/{workspaceId}/vector-stores/{storeId}/records/{recordId}`

Delete a record. Status: **planned (Phase 1).**

---

## Phase 2 — Document catalog (planned)

### `GET /v1/workspaces/{workspaceId}/catalogs`

List catalogs in a workspace. Status: **planned (Phase 2).**

### `POST /v1/workspaces/{workspaceId}/catalogs/{catalogId}/documents`

Register a document in the catalog (metadata only; ingestion is separate).
Status: **planned (Phase 2).**

### `GET /v1/workspaces/{workspaceId}/catalogs/{catalogId}/documents/{documentId}`

Fetch document metadata. Status: **planned (Phase 2).**

### `DELETE /v1/workspaces/{workspaceId}/catalogs/{catalogId}/documents/{documentId}`

Remove a document from the catalog (and optionally its vectors — controlled by
query flag). Status: **planned (Phase 2).**

---

## Phase 3 — Ingestion (planned)

### `POST /v1/workspaces/{workspaceId}/catalogs/{catalogId}/ingest`

Run the full ingestion pipeline (chunking → embedding → vector store + catalog
write) for a document. Status: **planned (Phase 3).**

**Request (multipart/form-data)**

- `file` — the source document.
- `meta` — JSON metadata blob.

**Response 202**

```json
{
  "data": {
    "jobId": "job_01HY2Z...",
    "status": "accepted"
  }
}
```

### `GET /v1/workspaces/{workspaceId}/jobs/{jobId}`

Poll an ingestion job. Status: **planned (Phase 3).**

---

## Phase 4 — Playground (planned)

### `POST /v1/workspaces/{workspaceId}/playground/query`

Free-form query harness over a catalog + vector store combo, used by the UI
playground. Status: **planned (Phase 4).**

---

## Phase 5+ — Chats, MCP (future)

Reserved namespaces:

- `/v1/workspaces/{workspaceId}/chats/…`
- `/v1/workspaces/{workspaceId}/mcp/…`

Contracts will be defined as those phases approach.

---

## OpenAPI

A machine-readable `openapi.yaml` will be generated from the route definitions
and published at `/v1/openapi.json` once the route layer lands in Phase 0.
