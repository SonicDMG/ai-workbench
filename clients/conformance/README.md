# Conformance Suite

Cross-language contract tests for the Workbench Astra Client.

## Problem

We'll have the same client library in TypeScript, Python, Java, etc. Each
one translates the same operation (e.g. `create_workspace`) into an HTTP
request to Astra's Data API. If any language drifts — sends a different
path, a different body, a different header — we get silent behavioral
divergence across the stack.

## Solution

1. **[`mock-astra/`](./mock-astra/)** is a local HTTP server that looks
   enough like Astra's Data API to satisfy any client, and captures every
   inbound request.
2. **[`scenarios.md`](./scenarios.md)** defines ordered operation
   sequences. Every language client MUST be able to execute these
   scenarios against the mock.
3. **[`fixtures/`](./fixtures/)** holds the expected, normalized request
   payloads. One JSON file per scenario.
4. **[`normalize.mjs`](./normalize.mjs)** replaces UUIDs and timestamps
   with stable placeholders so fixtures don't break on every run.

Each language's test harness:

```
1. Start the mock (or point at an already-running instance).
2. POST /_reset                     → clear captured requests.
3. Run the scenario using the client.
4. GET /_captured                   → fetch captured requests as JSON.
5. Normalize with the shared rules.
6. Assert equality against fixtures/<scenario>.json.
```

A diff means the client drifted. Update the client, or — if the drift
was intentional — update the fixture and every language client in the
same PR.

## Running the mock

From the repo root:

```bash
npm run conformance:mock
```

The mock listens on `http://localhost:4010` by default. Override with
`PORT=4020 npm run conformance:mock`.

## Normalization rules

Enforced by [`normalize.mjs`](./normalize.mjs):

- UUIDs in order of first appearance → `{{UUID_1}}`, `{{UUID_2}}`, ...
- ISO-8601 timestamps in order of first appearance → `{{TS_1}}`,
  `{{TS_2}}`, ...
- Authorization header value → `{{TOKEN}}` (presence still checked).
- `User-Agent` stripped (per-language, always different).
- Header names lowercased, keys sorted alphabetically.

## Scenarios

See [`scenarios.md`](./scenarios.md). Each scenario is a short numbered
list of client operations. Fixtures live at
`fixtures/<scenario-slug>.json`.

## Regenerating fixtures

When an intentional API change lands, rebuild the fixtures:

```bash
# From the TS client (canonical — all languages align to this)
npm run conformance:regenerate
```

This runs the TS client against the mock, fetches captures, normalizes,
and writes the fixture files. Other languages then run their tests; any
diffs surface the languages that need updates.
