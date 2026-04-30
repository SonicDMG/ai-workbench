# AI Workbench documentation

Docs for AI Workbench: the self-hosted product surface for building,
inspecting, and operating retrieval-backed AI applications on DataStax
Astra.

The generated OpenAPI at `/api/v1/openapi.json` remains the canonical
API reference. These docs explain the product workflows around that
contract first, then the runtime architecture behind them.

## Start here

1. [`overview.md`](overview.md) — what AI Workbench is as a product and
   where to go next.
2. [`playground.md`](playground.md) — browser workflow for testing text,
   vector, hybrid, and rerank search.
3. [`agents.md`](agents.md) — user-defined agents: personas, RAG
   defaults, per-agent LLM service binding, and the conversation +
   message routes (HuggingFace-backed, multi-KB-grounded, SSE token
   streaming).
4. [`mcp.md`](mcp.md) — Model Context Protocol façade for external
   agents (Claude Code, Cursor, hosted MCP gateways).
5. [`workspaces.md`](workspaces.md) — workspace semantics, scoping,
   and cascade rules.
6. [`configuration.md`](configuration.md) — the `workbench.yaml`
   schema and deployment-oriented settings.
7. [`production.md`](production.md) — deployment hardening checklist
   for auth, persistence, secrets, and browser posture.
8. [`architecture.md`](architecture.md) — runtime model and how the
   pieces fit together.
9. [`green-boxes.md`](green-boxes.md) — the multi-runtime model and
   why we ship language-native implementations.
10. [`api-spec.md`](api-spec.md) — HTTP contract narrative (what
    operational routes exist, what errors are possible, what's
    planned).
11. [`auth.md`](auth.md) — the `/api/v1/*` auth middleware: config,
    contract, threat model, rollout phases.
12. [`conformance.md`](conformance.md) — how we keep language
    runtimes in lockstep via shared fixtures.
13. [`roadmap.md`](roadmap.md) — phased delivery plan and open
    questions.

## Design notes

- [`cross-replica-jobs.md`](cross-replica-jobs.md) — shipped design
  for cross-replica job pub/sub, lease reclaim, and in-flight ingest
  resume.
- [`route-plugins.md`](route-plugins.md) — proposed in-runtime plugin
  registry so adding a new resource module never edits `app.ts`.
  Scaffold (interface + registry + tests) shipped; route migrations
  follow.
- [`astra-cli.md`](astra-cli.md) — optional integration that
  auto-fills `ASTRA_DB_APPLICATION_TOKEN` / `ASTRA_DB_API_ENDPOINT`
  from a configured DataStax `astra` CLI profile at startup.

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
