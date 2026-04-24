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
