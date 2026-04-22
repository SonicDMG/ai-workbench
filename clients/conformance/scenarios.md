# Conformance Scenarios

Each scenario is a numbered list of client operations that every
language port MUST be able to execute in order against
[`mock-astra/`](./mock-astra/).

The captured HTTP requests (after [normalization](./normalize.mjs)) must
match the corresponding fixture at `fixtures/<scenario-slug>.json`.

## Conventions

- Operations use a pseudocode form like
  `client.workspaces.create(name="prod", kind="astra")`. Each language
  translates to its idioms (camelCase vs snake_case, builders vs kwargs).
- Scenarios are ordered. Later steps may reference uids returned by
  earlier steps using `$1.uid`, `$2.uid`, ... (1-indexed to step number).
- The client is always pointed at `http://localhost:4010` with keyspace
  `workbench` and token `test-token`.

---

## Scenario 1 — `workspace-crud-basic`

Minimum viable workspace lifecycle.

1. `client.workspaces.create(name="prod", kind="astra")`
2. `client.workspaces.list()`
3. `client.workspaces.get(uid=$1.uid)`
4. `client.workspaces.update(uid=$1.uid, name="production")`
5. `client.workspaces.delete(uid=$1.uid)`

Fixture: `fixtures/workspace-crud-basic.json`.

---

## Scenario 2 — `catalog-under-workspace`

Workspaces with nested catalogs, scoped correctly.

1. `client.workspaces.create(name="w", kind="astra")`
2. `client.catalogs.create(workspace=$1.uid, name="c1")`
3. `client.catalogs.create(workspace=$1.uid, name="c2")`
4. `client.catalogs.list(workspace=$1.uid)`
5. `client.catalogs.delete(workspace=$1.uid, uid=$2.uid)`

Fixture: `fixtures/catalog-under-workspace.json`.

---

## Scenario 3 — `vector-store-definition`

Creates a **vector store descriptor row** (the row in
`wb_vector_store_by_workspace`). Does NOT provision the underlying Data
API Collection — that's a separate step covered in scenario 4.

1. `client.workspaces.create(name="w", kind="astra")`
2. `client.vector_stores.create(workspace=$1.uid, name="vs",
   vector_dimension=1536, embedding={provider: "openai", model:
   "text-embedding-3-small", dimension: 1536, secret_ref:
   "env:OPENAI_API_KEY"})`
3. `client.vector_stores.get(workspace=$1.uid, uid=$2.uid)`

Fixture: `fixtures/vector-store-definition.json`.

---

## Scenario 4 — `vector-store-provision-and-search` *(Phase 1b)*

End-to-end: create descriptor row, provision underlying Data API
Collection, upsert a record, search. Not part of the Phase 1a conformance
requirement — included here so Cédrick can see where it's going.

1. `client.workspaces.create(name="w", kind="astra")`
2. `client.vector_stores.create(...)` (as scenario 3)
3. `client.collections.provision(workspace=$1.uid, vector_store=$2.uid)`
4. `client.collections.upsert(workspace=$1.uid, vector_store=$2.uid,
   records=[{id: "doc-1", vector: [0.1, 0.2, ...], payload: {title:
   "..."}}])`
5. `client.collections.search(workspace=$1.uid, vector_store=$2.uid,
   vector: [0.1, 0.2, ...], top_k: 5)`

Fixture: `fixtures/vector-store-provision-and-search.json` *(TBD)*.

---

## Adding a scenario

1. Append a new section to this file.
2. Implement it in the canonical TS client.
3. Run `npm run conformance:regenerate` to materialize the fixture.
4. Implement it in every other language client in the same PR.
