# Green Boxes

Each directory under `clients/*-runtime/` is a **green box** — a
language-native HTTP-API implementation of the AI Workbench runtime.
Every green box exposes the same `/api/v1/*` surface and speaks Astra's
Data API internally through its language-native client.

The **TypeScript runtime is the default** and ships embedded with the
UI at the repo root ([`../src/`](../src/)). Alternative-language
runtimes live here. Which one the UI targets is decided at deploy time
via the **`BACKEND_URL`** environment variable on the UI.

```
Browser (UI)
    │  BACKEND_URL=http://localhost:8080  (default = embedded TS runtime)
    │  BACKEND_URL=http://py-runtime:8080 (alternative = Python runtime)
    ▼
Green box (HTTP server)        ← any language, same /api/v1/* contract
    │
    ▼
Astra Data API (via language-native SDK: astrapy, astra-db-ts, …)
```

## Current runtimes

| Runtime | Location | Status | Astra SDK |
|---|---|---|---|
| TypeScript (default) | [`../src/`](../src/) | Operational skeleton; control-plane interface shipped | `@datastax/astra-db-ts` (pending) |
| Python | [`python-runtime/`](./python-runtime/) | Scaffold — routes return 501 | `astrapy` (pending) |
| Java | not yet started | — | `astra-db-java` |

## Cross-runtime conformance

Every green box must behave identically to users of `/api/v1/*`. We
enforce this via blackbox conformance tests in
[`conformance/`](./conformance/).

Each runtime's test harness:
1. Starts the runtime in-process, pointing its Astra config at
   [`conformance/mock-astra`](./conformance/mock-astra).
2. Runs the ordered scenarios in
   [`conformance/scenarios.md`](./conformance/scenarios.md) as HTTP
   requests against `/api/v1/*`.
3. Normalizes responses (UUIDs, timestamps, request IDs) via
   [`conformance/normalize.mjs`](./conformance/normalize.mjs).
4. Diffs against shared fixtures in
   [`conformance/fixtures/`](./conformance/fixtures/).

The fixtures are the **contract**. If a runtime drifts, its CI fails.
If the contract itself changes, the fixture update lands alongside
every runtime's update in one PR.

## Adding a new language

1. Create `clients/<language>-runtime/`.
2. Scaffold an HTTP server exposing `/api/v1/*` — same routes, same
   request/response shapes as the TypeScript reference at
   [`../src/routes/`](../src/routes/).
3. Use the language-native DataStax Astra SDK (not raw HTTP). The
   conformance tests are blackbox, so internal implementation choices
   are the language's own.
4. Add a test harness that runs
   [`conformance/scenarios.md`](./conformance/scenarios.md) against
   your running app and diffs responses against the shared fixtures.
5. Wire into CI.
6. Add a row to the [current runtimes](#current-runtimes) table above.

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
