# Conformance Scenarios

Each scenario is a numbered list of HTTP requests against a running
green box's `/api/v1/*` surface. Every language-native runtime MUST be
able to execute all scenarios and produce responses that match (after
[normalization](./normalize.mjs)) the fixture at
`fixtures/<scenario-slug>.json`.

## Conventions

- Requests are written as `METHOD /path` with a JSON body where
  relevant. Every runtime's test harness issues them in order.
- Scenarios are ordered. Later steps may reference values from earlier
  responses via `$N.field` (1-indexed to step number) — e.g. `$1.uid`
  means "the `uid` from step 1's response body".
- Conformance runs with auth disabled. Auth-specific behavior is pinned
  by runtime tests; portable API-key lifecycle response shapes are
  still included here.
- The canonical TypeScript harness uses an in-memory control plane and
  the mock vector-store driver so fixtures stay deterministic.

---

## Scenario 1 — `workspace-crud-basic`

Minimum viable workspace lifecycle.

1. `POST /api/v1/workspaces` — body `{"name": "prod", "kind": "astra"}`
2. `GET  /api/v1/workspaces`
3. `GET  /api/v1/workspaces/$1.uid`
4. `PUT  /api/v1/workspaces/$1.uid` — body `{"name": "production"}`
5. `DELETE /api/v1/workspaces/$1.uid`

Fixture: `fixtures/workspace-crud-basic.json`.

---

## Scenario 2 — `catalog-under-workspace`

Workspaces with nested catalogs, scoped correctly.

1. `POST /api/v1/workspaces` — body `{"name": "w", "kind": "astra"}`
2. `POST /api/v1/workspaces/$1.uid/catalogs` — body `{"name": "c1"}`
3. `POST /api/v1/workspaces/$1.uid/catalogs` — body `{"name": "c2"}`
4. `GET  /api/v1/workspaces/$1.uid/catalogs`
5. `DELETE /api/v1/workspaces/$1.uid/catalogs/$2.uid`

Fixture: `fixtures/catalog-under-workspace.json`.

---

## Scenario 3 — `vector-store-definition`

Creates a vector-store descriptor and verifies it can be fetched.

1. `POST /api/v1/workspaces` — body `{"name": "w", "kind": "mock"}`
2. `POST /api/v1/workspaces/$1.uid/vector-stores` — body includes
   `vectorDimension: 4` and a mock embedding config.
3. `GET /api/v1/workspaces/$1.uid/vector-stores/$2.uid`

Fixture: `fixtures/vector-store-definition.json`.

---

## Scenario 4 — `vector-store-upsert-and-search`

End-to-end data plane: create a vector store, upsert records, search
with a payload filter, then delete a record twice to pin idempotency.

Fixture: `fixtures/vector-store-upsert-and-search.json`.

---

## Scenario 5 — `catalog-vector-store-reference-integrity`

Catalog/vector-store binding invariants.

1. Creating a catalog with a missing `vectorStore` returns
   `404 vector_store_not_found`.
2. Creating a catalog bound to an existing vector store succeeds.
3. Deleting that referenced vector store returns `409 conflict`.
4. Fetching the vector store still succeeds after the blocked delete.

Fixture: `fixtures/catalog-vector-store-reference-integrity.json`.

---

## Scenario 6 — `document-crud-basic`

Document metadata CRUD under a catalog, plus a cross-catalog scoping
check and a post-delete 404.

Fixture: `fixtures/document-crud-basic.json`.

---

## Scenario 7 — `workspace-kind-is-immutable`

A workspace's `kind` cannot change after creation. Every runtime MUST
reject a `PUT` body containing `kind` with `400 validation_error`.

Fixture: `fixtures/workspace-kind-is-immutable.json`.

---

## Scenario 8 — `workspace-credentials-must-be-secret-ref`

Raw credential values are rejected with `400 validation_error` before
they can reach the `SecretResolver`.

Fixture: `fixtures/workspace-credentials-must-be-secret-ref.json`.

---

## Scenario 9 — `workspace-test-connection-mock`

`POST /workspaces/{uid}/test-connection` on a mock workspace always
reports `ok: true` with the portable response shape.

Fixture: `fixtures/workspace-test-connection-mock.json`.

---

## Scenario 10 — `workspace-api-key-lifecycle`

Full workspace API-key lifecycle: issue, list, revoke, list. The
plaintext is returned exactly once; list responses expose metadata
without the stored hash.

