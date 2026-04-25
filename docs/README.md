# AI Workbench — Documentation

Narrative docs for the AI Workbench runtime and its polyglot
"green box" architecture. The generated OpenAPI at
`/api/v1/openapi.json` is the canonical API reference — this
directory explains the shape of everything around it.

## Start here

1. [`architecture.md`](architecture.md) — what AI Workbench is and
   how the pieces fit together.
2. [`green-boxes.md`](green-boxes.md) — the multi-runtime model and
   why we ship language-native implementations.
3. [`workspaces.md`](workspaces.md) — workspace semantics, scoping,
   and cascade rules.
4. [`configuration.md`](configuration.md) — the `workbench.yaml`
   schema.
5. [`api-spec.md`](api-spec.md) — HTTP contract narrative (what
   operational routes exist, what errors are possible, what's
   planned).
6. [`auth.md`](auth.md) — the `/api/v1/*` auth middleware: config,
   contract, threat model, rollout phases.
7. [`conformance.md`](conformance.md) — how we keep language
   runtimes in lockstep via shared fixtures.
8. [`playground.md`](playground.md) — browser playground UX,
   text-vs-vector dispatch, hybrid + rerank toggles, ingest dialog.
9. [`roadmap.md`](roadmap.md) — phased delivery plan and open
   questions.

## Design notes

- [`cross-replica-jobs.md`](cross-replica-jobs.md) — proposed design
  for cross-replica job pub/sub and in-flight resume after restart.
  No code yet; sets the seam for the follow-up PR.

## Samples

- [`examples/workbench.yaml`](examples/workbench.yaml) — annotated
  sample config covering all three control-plane drivers.

## Contributing to the contract

These documents track the runtime; they're expected to change as the
runtime does.

- Land docs changes **in the same PR** as the supporting code.
- When adding a route: update [`api-spec.md`](api-spec.md) and, if
  there's a scenario worth adding, extend
  [`conformance/scenarios.json`](../conformance/scenarios.json)
  + regenerate fixtures (`npm run conformance:regenerate`).
- When changing the config schema: bump `version:` only on breaking
  changes and document the migration in
  [`configuration.md`](configuration.md).
- When a new language green box graduates from scaffold: add a row
  to the "current runtimes" table in
  [`green-boxes.md`](green-boxes.md).
