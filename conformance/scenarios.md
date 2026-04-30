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
  responses via `$N.field` (1-indexed to step number) — e.g. `$1.workspaceId`
  means "the `workspaceId` from step 1's response body".
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
3. `GET  /api/v1/workspaces/$1.workspaceId`
4. `PATCH  /api/v1/workspaces/$1.workspaceId` — body `{"name": "production"}`
5. `DELETE /api/v1/workspaces/$1.workspaceId`

Fixture: `fixtures/workspace-crud-basic.json`.

---

## Scenario 2 — `workspace-kind-is-immutable`

A workspace's `kind` cannot change after creation. Every runtime MUST
reject a `PATCH` body containing `kind` with `400 validation_error`.

Fixture: `fixtures/workspace-kind-is-immutable.json`.

---

## Scenario 3 — `workspace-credentials-must-be-secret-ref`

Raw credential values are rejected with `400 validation_error` before
they can reach the `SecretResolver`.

Fixture: `fixtures/workspace-credentials-must-be-secret-ref.json`.

---

## Scenario 4 — `workspace-test-connection-mock`

`POST /workspaces/{workspaceId}/test-connection` on a mock workspace always
reports `ok: true` with the portable response shape.

Fixture: `fixtures/workspace-test-connection-mock.json`.

---

## Scenario 5 — `workspace-api-key-lifecycle`

Full workspace API-key lifecycle: issue, list, revoke, list. The
plaintext is returned exactly once; list responses expose metadata
without the stored hash.

Fixture: `fixtures/workspace-api-key-lifecycle.json`.

---

## Scenario 6 — `knowledge-base-crud-basic`

Knowledge-base CRUD lifecycle. Workspace POST auto-seeds the default
chunking + embedding services; the KB binds to one of each by id, then
we round-trip through GET / list / PATCH / DELETE.

Fixture: `fixtures/knowledge-base-crud-basic.json`.

---

## Scenario 7 — `kb-document-crud-basic`

Document CRUD on a knowledge base WITHOUT triggering ingest. Pins the
wire shape of the document record (status, sourceFilename, metadata,
chunkCount). Ingest-with-chunking is excluded from conformance because
chunk counts depend on the chunker's tokenization, which is allowed to
vary across runtimes.

Fixture: `fixtures/kb-document-crud-basic.json`.

---

## Scenario 8 — `kb-search-empty`

Search on an empty knowledge base returns an empty results array with
the canonical envelope. This pins the response shape every runtime
must emit when no documents have been ingested. Search-with-results
scenarios are excluded because they depend on embedder/chunker
behavior that's allowed to vary; conformance only pins the wire shape
on the empty-result path.

Fixture: `fixtures/kb-search-empty.json`.

---

## Scenario 9 — `agent-crud-basic`

Agent + conversation CRUD lifecycle WITHOUT triggering chat sends.
Workspace POST auto-seeds the default LLM service; we bind an agent to
it, open a conversation, and tear down. Sending messages is excluded
from conformance because chat completion depends on the upstream LLM
API that's not part of the runtime contract.

Fixture: `fixtures/agent-crud-basic.json`.
