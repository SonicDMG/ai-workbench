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
- The runtime under test is always configured to point its Astra
  backend at `http://localhost:4010` (mock-astra) with keyspace
  `workbench` and token `test-token`.
- No authentication on the `/api/v1/*` surface in Phase 1a — the
  runtime itself is the auth boundary, but workspace-scoped tokens
  haven't landed yet.

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

Creates a **vector store descriptor row** (the row in
`wb_vector_store_by_workspace`). Does NOT provision the underlying
Data API Collection — that's scenario 4.

1. `POST /api/v1/workspaces` — body `{"name": "w", "kind": "astra"}`
2. `POST /api/v1/workspaces/$1.uid/vector-stores` — body:
   ```json
   {
     "name": "vs",
     "vectorDimension": 1536,
     "embedding": {
       "provider": "openai",
       "model": "text-embedding-3-small",
       "dimension": 1536,
       "secretRef": "env:OPENAI_API_KEY"
     }
   }
   ```
3. `GET /api/v1/workspaces/$1.uid/vector-stores/$2.uid`

Fixture: `fixtures/vector-store-definition.json`.

---

## Scenario 4 — `vector-store-provision-and-search` *(Phase 1b)*

End-to-end: create descriptor row, provision underlying Data API
Collection, upsert a record, search. Not required for Phase 1a
conformance — included here so the shape is visible early.

1. `POST /api/v1/workspaces` — body `{"name": "w", "kind": "astra"}`
2. `POST /api/v1/workspaces/$1.uid/vector-stores` (as scenario 3)
3. *(Provisioning of the underlying collection is a side-effect of
   step 2 in the final design; step is listed here as a TBD for
   whatever explicit operation the Phase 1b API introduces.)*
4. `POST /api/v1/workspaces/$1.uid/vector-stores/$2.uid/records` —
   body `{"records": [{"id": "doc-1", "vector": [...], "payload":
   {...}}]}`
5. `POST /api/v1/workspaces/$1.uid/vector-stores/$2.uid/search` —
   body `{"vector": [...], "topK": 5}`

Fixture: `fixtures/vector-store-provision-and-search.json` *(TBD)*.

---

## Scenario 5 — `document-crud-basic` *(Phase 2)*

Document metadata CRUD under a catalog, plus a cross-catalog scoping
check. Two catalogs are created so step 8 can confirm that a document
registered under catalog A is not visible under catalog B in the same
workspace.

1. `POST /api/v1/workspaces` — body `{"name": "w", "kind": "astra"}`
2. `POST /api/v1/workspaces/$1.uid/catalogs` — body `{"name": "support"}`
3. `POST /api/v1/workspaces/$1.uid/catalogs` — body `{"name": "other"}`
4. `POST /api/v1/workspaces/$1.uid/catalogs/$2.uid/documents` — body
   `{"sourceFilename": "readme.md", "fileType": "text/markdown",
     "fileSize": 1024, "metadata": {"source": "upload"}}`
5. `GET  /api/v1/workspaces/$1.uid/catalogs/$2.uid/documents`
6. `GET  /api/v1/workspaces/$1.uid/catalogs/$2.uid/documents/$4.documentUid`
7. `PUT  /api/v1/workspaces/$1.uid/catalogs/$2.uid/documents/$4.documentUid`
   — body `{"status": "ready", "chunkTotal": 7}`
8. `GET  /api/v1/workspaces/$1.uid/catalogs/$3.uid/documents/$4.documentUid`
   *(cross-catalog — expect `404 document_not_found`)*
9. `DELETE /api/v1/workspaces/$1.uid/catalogs/$2.uid/documents/$4.documentUid`
10. `GET  /api/v1/workspaces/$1.uid/catalogs/$2.uid/documents/$4.documentUid`
    *(post-delete — expect `404 document_not_found`)*

Fixture: `fixtures/document-crud-basic.json`.

---

## Scenario 6 — `workspace-kind-is-immutable`

Nails down the PR-15 invariant: a workspace's `kind` cannot change
after creation. Every runtime MUST reject the PUT body with
`400 validation_error` in the canonical envelope, and the stored
record MUST still show the original kind.

1. `POST /api/v1/workspaces` — body `{"name": "w", "kind": "astra"}`
2. `PUT  /api/v1/workspaces/$1.uid` — body `{"kind": "mock"}`
   *(expect `400 validation_error`)*
3. `GET  /api/v1/workspaces/$1.uid`
   *(expect the record still reports `"kind": "astra"`)*

Fixture: `fixtures/workspace-kind-is-immutable.json`.

---

## Scenario 7 — `workspace-credentials-must-be-secret-ref`

Nails down the PR-15 invariant: every value in `credentialsRef` must
be a SecretRef (`<provider>:<path>` like `env:ASTRA_TOKEN`). Raw
tokens are rejected at the request boundary — they never reach the
SecretResolver.

1. `POST /api/v1/workspaces` — body
   `{"name": "w", "kind": "astra", "credentialsRef": {"token": "raw-token-here"}}`
   *(expect `400 validation_error`; the workspace is NOT created)*
2. `GET  /api/v1/workspaces`
   *(expect an empty list)*

Fixture: `fixtures/workspace-credentials-must-be-secret-ref.json`.

---

## Scenario 8 — `workspace-test-connection-mock`

Pins the response shape of the `POST
/workspaces/{uid}/test-connection` probe. The mock kind is always
reachable and requires no credentials, so it's the one case that's
deterministic regardless of how the runtime resolves secrets — every
runtime MUST emit `{ok: true, kind: "mock", details: "..."}`.

1. `POST /api/v1/workspaces` — body `{"name": "w", "kind": "mock"}`
2. `POST /api/v1/workspaces/$1.uid/test-connection`
   *(expect `200`, `body.ok === true`, `body.kind === "mock"`)*

Fixture: `fixtures/workspace-test-connection-mock.json`.

*(Astra / HCD / OpenRAG probes hit the SecretResolver; their
pass/fail result depends on the process's env vars. Scenarios that
pin those paths would be non-portable, so they live only as
runtime-level unit tests, not as conformance fixtures.)*

---

## Adding a scenario

1. Append a new section to this file.
2. Add the matching entry to
   [`scenarios.json`](./scenarios.json).
3. Implement the routes in the canonical TypeScript runtime at
   [`../runtimes/typescript/src/routes/`](../runtimes/typescript/src/routes/).
4. Run `npm run conformance:regenerate` to materialize the fixture
   from the TS runtime's responses.
5. Run every other runtime's tests. Any that drift surface in CI —
   update those runtimes in the same PR.
