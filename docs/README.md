# AI Workbench — Documentation

This directory is the source of truth for the AI Workbench contract during
**Phase 0**. Code will follow; the contract leads.

## Start here

1. [`architecture.md`](architecture.md) — what AI Workbench is and how the
   pieces fit together.
2. [`workspaces.md`](workspaces.md) — the workspace model (prod / dev / mock).
3. [`configuration.md`](configuration.md) — the `workbench.yaml` schema.
4. [`api-spec.md`](api-spec.md) — the HTTP surface (Phase 0 + forward-looking).
5. [`roadmap.md`](roadmap.md) — phased delivery plan and open questions.

## Samples

- [`examples/workbench.yaml`](examples/workbench.yaml) — annotated sample
  config covering `prod`, `dev`, and `mock` workspaces.

## Contributing to the contract

These documents change more often than code during Phase 0. When you propose
a change:

- Land the docs change **in the same PR** as any supporting code.
- When introducing a new route, update both `api-spec.md` and the top-level
  `README.md` if the route is user-facing.
- When changing the config schema, bump `version:` only on breaking changes
  and add a migration note to `configuration.md`.
