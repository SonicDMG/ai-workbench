# Workspaces

A **workspace** is the unit of isolation in AI Workbench — a named
tenant that owns its own knowledge bases, execution services
(chunking / embedding / reranking), RAG documents, async-ingest jobs,
and API keys.

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

- Every knowledge base under the workspace, after dropping each KB's
  underlying vector collection through the workspace's driver.
- Every RAG document registered against any of those knowledge bases.
- Every chunking, embedding, and reranking service definition under the
  workspace.
- Every async-ingest job record scoped to the workspace.
- Every workspace API key issued from the workspace.

### Isolation

- A request carrying workspace UID `A` can never read or mutate
  resources in workspace `B`. Nested routes call
  `ControlPlaneStore.listKnowledgeBases(workspace)` /
  `…getKnowledgeBase(workspace, uid)` etc. and the store asserts the
  workspace exists before returning anything.
- Logs carry `requestId`. Structured OTel attributes (workspaceUid,
  knowledgeBaseUid, jobId) are on the cross-cutting observability
  workstream — see [`roadmap.md`](roadmap.md).

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
orphan any KB collections already provisioned on the original backend
— there's no safe way to transparently migrate them, so the runtime
doesn't try. Delete and recreate the workspace if the backend needs to
change.

### `name` and `endpoint`

- `name` is a **human-readable label**. It is not unique — two
  workspaces can share a name (the UID is the identity). UIs should
  display the name but disambiguate by uid when needed.
- `endpoint` is the **data-plane URL** for this workspace's backend.
  For `astra` / `hcd` workspaces it's the Astra Data API endpoint
  the KB driver dials (`https://<db>-<region>.apps.astra.datastax.com`).
  Each Astra DB has its own endpoint — put one workspace per DB to
  route correctly.
- `endpoint` accepts either a **literal URL** or a **SecretRef**
  (`env:ASTRA_DB_API_ENDPOINT`, `file:/path`). The driver detects
  refs by prefix-matching a registered
  [`SecretProvider`](configuration.md#secrets); literal URLs are
  used as-is. That lets the same workspace record work in dev
  (value baked into `.env`) and prod (value injected via a K8s
  Secret mounted as an env var) without code changes.
- `mock` / `openrag` workspaces don't dial anything and may leave
  `endpoint: null`.

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

## Knowledge bases and execution services

A workspace owns:

- **Knowledge bases** — the `wb_config_knowledge_bases_by_workspace`
  rows. Each KB pins an embedding service (which determines the
  dimensions and similarity metric of its vector collection) and a
  chunking service, and may optionally bind a reranking service. A
  KB's underlying Astra collection (`wb_vectors_<kb_id>`) is
  provisioned transactionally when the KB is created and dropped when
  it is deleted.
- **Execution services** — three families of `wb_config_*_service_by_workspace`
  rows describing the chunking, embedding, and reranking
  implementations available to KBs in this workspace.

### Knowledge base ↔ service binding (N:1)

**Multiple knowledge bases may share one service definition.** A KB
holds:

- `embeddingServiceId` (required, **immutable** after KB create — the
  vector collection's dimensions are pinned at provisioning time)
- `chunkingServiceId` (required, immutable)
- `rerankingServiceId` (optional, mutable — reranking is applied at
  query time and can be added/removed without affecting stored
  vectors)

The store enforces:

- A KB's `embeddingServiceId` and `chunkingServiceId` must reference
  services in the same workspace.
- `DELETE` on an embedding or chunking service is blocked with
  `409 conflict` while any KB references it. Reassign or delete the
  KBs first, then delete the service.

The relationship:

```
workspace ──► knowledge base  ──► chunking service   (N:1)
                │              ──► embedding service  (N:1)
                │              ──► reranking service  (N:1, optional)
                └──► RAG documents
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

Create a mock workspace, register a chunking + embedding service,
create a KB binding them, list:

```bash
WS_BODY='{"name":"demo","kind":"mock"}'
WS_UID=$(curl -s -X POST http://localhost:8080/api/v1/workspaces \
  -H "content-type: application/json" -d "$WS_BODY" | jq -r .uid)

CHUNK_BODY='{"name":"default-chunker","provider":"mock"}'
CHUNK_UID=$(curl -s -X POST \
  http://localhost:8080/api/v1/workspaces/$WS_UID/chunking-services \
  -H "content-type: application/json" -d "$CHUNK_BODY" | jq -r .uid)

EMBED_BODY='{"name":"default-embedder","provider":"mock","dimensions":1536,"similarity":"cosine"}'
EMBED_UID=$(curl -s -X POST \
  http://localhost:8080/api/v1/workspaces/$WS_UID/embedding-services \
  -H "content-type: application/json" -d "$EMBED_BODY" | jq -r .uid)

KB_BODY=$(jq -n --arg c "$CHUNK_UID" --arg e "$EMBED_UID" \
  '{name:"support",chunkingServiceId:$c,embeddingServiceId:$e}')
curl -s -X POST \
  http://localhost:8080/api/v1/workspaces/$WS_UID/knowledge-bases \
  -H "content-type: application/json" -d "$KB_BODY"

curl -s http://localhost:8080/api/v1/workspaces/$WS_UID/knowledge-bases
```

Delete the workspace — the KB, its collection, the services, and any
documents go with it:

```bash
curl -X DELETE http://localhost:8080/api/v1/workspaces/$WS_UID
```
