# Clients

Polyglot client libraries that wrap the **Workbench Astra Client** (the
"green box" in the architecture diagram). Each language exposes the same
operations against the same Astra Data API surface: `wb_*` table CRUD
(control plane) and collection CRUD + search (data plane).

## Why the same library in every language

The AI Workbench runtime is TypeScript today, but the same operational
shape — "create a workspace row", "list catalogs", "provision a vector
collection" — needs to be callable from Python, Java, etc. Each language
gets an idiomatic wrapper; all of them emit **byte-identical HTTP
requests** to Astra's Data API.

That byte-identical property is enforced by the
[conformance suite](./conformance/README.md).

## Layout

```
clients/
├── typescript/              # Will live in src/astra-client for now (PR-1a.2).
│                            # Breaks out here once we cut an npm package.
├── python/                  # workbench-astra-client (pip)
├── conformance/             # cross-language contract tests
│   ├── mock-astra/          # local HTTP server that mimics Astra Data API
│   ├── scenarios.md         # ordered op sequences each client must replay
│   ├── fixtures/            # captured, normalized request payloads
│   └── normalize.mjs        # shared UUID/timestamp scrubber
└── README.md                # this file
```

## Adding a new language

1. Create `clients/<language>/`.
2. Implement the operations listed in
   [`conformance/scenarios.md`](./conformance/scenarios.md).
3. Write a test that:
   - Resets the mock: `POST http://localhost:<port>/_reset`.
   - Runs the scenarios against the mock.
   - Fetches the captured requests: `GET http://localhost:<port>/_captured`.
   - Normalizes them (UUIDs, timestamps) using the same rules
     [`conformance/normalize.mjs`](./conformance/normalize.mjs) applies.
   - Diffs against `conformance/fixtures/<scenario>.json`.
4. Wire the test into CI.

## Design principles

- **No per-language reinvention of types.** The shape of
  `WorkspaceRecord`, `CatalogRecord`, etc. comes from
  [`../src/control-plane/types.ts`](../src/control-plane/types.ts). Ports
  translate those types idiomatically (snake_case in Python, etc.) but
  don't invent new fields.
- **Fixtures are the contract.** A change to what the client sends to
  Astra is a PR that updates the fixture AND every client in the same
  commit.
- **Small, opinionated, no optional knobs.** The point is cross-language
  uniformity, not maximum flexibility.