Fixture: `fixtures/workspace-api-key-lifecycle.json`.

---

## Scenario 11 — `catalog-scoped-document-search`

`POST /catalogs/{c}/documents/search` delegates to the catalog's bound
vector store, merging the catalog UID into the filter as `catalogUid`.
Records without that payload key (or with a different value) are
invisible to the search; a caller-supplied `catalogUid` filter is
overridden by the path's catalog.

Steps cover:

1. A search returning only the record whose payload carries the
   matching `catalogUid`.
2. A `409 catalog_not_bound_to_vector_store` when the catalog has no
   `vectorStore` binding.

Fixture: `fixtures/catalog-scoped-document-search.json`.

---

## Scenario 12 — `catalog-ingest-basic`

`POST /catalogs/{c}/ingest` chunks the input text, embeds each chunk,
upserts into the catalog's bound vector store, and creates a
`Document` row with `status: ready`. The subsequent
`GET /documents` reflects the registered row, and a catalog-scoped
search finds the freshly ingested chunks (their payloads carry
`catalogUid` + `documentUid` + `chunkIndex`).

An ingest against a catalog whose `vectorStore` is `null` returns
`409 catalog_not_bound_to_vector_store`.

Fixture: `fixtures/catalog-ingest-basic.json`.

### Async ingest + SSE — partial coverage

The 202 wire shape for `POST /ingest?async=true` is pinned by
[Scenario 16](#scenario-16--catalog-async-ingest-202) below. Eventual
job completion (`status: succeeded` after polling) and the SSE event
stream remain out of scope: their state depends on when the runner
happens to observe the worker, so the fixture would be flaky.
Runtime-specific tests cover the lifecycle with polling.
---

## Scenario 13 — `catalog-saved-queries`

Saved-query CRUD under a catalog. Pins the wire shapes every runtime
must produce on create/list/update/delete plus the post-delete 404
(`saved_query_not_found`). `/run` semantics (replaying a saved query
through catalog-scoped search, with the catalog UID always winning
over the saved filter) stay in runtime tests — they depend on
embedding providers that aren't portable across runtimes.

Fixture: `fixtures/catalog-saved-queries.json`.

---

## Scenario 14 — `vector-store-text-dispatch-mock`

Driver-native text dispatch on `POST /vector-stores/{vs}/search`.
With a `mock` workspace + `embedding.provider: "mock"`, the runtime
routes `{ text }` requests through the driver's `searchByText` (which
seeds vectors via `mockEmbed`) instead of going through an embedding
provider. Mirrors the playground's text path. Steps cover:

1. Upsert three text records (drivers without `upsertByText` would
   fall back through the route's embedder dispatch).
2. A topK-2 text search → ordered hits.
3. The same query with a payload filter → only matching tags survive.

The deterministic `mockEmbed` function is part of the conformance
contract for the `mock` driver — runtimes that wire up `mock` MUST
produce the same vectors for the same input texts.

Fixture: `fixtures/vector-store-text-dispatch-mock.json`.

---

## Scenario 15 — `vector-store-hybrid-and-rerank-mock`

Pins the `{ hybrid, rerank, lexicalWeight }` lanes on
`POST /vector-stores/{vs}/search`. The vector store is created with
`lexical.enabled: true` and `reranking.enabled: true` so the mock
driver's combined-lane and standalone-rerank paths fire. Steps cover:

1. `hybrid: true` with `lexicalWeight: 0.5` — vector + lexical
   blended, min-max normalized.
2. `rerank: true` (no hybrid) — vector retrieval then lexical-only
   rescore on the hits.
3. `hybrid: true` with a `vector` body (no `text`) — `400
   validation_error`. Lexical lanes can't operate on vectors alone.

Fixture: `fixtures/vector-store-hybrid-and-rerank-mock.json`.

---

## Scenario 16 — `catalog-async-ingest-202`

Pins the 202 wire shape for `POST /catalogs/{c}/ingest?async=true`.
The job snapshot is captured at creation time
(`status: pending`, `processed: 0`, `total: null`,
`document.status: writing`) so the response is deterministic across
runs.

Eventual completion (`status: succeeded` and `processed == total`)
still depends on the worker's scheduling and remains out of scope —
runtime-specific tests handle the lifecycle with polling.

Fixture: `fixtures/catalog-async-ingest-202.json`.
