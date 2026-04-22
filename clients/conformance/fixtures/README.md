# Fixtures

Normalized, expected HTTP **response payloads** (status, headers,
body) for each scenario in [`../scenarios.md`](../scenarios.md).

One file per scenario: `<scenario-slug>.json`.

## Empty for now

Fixtures are materialized from the canonical TypeScript runtime once
its route implementations land in PR-1a.2. The command will be
`npm run conformance:regenerate`: run the TS runtime against
[`../mock-astra/`](../mock-astra/), replay each scenario, normalize
responses, write the fixture files.

Until then, language-native runtimes scaffold their routes against
[`../scenarios.md`](../scenarios.md) without a byte-diff assertion.
The CI gate flips on once fixtures exist.

## What a fixture captures

Response shape for every step in the scenario:

```json
[
  {
    "step": 1,
    "request": { "method": "POST", "path": "/api/v1/workspaces" },
    "response": {
      "status": 201,
      "headers": { "content-type": "application/json", ... },
      "body": { "uid": "{{UUID_1}}", "name": "prod", ... }
    }
  },
  ...
]
```

UUIDs, timestamps, and request IDs are replaced with stable
placeholders (see [`../normalize.mjs`](../normalize.mjs)).

## Updating fixtures

When an API shape changes intentionally:

1. Update the canonical TS runtime.
2. Run `npm run conformance:regenerate`.
3. Run every language runtime's tests — they will diff against the
   new fixtures.
4. Update each runtime until every test passes.
5. Land all of it in one PR.
