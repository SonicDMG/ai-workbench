# AI Workbench — TypeScript Runtime

This is the **default, production-ready** AI Workbench runtime.
It serves the full `/api/v1/*` contract, hosts the embedded web UI,
and is the only runtime bundled into the published Docker image.
Python and Java runtimes (under `../python/` and `../java/`) are
preview scaffolds working toward parity through the same conformance
fixtures.

For the cross-runtime architecture and contract spec, see
[`docs/green-boxes.md`](../../docs/green-boxes.md) and
[`docs/architecture.md`](../../docs/architecture.md).

## Quickstart

```bash
# From the repo root
cd runtimes/typescript
npm install
npm run dev          # tsx watch — hot-reloads on save
```

The runtime listens on `http://localhost:8080` by default.
Routes you'll touch first:

| Path | Purpose |
|---|---|
| `GET /healthz` | Liveness probe |
| `GET /readyz` | Readiness (workspace count) |
| `GET /docs` | Scalar-rendered API reference |
| `GET /api/v1/openapi.json` | Machine-readable contract |
| `GET /api/v1/workspaces` | Workspace list |

The embedded UI loads from `apps/web/dist/` if present. Run
`npm --prefix ../../apps/web run build` once to populate it; the
runtime auto-detects the bundle and serves it at `/`.

## Configuration

Configuration is layered:

1. `workbench.yaml` (canonical) — see
   [`docs/configuration.md`](../../docs/configuration.md) and the
   examples in [`docs/examples/`](../../docs/examples/).
2. `.env` (repo root) — secrets and select runtime overrides. See
   [`.env.example`](../../.env.example) for the supported keys.
3. Process environment — wins over `.env` for matching keys.

The default control-plane driver is `memory` (no persistence). For
durable single-node deployments, switch to the `file` driver. For
clustered or production deployments, switch to `astra`. All three
implement the same `ControlPlaneStore` contract; conformance tests
exercise each.

### Common environment variables

| Variable | Purpose |
|---|---|
| `LOG_LEVEL` | Override `runtime.logLevel` (`trace`/`debug`/`info`/`warn`/`error`) |
| `WORKBENCH_CONFIG_FILE` | Path to `workbench.yaml` (default: repo-root) |
| `WORKBENCH_ENV_FILE` | Override `.env` path |
| `ASTRA_DB_API_ENDPOINT` / `ASTRA_DB_APPLICATION_TOKEN` | Astra control-plane credentials (auto-resolved from `astra` CLI when present) |
| `HUGGINGFACE_API_KEY` | Required when `chat:` is configured |
| `APP_VERSION` / `APP_COMMIT` / `APP_BUILD_TIME` | Set by the Docker build to override [`src/version.ts`](src/version.ts) defaults |

## npm scripts

| Script | What it does |
|---|---|
| `npm run dev` | tsx watch — local dev with hot reload |
| `npm start` | Run the compiled `dist/root.js` (used inside the Docker image) |
| `npm run build` | `tsc -p tsconfig.build.json` — emit JS to `dist/` |
| `npm run typecheck` | Strict typecheck without emitting |
| `npm test` | `vitest run` — unit + integration + conformance drift guard |
| `npm run test:coverage` | `vitest run --coverage` — enforces ratcheted thresholds |
| `npm run test:watch` | `vitest` — watch mode |
| `npm run conformance:mock` | Boot the mock-Astra server (used by conformance tests) |
| `npm run conformance:regenerate` | Re-record `conformance/fixtures/*` from the TS runtime |
| `npm run smoke:astra` | One-shot smoke test against a real Astra DB |
| `npm run dump:openapi` | Write the generated OpenAPI doc to `dist/openapi.json` |

## Layout

```
src/
├── app.ts                      Hono app wiring (middleware, routes, error handling)
├── root.ts                     boot sequence (config, secrets, drivers, server)
├── version.ts                  VERSION / COMMIT / BUILD_TIME — read by /healthz banner
├── config/                     workbench.yaml schema + loader
├── auth/                       API-key + OIDC verifiers, deployment guard
├── secrets/                    secret resolver (env, file) + startup preflight
├── control-plane/              memory/file/astra drivers + factory
├── drivers/                    vector store registry (data plane)
├── embeddings/                 embedder factory + provider adapters
├── ingest/                     chunkers, pipeline, payload keys
├── jobs/                       job store, ingest worker, orphan sweeper
├── chat/                       chat service, agent dispatcher, tool registry
├── routes/api-v1/              HTTP route handlers (one file per resource family)
├── plugins/                    route-plugin registry (extension points)
├── mcp/                        Model Context Protocol façade (read-only)
├── openapi/schemas.ts          shared Zod + OpenAPI schemas
├── ui/                         embedded web UI assets resolver
└── lib/                        cross-cutting helpers (logger, request-id, limits, ...)
```

Tests live in `tests/` mirroring the `src/` tree, plus `tests/conformance/`
which exercises the cross-runtime fixtures in `../../conformance/`.

## Production hardening checklist

See [`docs/production.md`](../../docs/production.md) for the canonical
list. Quick-reference highlights:

- Set `runtime.environment: production` to enforce the hardening
  checks (durable control plane, auth.mode != disabled, anonymousPolicy:
  reject, https publicOrigin, RFC1918 endpoint block, ...).
- Configure `auth.mode: apiKey` or `oidc` (NOT `disabled`).
- Set `runtime.publicOrigin` to your https URL — the runtime uses it
  to derive secure-cookie + OIDC redirect URIs without trusting
  spoofable Host headers.
- Provide `auth.oidc.client.sessionSecretRef` for clustered deploys.
  Without it, the runtime generates an ephemeral key per replica and
  sessions break across pod restarts / load-balanced replicas.
- Add network egress controls upstream of the runtime; the
  `runtime.blockPrivateNetworkEndpoints` schema check is layered
  defense, not a substitute for VPC NetworkPolicies.

## Troubleshooting

- **`startup secret check failed for N ref(s)`** — the preflight
  walks every `*Ref` in your config and probes the resolver. The
  message names which refs and why; usually a missing `.env` value or
  a typo'd `env:VAR_NAME`.
- **`ui disabled — no dist found`** — run
  `npm --prefix apps/web run build` from the repo root, then restart.
- **Astra `controlPlane.driver` 401** — the token in `tokenRef` may
  not have access to the configured keyspace. Confirm with
  `npm run smoke:astra`.
- **Conformance drift test fails** — your route changes affect the
  shape of an existing response. Review the diff, then either
  `npm run conformance:regenerate` (intentional) or revert
  (regression). See [`../../conformance/README.md`](../../conformance/README.md).

## See also

- [`docs/architecture.md`](../../docs/architecture.md) — system overview
- [`docs/api-spec.md`](../../docs/api-spec.md) — narrative API reference
- [`docs/configuration.md`](../../docs/configuration.md) — `workbench.yaml`
- [`docs/auth.md`](../../docs/auth.md) — auth modes and OIDC setup
- [`docs/production.md`](../../docs/production.md) — production checklist
- [`docs/conformance.md`](../../docs/conformance.md) — cross-runtime contract
