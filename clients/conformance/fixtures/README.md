# Fixtures

Normalized, expected HTTP request payloads for each scenario in
[`../scenarios.md`](../scenarios.md).

One file per scenario: `<scenario-slug>.json`.

## Empty for now

The canonical TypeScript client lands in PR-1a.2 (`src/astra-client/`).
Fixtures are materialized by running the TS client against
`../mock-astra` and normalizing the captures — that command is
`npm run conformance:regenerate` (also added in PR-1a.2).

Until then, language ports (including Python) scaffold their client
shape against [`../scenarios.md`](../scenarios.md) without a byte-diff
assertion. The CI gate flips on once fixtures exist.

## Updating fixtures

When an API shape changes intentionally:

1. Update the TS client.
2. Run `npm run conformance:regenerate`.
3. Run each language's tests — they will diff against the new fixtures.
4. Update each language client until every test passes.
5. Land all of it in one PR.
