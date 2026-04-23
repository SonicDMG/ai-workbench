# Workspaces

A **workspace** is the unit of isolation in AI Workbench — a named
tenant that owns its own catalogs, vector-store descriptors, and
(when Phase 2 lands) documents.

Workspaces are **runtime records**, not config. They're created via
`POST /api/v1/workspaces`, fetched via `GET /api/v1/workspaces/{uid}`,
and deleted via `DELETE`. Earlier drafts of this document described
a YAML-based workspace model; that's gone — workspaces are now rows in
the `wb_workspaces` table behind whichever control-plane backend the
runtime is using.

## Why workspaces?

A single runtime process needs to serve multiple logical tenants
without mixing their data. Rather than one container per tenant, we
run **one process with N workspaces** and scope every operation by
workspace UID.

## Properties

### Identity

- `uid` is an RFC 4122 v4 UUID (lowercase, hyphenated).
- The uid is a path segment: `/api/v1/workspaces/{uid}/…`.
- `name` is a human-readable label; it's not unique and has no
  semantic weight.

### Lifecycle

```
POST   /api/v1/workspaces              → create (returns uid)
GET    /api/v1/workspaces              → list
GET    /api/v1/workspaces/{uid}        → fetch
PUT    /api/v1/workspaces/{uid}        → patch
DELETE /api/v1/workspaces/{uid}        → cascade delete
```

`DELETE` cascades to:

- Every catalog under the workspace.
- Every vector-store descriptor under the workspace.
- Every document under any of those catalogs (Phase 2+).

### Isolation

- A request carrying workspace UID `A` can never read or mutate
  resources in workspace `B`. Nested routes call
  `ControlPlaneStore.listCatalogs(workspace)` / `…getCatalog(workspace,
  uid)` etc. and the store asserts the workspace exists before
  returning anything.
- Logs carry `requestId`; `workspaceId` will join them in Phase 2
  alongside structured OTel attributes.

### `kind`

Every workspace declares a `kind` — the backend it targets:

| Kind | Meaning |
|---|---|
| `astra` | DataStax Astra, via the Data API |
| `hcd` | Hyper-Converged Database (Astra's self-hosted cousin) — routing deferred |
| `openrag` | The [OpenRAG](https://openr.ag) project — routing deferred |
| `mock` | In-memory, for CI and offline development |

The `kind` describes *this workspace's* backend — distinct from
whichever backend the runtime's own control plane uses (configured via
[`workbench.yaml`](configuration.md#controlplane)). `mock` stays a
first-class option so tests and local dev don't need any external
service.

**`kind` is immutable after creation.** `PUT /api/v1/workspaces/{uid}`
rejects a `kind` field with `400`. Changing a workspace's kind would
orphan any vector-store collections already provisioned on the
original backend — there's no safe way to transparently migrate them,
so the runtime doesn't try. Delete and recreate the workspace if the
backend needs to change.

### `name` and `url`

- `name` is a **human-readable label**. It is not unique — two
  workspaces can share a name (the UID is the identity). UIs should
  display the name but disambiguate by uid when needed.
- `url` is **informational metadata** — typically a link to the
  workspace's console in the backend's native UI (e.g. the Astra DB
  console). It is not dialed or validated by the runtime; nothing in
  the data plane reads it. Use it as a bookmark, not a routing hint.

### Credentials

Credentials are never stored by value. A workspace may hold a
`credentialsRef` map whose values are `SecretRef` pointers:

```json
{
  "name": "prod",
  "kind": "astra",
  "credentialsRef": {
    "token": "env:ASTRA_DB_APPLICATION_TOKEN"
  },
  "keyspace": "default_keyspace"
}
```

Every value in the map must match the `<provider>:<path>` shape —
`env:VAR_NAME` or `file:/abs/path`. Posting a raw token returns
`400`. The runtime resolves refs through its `SecretResolver` at the
moment the workspace's backend needs to be contacted.

## Catalogs and vector stores

A workspace owns:

- **Vector-store descriptors** — the `wb_vector_store_by_workspace`
  rows. Each declares dimensions, similarity, embedding config,
  lexical config, reranking config. These are *descriptors*, not the
  vector data itself — the underlying Data API Collection is
  provisioned transactionally by the workspace's vector-store driver
  when the descriptor is created.
- **Catalogs** — named document collections, each optionally
  `vectorStore`-bound to one of the workspace's descriptors.

### Catalog ↔ vector-store binding (N:1)

**Multiple catalogs may share one vector store.** This was a
deliberate relaxation from an earlier draft's strict 1:1 constraint.
The store enforces:

- A catalog's `vectorStore` field (if non-null) must reference a
  vector store in the same workspace.
- `DELETE` a vector store does **not** cascade through catalogs that
  reference it. Blocking this at the store level is planned for
  Phase 2 when documents enter the picture and the dependency graph
  becomes real.

The relationship:

```
workspace ──► catalog  ──► vector-store descriptor  (N:1)
                │
                └──► documents (Phase 2+)
```

## Seeding workspaces for local dev

When running with the default `memory` control plane, you can
pre-populate workspaces via `seedWorkspaces` in
[`workbench.yaml`](configuration.md#seedworkspaces-memory-only). Seeds
are only loaded into the memory backend; file and astra backends
already persist data and ignore the block.

## Lifecycle today

1. The runtime starts.
2. It builds a `ControlPlaneStore` per the configured backend.
3. If memory + seeds are configured, seeds are loaded into the store.
4. The HTTP server accepts `/api/v1/*` requests; all workspace state
   comes from / lives in the store.

`/readyz` returns `{ status: "ready", workspaces: <N> }` — `N` is the
current count of workspaces, not a list. Listing is at `GET
/api/v1/workspaces`.

## Example session

Create a mock workspace, add a catalog, list:

```bash
WS_BODY='{"name":"demo","kind":"mock"}'
WS_UID=$(curl -s -X POST http://localhost:8080/api/v1/workspaces \
  -H "content-type: application/json" -d "$WS_BODY" | jq -r .uid)

CAT_BODY='{"name":"support"}'
curl -s -X POST http://localhost:8080/api/v1/workspaces/$WS_UID/catalogs \
  -H "content-type: application/json" -d "$CAT_BODY"

curl -s http://localhost:8080/api/v1/workspaces/$WS_UID/catalogs
```

Delete the workspace — the catalog goes with it:

```bash
curl -X DELETE http://localhost:8080/api/v1/workspaces/$WS_UID
```
