# Runtimes ("green boxes")

One directory per language-native implementation of the AI Workbench
HTTP runtime. Every runtime serves the same `/api/v1/*` contract and
speaks Astra via its language-native SDK internally.

The UI picks which runtime to target at deploy time via the
**`BACKEND_URL`** environment variable on the UI.

```
Browser (UI)
    │  BACKEND_URL=http://localhost:8080   (default: UI + TS runtime in one container)
    │  BACKEND_URL=http://py-runtime:8080  (alternative: point at the Python runtime)
    ▼
Runtime (HTTP server)        ← any language, same /api/v1/* contract
    │
    ▼
Astra Data API (via language-native SDK: astrapy, astra-db-ts, …)
```

## Current runtimes

| Runtime | Path | Status | Astra SDK |
|---|---|---|---|
| TypeScript | [`typescript/`](./typescript/) | Operational through Phase 3 + auth (UI, playground, API keys, OIDC login + silent refresh, vector/text search, hybrid + rerank, sync/async ingest, durable JobStore with cross-replica subscription polling, lease/heartbeat, orphan sweeper, saved queries) | `@datastax/astra-db-ts` |
| Python | [`python/`](./python/) | Scaffold — routes return 501 until implemented | `astrapy` (pending) |
| Java | [`java/`](./java/) | Scaffold (Spring Boot) — routes return 501 until implemented | `astra-db-java` (pending) |

The TypeScript runtime is the **default ship path** — it gets bundled
with the UI into one Docker image. Alternative-language runtimes
deploy as separate containers.

## Shared infrastructure

- **[`../conformance/`](../conformance/)** — cross-runtime contract
  tests. Every runtime must pass the scenarios in
  `conformance/scenarios.json` and produce responses that diff clean
  against `conformance/fixtures/*.json`.
- **Root `package.json`** — pass-through scripts for convenience.
  `npm run dev`, `npm test`, `npm run conformance:mock` etc. all
  delegate into `runtimes/typescript/`.

## Adding a new language

1. `mkdir runtimes/<lang>/`.
2. Scaffold an HTTP server exposing `/api/v1/*` — same routes and
   response shapes as the TypeScript reference at
   [`typescript/src/routes/`](./typescript/src/routes/).
3. Use the language-native DataStax Astra SDK (not raw HTTP) for any
   Astra I/O.
4. Add a test harness that runs
   [`../conformance/scenarios.json`](../conformance/scenarios.json)
   against your app, normalizes responses, and diffs against the
   shared fixtures.
5. Add a row to the [current runtimes](#current-runtimes) table
   above.
6. Add a CI job that installs your runtime's deps and runs its tests.

## Design principles

- **Runtime-native, not a shared library.** Each runtime embeds its
  own workbench-specific logic and uses its language-native Astra SDK
  directly. No intermediate wrapper library to maintain per language.
- **HTTP contract is the only cross-runtime contract.** Internal code
  can diverge freely — idiomatic Python shouldn't look like idiomatic
  TypeScript.
- **Fixtures are the source of truth.** A change to the external
  contract is a fixture update plus an update in every runtime, all
  in one PR.
