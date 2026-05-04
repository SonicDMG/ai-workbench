# ADR 0001 — Services domain layer (route-thin)

- **Status:** Accepted (2026-04, [#151](https://github.com/datastax/ai-workbench/pull/151))
- **Supersedes:** —
- **Superseded by:** —

## Context

Before the refactor, `runtimes/typescript/src/routes/api-v1/` route
handlers carried significant business logic directly: KB create flowed
into Astra collection provisioning + a rollback-on-failure path; KB
delete fanned out to vector-collection drop + control-plane row
removal; ingest forked between sync (run pipeline inline, return 201)
and async (snapshot input, queue a job, fire-and-forget the worker,
return 202 with `Location`).

Each of those flows had non-trivial ordering invariants (drop the
collection only after we know we created it; rollback on partial
failure; never persist a document row before the workspace exists).
That logic lived inside the handlers, which made:

- Tests reach for `supertest`-style HTTP harnesses to assert
  semantics that should have been unit-testable.
- Cross-runtime parity hard — the Python and Java green-box scaffolds
  would have had to re-derive the same orchestration without a
  reference implementation outside of HTTP.
- The route file lengths creep past the 800-line file budget the
  repo's `coding-style.md` calls for.

The alternatives considered:

1. **Status quo + better helpers** — extract orchestration into
   route-local helper functions but leave them in the routes layer.
   Rejected because it doesn't change the testability or parity
   story; just the file shapes.
2. **Light command bus** — a `CommandHandler` registry indexed by
   command name. Rejected as overengineering: there's no plug-in
   surface that needs late-binding, and the registry would just be
   indirection over an interface call.
3. **Services classes (chosen)** — a `KnowledgeBaseService` and
   `IngestService` whose constructor receives the dependencies
   they need (store, drivers, embedders, secrets) and whose methods
   are the orchestrations. Routes validate input + map to a service
   call + serialize the result + map errors.

## Decision

Introduce a `runtimes/typescript/src/services/` domain layer.

- `KnowledgeBaseService` owns: KB-create-with-collection-rollback,
  KB-delete-with-collection-drop, and attach-existing validation.
- `IngestService` owns: the sync/async fork around RAG-document-row
  creation, including the snapshot-input + queue-job + fire-and-
  forget-worker path that produces 202 with a `Location` header.
- Routes shrink to **validate → delegate → serialize**. They no
  longer touch drivers directly.
- Existing test suites (`knowledge-bases.test.ts`,
  `kb-documents.test.ts`) stay as the regression net through the
  refactor.

## Consequences

**Easier:**

- Service-level unit tests don't need an HTTP harness.
- Python / Java runtimes can mirror the same service shapes when they
  exit 501-stub status, giving cross-runtime parity a clear seam.
- Future cross-aggregate sagas (KB-delete fan-out to docs/jobs/
  vectors) have an obvious home.

**Harder:**

- One more layer to navigate when reading a feature end-to-end. The
  cost is mitigated by services living next to their routes
  conceptually and by the route being a 30-line wrapper.

**Deferred:**

- A formal saga / outbox pattern for cross-aggregate operations on
  Astra (which has no transactions) — see [docs/cross-replica-jobs.md](../cross-replica-jobs.md)
  and the queued P1 follow-up.

## References

- [PR #151](https://github.com/datastax/ai-workbench/pull/151) —
  initial extraction (KnowledgeBaseService + IngestService).
- [ADR 0002](./0002-per-aggregate-repos.md) — the type-level
  follow-up that lets services declare narrower repo dependencies.
