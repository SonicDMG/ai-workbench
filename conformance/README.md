# Conformance Suite

Blackbox contract tests that every **green box** runtime must pass.

## Problem

We have one API shape (`/api/v1/*`) and N language implementations of
it — TypeScript at [`../runtimes/typescript/`](../runtimes/typescript/),
Python at [`../runtimes/python/`](../runtimes/python/), others to
follow. If any runtime drifts in its HTTP behavior (different status
codes, different response shapes, different error envelopes), users
who point `BACKEND_URL` at the "wrong" green box get silently
inconsistent results.

## Solution

Each runtime runs the same ordered scenarios as HTTP requests against
itself, normalizes the responses, and diffs against shared fixtures.

1. **[`mock-astra/`](./mock-astra/)** is a local HTTP server that
   stands in for a real Astra endpoint. Every runtime points its
   Astra config at this during tests — so no real DB is needed, and
   every runtime sees the same (deterministic) Astra responses.
2. **[`scenarios.md`](./scenarios.md)** defines ordered HTTP request
   sequences. Every runtime MUST be able to execute these.
3. **[`fixtures/`](./fixtures/)** holds the expected, normalized
   response payloads. One JSON file per scenario.
4. **[`normalize.mjs`](./normalize.mjs)** replaces UUIDs, timestamps,
   and request IDs with stable placeholders so diffs only fail on
   real behavioral drift.

Each runtime's test harness:

```
1. Point the runtime at mock-astra (usually via env vars).
2. Start the runtime in-process.
3. POST /_reset                        → clear mock-astra's log.
4. Run the scenario as HTTP requests against the runtime's /api/v1/*.
5. Collect runtime responses, normalize them.
6. Diff against fixtures/<scenario>.json.
```

A diff means the runtime drifted from the contract. Either fix the
runtime, or — if the contract changed — regenerate the fixture and
land updates to every runtime in the same PR.

## Running the mock

From the repo root:

```bash
npm run conformance:mock
```

Default bind: `http://127.0.0.1:4010`. Override with
`PORT=... HOST=... npm run conformance:mock`.

## Normalization rules

Enforced by [`normalize.mjs`](./normalize.mjs):

- UUIDs in order of first appearance → `{{UUID_1}}`, `{{UUID_2}}`, ...
- ISO-8601 timestamps → `{{TS}}` (collapsed — ms-granularity
  collisions between records make ordered placeholders
  non-deterministic)
- 32-char hex request IDs in order of first appearance → `{{REQID_N}}`
- Object keys sorted alphabetically

Port this file verbatim if you write a test harness in a language that
can't call the JS module directly.

## Scenarios

See [`scenarios.md`](./scenarios.md). Each scenario is a short
numbered list of HTTP requests to run in order. Fixtures live at
`fixtures/<scenario-slug>.json`.

## Why mock-astra still exists in the blackbox model

We're diffing **runtime responses**, not the requests each runtime
sends to Astra. So why keep the mock?

1. **Deterministic backend.** Without a mock, scenarios would depend
   on whatever real Astra returns — slow, flaky, and requires
   credentials.
2. **No external state.** Tests need a clean slate per run; mock-astra
   resets instantly on `POST /_reset`.
3. **Debugging.** The mock still captures Astra-bound requests. When
   a scenario fails, inspect `GET /_captured` to see what the runtime
   sent. Not a conformance assertion — just a diagnostic.

## Regenerating fixtures

When an intentional API change lands, rebuild the fixtures from the
canonical TypeScript runtime:

```bash
npm run conformance:regenerate
```

Then run every language's tests — any remaining diffs surface the
runtimes that still need updates.
