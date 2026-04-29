# Contributing to AI Workbench

Thanks for taking the time to contribute. This guide covers how to
set up a dev environment, what we expect in a pull request, and the
extra rules that apply when you change the cross-runtime API
contract.

For security issues, **don't open a public issue** — see
[`SECURITY.md`](./SECURITY.md) for the private reporting channel.

## Local setup

The default loop runs the TypeScript runtime + bundled UI. Two
terminals get you a workspace in under a minute:

```bash
# Terminal 1 — root devDeps + TS runtime, then boot
npm ci && npm run install:ts
npm run dev                # http://localhost:8080

# Terminal 2 — web UI dev server (hot reload)
npm run install:web
npm run dev:web            # http://localhost:5173
```

The Vite dev server proxies `/api/*`, `/auth/*`, and `/docs` to
`:8080` so the UI is same-origin with the runtime in dev. Override
the target with `VITE_API_TARGET` — see
[`apps/web/.env.example`](./apps/web/.env.example).

The default in-memory control plane needs no secrets. To exercise
the Astra-backed control plane, copy
[`.env.example`](./.env.example) to `.env` and fill in
`ASTRA_DB_API_ENDPOINT` + `ASTRA_DB_APPLICATION_TOKEN`, or rely on
the `astra` CLI ([`docs/astra-cli.md`](./docs/astra-cli.md)). Switch
drivers via `workbench.yaml` — see
[`docs/configuration.md`](./docs/configuration.md).

## Before you push

The CI gate is `lint → typecheck → test → coverage → build` for both
the runtime and the web app, plus a Docker smoke build, plus a
Playwright golden-path E2E. Run the equivalent locally:

```bash
npm run lint                          # Biome (root)
npm run typecheck                     # TS runtime
npm --prefix apps/web run typecheck   # Web UI
npm test                              # TS runtime — Vitest + conformance drift guard
npm --prefix apps/web test            # Web UI — Vitest + jsdom
```

Coverage thresholds are enforced in `vitest.config.ts` for both
packages — `npm run test:coverage` (root → TS runtime) and
`npm --prefix apps/web run test:coverage` are the same commands CI
runs.

If your change touches Playwright (`apps/web/e2e/`), run it locally:

```bash
npm --prefix apps/web run e2e:install   # one-time browser download
npm --prefix apps/web run test:e2e
```

## Pull request expectations

- **Branch from `main`.** Use a descriptive prefix: `feat/`, `fix/`,
  `chore/`, `docs/`, `refactor/`, `test/`.
- **Commit messages follow Conventional Commits.** Examples from
  recent history: `feat(mcp): expose workspaces as Model Context
  Protocol servers`, `fix(mcp): close transport after body
  flushes, not before`, `chore: redact personal info from docs,
  schemas, and tests`. Scope is optional but useful when the diff
  touches one subsystem.
- **One concern per PR.** Bug fixes, refactors, and feature work
  should not share a PR — they review differently.
- **Tests required.** New behavior needs tests; new bug fixes
  should have a regression test that fails on `main`.
- **Don't skip hooks** (`--no-verify` / `--no-gpg-sign`). If a hook
  fails, fix the underlying issue.

## When you change the API contract

The runtime ships an `/api/v1/*` HTTP contract that all language
runtimes (TypeScript today, Python and Java in development) must
satisfy. Adding or changing a route is a contract change.

- **Update [`docs/api-spec.md`](./docs/api-spec.md)** in the same
  PR. The narrative there is the authority humans read.
- **Add a conformance scenario** when a new behavior is worth
  pinning across runtimes. Edit
  [`conformance/scenarios.json`](./conformance/scenarios.json),
  then regenerate fixtures:
  ```bash
  npm --prefix runtimes/typescript run conformance:regenerate
  ```
  Commit the fixture diff alongside the route change.
- **OpenAPI is auto-generated.** Routes use `@hono/zod-openapi`, so
  there's no separate spec file to keep in sync — the schema is
  rendered live at `/api/v1/openapi.json` and at `/docs` (Scalar).
- **Update Python and Java models** when you add a route. The
  scaffolds in [`runtimes/python/`](./runtimes/python/) and
  [`runtimes/java/`](./runtimes/java/) mirror the TypeScript Zod
  schemas; new endpoints should at minimum return `501
  not_implemented` with matching request/response shapes so the
  conformance test for the new scenario can be marked `xfail`
  (Python) / `@Disabled` (Java) in the same PR.

## When you change `workbench.yaml`

- Bump `version:` only on **breaking** schema changes.
- Document the migration in
  [`docs/configuration.md`](./docs/configuration.md). Include a
  before/after example.
- Keep [`docs/examples/workbench.yaml`](./docs/examples/workbench.yaml)
  current — it's referenced from multiple docs as the canonical
  sample.

## When you add a language runtime

- Add a row to the "current runtimes" table in
  [`docs/green-boxes.md`](./docs/green-boxes.md).
- Wire its tests into [`.github/workflows/runtimes.yml`](./.github/workflows/runtimes.yml)
  so changes under `runtimes/<lang>/**` gate on a real test job.
- Point the runtime at `conformance/mock-astra/` so the same
  scenarios run unmodified.

## Style

Biome enforces formatting + lint at the root. Run `npm run lint:fix`
to apply autofixes. The repo defaults to `tabs` for indentation and
double-quoted strings — don't override these in editor settings.

TypeScript: `strict: true` and `noUncheckedIndexedAccess: true` are
mandatory. `any` is reserved for test JSON helpers (see
`runtimes/typescript/tests/app.test.ts`'s `json()` helper) — flag
production-code `any` with a `// biome-ignore` and a real reason.
