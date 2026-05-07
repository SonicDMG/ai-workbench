# ADR 0002 — Per-aggregate repository interfaces

- **Status:** Accepted (2026-05, [#156](https://github.com/datastax/ai-workbench/pull/156))
- **Supersedes:** —
- **Superseded by:** —

## Context

The runtime's control plane was originally exposed through a single
`ControlPlaneStore` interface — workspaces, knowledge bases, the
three service aggregates (chunking / embedding / reranking), LLM
services, agents, conversations, chat messages, RAG documents, API
keys, and the secrets catalog all hung off the same shape. Three
backends (memory, file, Astra) implemented it as one ~1500-line
class per backend.

After ADR-0001 introduced `KnowledgeBaseService` and `IngestService`,
those services took the whole `ControlPlaneStore` as a dependency.
Two problems:

1. **Wide blast radius for tests.** A unit test of
   `KnowledgeBaseService.create` had to satisfy a 50+-method
   interface even though the call path touches three aggregates.
2. **Hidden coupling.** Any service could quietly reach across
   aggregates because the type allowed it. Future contributors
   couldn't tell from the signature what data each service actually
   needed.

The alternatives considered:

1. **Pick types in service constructors** — each service declares
   `Pick<ControlPlaneStore, "getWorkspace" | "createKnowledgeBase"
   | …>`. Rejected because the picks become unreadable (15+ method
   names in a single declaration) and don't survive renames.
2. **Split the impl files in lockstep with the interface** — a full
   per-aggregate impl extraction across all three backends. Too big
   for one PR and orthogonal to the type-level coupling problem the
   services were hitting.
3. **Per-aggregate repo interfaces (chosen)** — declare twelve
   narrow interfaces (`WorkspaceRepo`, `KnowledgeBaseRepo`,
   `EmbeddingServiceRepo`, …) under
   `control-plane/repos/`. `ControlPlaneStore` extends all twelve,
   so the existing impls still satisfy the whole shape with no impl
   churn. Services declare the repo subset they actually need.

## Decision

Decompose the monolithic `ControlPlaneStore` interface into twelve
per-aggregate repository interfaces under
`runtimes/typescript/src/control-plane/repos/`.

- Each repo file owns its interface plus the corresponding
  `Create*Input` / `Update*Input` types.
- `ControlPlaneStore` `extends` all twelve, preserving every
  existing call site.
- `store.ts` re-exports every input type so existing imports of
  `CreateXInput` from `"./store.js"` keep working.
- `KnowledgeBaseService` (the demonstration consumer) now takes
  `WorkspaceRepo + KnowledgeBaseRepo + EmbeddingServiceRepo +
  Pick<RerankingServiceRepo, "getRerankingService">` instead of the
  full store. The `resolveKb` helper makes the same shift.

This is a pure type-level split. The three backend impls
(`memory/store.ts`, `file/store.ts`, `astra/store.ts`) are unchanged
and are now structurally typed against the union of all twelve repo
interfaces.

## Consequences

**Easier:**

- Service signatures advertise their actual data dependencies.
- Test fakes shrink to the repos a given test exercises.
- Future per-aggregate impl extraction (each backend's monolithic
  store split into composable per-aggregate modules) has a stable
  type seam to compile against.

**Harder:**

- One additional file to read when discovering an interface. The
  per-repo files are short (under 100 lines each) and named after
  the aggregate, so this is a navigation cost rather than a
  comprehension cost.

**Deferred:**

- The per-aggregate **impl** extraction — splitting each ~1500-line
  backend file into composable per-aggregate modules — is queued as
  a follow-up. That work uses these interfaces as the seam. *Update
  (2026-05, [#199](https://github.com/datastax/ai-workbench/pull/199)):
  the memory backend has been extracted into per-aggregate slices
  under `control-plane/memory/`; `file/` and `astra/` remain
  monolithic for now.*
- Pagination cursors as a first-class repo capability (currently the
  list methods return everything and `paginate()` slices in memory)
  is a separate P1 tracked outside this ADR.

## References

- [PR #156](https://github.com/datastax/ai-workbench/pull/156) —
  the per-aggregate interface split.
- [ADR 0001](./0001-services-domain-layer.md) — the services layer
  whose dependencies this split narrows.
- `runtimes/typescript/src/control-plane/repos/` — the twelve
  per-aggregate interfaces.
