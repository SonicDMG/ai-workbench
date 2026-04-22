# Cross-runtime conformance

Every language green box must produce byte-identical `/api/v1/*`
responses for a shared set of scenarios. This document describes the
harness that enforces that guarantee, how to run it locally, and how
to update it when the contract changes.

## Why

We have one HTTP contract and (soon) multiple language-native
implementations. If any runtime drifts — different status codes,
different response shapes, different error envelopes — operators
swapping `BACKEND_URL` between runtimes get silently inconsistent
behavior.

Fixture-based diffs catch drift the moment it shows up, regardless
of which runtime introduced it.

## What lives where

```
conformance/
├── scenarios.json              ← machine-readable scenarios
├── fixtures/                   ← expected normalized responses
│   ├── workspace-crud-basic.json
│   ├── catalog-under-workspace.json
│   └── vector-store-definition.json
├── mock-astra/
│   └── server.ts               ← stand-in Astra endpoint (Node)
├── normalize.mjs               ← shape-agnostic placeholder scrubber
├── runner.mjs                  ← generic scenario runner
└── README.md                   ← overview for contributors
```

And inside the TypeScript runtime:

```
runtimes/typescript/
├── scripts/
│   └── conformance-regenerate.ts   ← runs the canonical TS runtime against itself,
│                                     writes fixtures
└── tests/conformance/
    └── drift.test.ts               ← drift guard — fails if the TS runtime
                                      changes shape without updating fixtures
```

## Scenarios

`conformance/scenarios.json` is a JSON array. Each entry:

```json
{
  "slug": "workspace-crud-basic",
  "description": "Minimum viable workspace lifecycle.",
  "steps": [
    { "method": "POST", "path": "/api/v1/workspaces", "body": {...} },
    { "method": "GET",  "path": "/api/v1/workspaces" },
    { "method": "GET",  "path": "/api/v1/workspaces/$1.uid" },
    ...
  ]
}
```

`$N.field` references the `field` of step N's raw response body (1-indexed).
Supports dot-paths: `$1.uid`, `$2.workspace.uid`, etc.

Current scenarios:

| Slug | Covers |
|---|---|
| `workspace-crud-basic` | Workspace POST / GET / PUT / DELETE lifecycle |
| `catalog-under-workspace` | Catalogs scoped per workspace |
| `vector-store-definition` | Vector-store descriptor create + read |

More land as Phase 2 routes (documents, ingest, search, queries)
ship.

## Fixtures

One JSON file per scenario in
[`conformance/fixtures/`](../conformance/fixtures/):

```json
{
  "slug": "workspace-crud-basic",
  "description": "...",
  "captures": [
    {
      "step": 1,
      "request":  { "method": "POST", "path": "/api/v1/workspaces", "body": {...} },
      "response": { "status": 201, "body": {...} }
    },
    ...
  ]
}
```

All volatile values (UUIDs, timestamps, request IDs) are replaced
with stable placeholders — see [Normalization](#normalization).

Fixtures are the **source of truth** for cross-runtime behavior. Any
change to them must be accompanied by matching updates in every
language runtime, all in one PR.

## Normalization

[`normalize.mjs`](../conformance/normalize.mjs) walks any JSON
tree and substitutes:

| Value shape | Replacement | Strategy |
|---|---|---|
| RFC 4122 UUID | `{{UUID_N}}` | 1-indexed, by first appearance |
| ISO-8601 timestamp | `{{TS}}` | Collapsed to a single placeholder (millisecond collisions between records made indexed placeholders non-deterministic) |
| 32-char hex request ID | `{{REQID_N}}` | 1-indexed, by first appearance |

Object keys are also sorted alphabetically for deterministic output.

Port this file verbatim into any language whose conformance harness
needs to compare against these fixtures — the ordering rules and
placeholder names are the contract.

## Running the suite

### TypeScript runtime (default)

The drift test is part of the main Vitest suite:

```bash
npm test
```

See `runtimes/typescript/tests/conformance/drift.test.ts` — 4 tests (3 scenarios + one
"every scenario has a fixture" sanity check).

### Regenerating fixtures

Only when you've **intentionally** changed the contract:

```bash
npm run conformance:regenerate
```

This spins up a fresh memory-backed TS runtime in-process, replays
every scenario via `app.request(...)`, normalizes the captures, and
writes the fixture files. Commit the output alongside the runtime
change in the same PR.

### Python runtime

Point at a running mock Astra (needed so the runtime has a
deterministic backend):

```bash
# Repo root, terminal 1:
npm run conformance:mock          # listens on :4010

# From runtimes/python/, terminal 2:
python -m venv .venv && source .venv/bin/activate
pip install -e '.[dev]'
pytest
```

Until Stefano implements the FastAPI routes, `xfail(strict=True)`
markers guard the scenarios. Each marker comes off as its scenario
goes green.

## The mock Astra server

Every green box's conformance suite points its Astra config at
[`conformance/mock-astra/`](../conformance/mock-astra/).
It's a tiny Node HTTP server that:

- Accepts any request and returns a stub success envelope.
- Captures every inbound request for optional inspection via
  `GET /_captured`.
- Resets its capture log via `POST /_reset`.

It exists because the fixtures describe the **runtime's outbound
responses to its clients**, but a runtime still needs *some* Astra
endpoint to talk to during tests. The mock gives every language
runtime the same deterministic backend without needing Astra
credentials in CI.

The mock's request log is **not** a conformance assertion target —
it's a debugging tool. If your runtime's responses differ from the
fixtures, you can inspect `GET /_captured` to see what it sent
upstream.

## When to update fixtures

- ✅ You intentionally changed a response body, status code, or
  error envelope shape.
- ✅ You added or removed a route exercised by a scenario.
- ✅ You added a new scenario.

- ❌ Never to "fix a flake." Fixtures are deterministic by
  construction; a flake means normalization is wrong or a runtime is
  non-deterministic. Fix the root cause.
- ❌ Never in isolation. A fixture update with no code change means
  the committed fixture is wrong. Revert and investigate.

## Adding a scenario

1. Append to `conformance/scenarios.json`.
2. Add narrative description to
   [`conformance/scenarios.md`](../conformance/scenarios.md).
3. Run `npm run conformance:regenerate` to materialize the fixture.
4. Run every language runtime's tests — any drift surfaces the
   runtimes that need updates. Update them in the same PR.
5. Commit fixtures + scenario + every runtime update together.
