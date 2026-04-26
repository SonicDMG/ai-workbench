# AI Workbench

AI Workbench is a self-hosted product surface for building, inspecting,
and operating retrieval-backed AI applications on **DataStax Astra**.
It gives teams one place to manage workspaces, catalogs, vector stores,
document ingest, saved queries, API keys, and retrieval experiments.

Under the product UI is a stable HTTP runtime. The default TypeScript
runtime ships in the same Docker image as the UI; alternative
language-native runtimes ("green boxes") live under
[`runtimes/`](runtimes/) and expose the same `/api/v1/*` contract.

## At a glance

- **Workspace command center.** Workspaces isolate catalogs, vector
  stores, documents, saved queries, jobs, credentials, and API keys.
- **Knowledge operations.** Ingest raw text or files into catalogs,
  track sync/async job state, and bind content to the vector store that
  powers retrieval.
- **Retrieval playground.** Run text, vector, hybrid, and rerank
  searches in the browser against real workspace data.
- **Production-friendly controls.** Start in memory, switch to file
  storage for single-node deployments, or use Astra Data API tables for
  a durable control plane.
- **Technical spine intact.** One `/api/v1/*` contract, language-native
  runtimes, direct Astra SDK usage, secrets by reference, and
  fixture-enforced conformance.

## Architecture

```
                   ┌───────────────────────────────────────────┐
                   │               WorkBench UI                │
                   │                                           │
                   │   /playground   /ingest   (chats, MCP)    │
                   └─────────────────────┬─────────────────────┘
                                         │
                                    BACKEND_URL
                                         │
            ┌────────────────────────────┼────────────────────────────┐
            ▼                            ▼                            ▼
   ┌──────────────────┐       ┌──────────────────┐         ┌──────────────────┐
   │  TS runtime      │       │  Python runtime  │   …     │  Other language  │
   │  (default,       │       │  (FastAPI)       │         │  runtimes        │
   │   embedded       │       │                  │         │                  │
   │   with UI)       │       │                  │         │                  │
   │                  │       │                  │         │                  │
   │  /api/v1/*       │       │  /api/v1/*       │         │  /api/v1/*       │
   └────────┬─────────┘       └────────┬─────────┘         └────────┬─────────┘
            │                          │                            │
            └──────────────── same HTTP contract ───────────────────┘
                                       │
                                       ▼ (per-runtime Astra SDK)
                        ┌─────────────────────────────┐
                        │   Astra Data API            │
                        │     Tables (control plane): │
                        │       wb_workspaces         │
                        │       wb_catalog_by_ws      │
                        │       wb_vector_store_by_ws │
                        │       wb_documents_by_cat   │
                        │     Collections (data       │
                        │       plane): one per       │
                        │       vector store          │
                        └─────────────────────────────┘
```

See [`docs/architecture.md`](docs/architecture.md) for the full model.

## Quickstart

```bash
# Install root devDeps (Biome) + TS runtime deps.
npm ci && npm run install:ts

# Boot with the default in-memory control plane.
npm run dev                            # http://localhost:8080

# Hit it.
curl http://localhost:8080/healthz     # {"status":"ok"}
curl http://localhost:8080/docs        # Scalar-rendered API reference
```

The `npm run *` scripts at root delegate into
[`runtimes/typescript/`](runtimes/typescript/). You can also `cd`
into that directory and work there directly.

Switching to an Astra-backed control plane is a YAML change —
see [`docs/configuration.md`](docs/configuration.md).

## Current HTTP surface

All routes documented at `/docs` (Scalar UI) and
`/api/v1/openapi.json` (machine-readable).

### Operational (unversioned)

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/` | Service banner |
| `GET` | `/healthz` | Liveness probe |
| `GET` | `/readyz` | Readiness + workspace count |
| `GET` | `/version` | Build metadata |
| `GET` | `/docs` | Scalar-rendered API reference |

### `/api/v1/*`

| Method | Path | Purpose |
|---|---|---|
| `GET / POST` | `/api/v1/workspaces` | List / create workspaces |
| `GET / PUT / DELETE` | `/api/v1/workspaces/{w}` | Workspace CRUD (DELETE cascades) |
| `POST` | `/api/v1/workspaces/{w}/test-connection` | Resolve configured workspace credential refs |
| `GET / POST` | `/api/v1/workspaces/{w}/catalogs` | List / create catalogs |
| `GET / PUT / DELETE` | `/api/v1/workspaces/{w}/catalogs/{c}` | Catalog CRUD (DELETE cascades to documents + saved queries) |
| `GET / POST` | `/api/v1/workspaces/{w}/catalogs/{c}/documents` | List / create document metadata |
| `GET / PUT / DELETE` | `/api/v1/workspaces/{w}/catalogs/{c}/documents/{d}` | Document metadata CRUD |
| `GET` | `/api/v1/workspaces/{w}/catalogs/{c}/documents/{d}/chunks` | List the chunks under a document (id, chunkIndex, text, payload) |
| `POST` | `/api/v1/workspaces/{w}/catalogs/{c}/documents/search` | Catalog-scoped search (vector / text, optional hybrid + rerank) |
| `POST` | `/api/v1/workspaces/{w}/catalogs/{c}/ingest` | Sync ingest (chunk → embed → upsert → register Document) |
| `POST` | `/api/v1/workspaces/{w}/catalogs/{c}/ingest?async=true` | Same pipeline, returns 202 + job pointer |
| `GET / POST` | `/api/v1/workspaces/{w}/catalogs/{c}/queries` | List / create saved queries |
| `GET / PUT / DELETE` | `/api/v1/workspaces/{w}/catalogs/{c}/queries/{q}` | Saved-query CRUD |
| `POST` | `/api/v1/workspaces/{w}/catalogs/{c}/queries/{q}/run` | Replay a saved query through catalog-scoped search |
| `GET` | `/api/v1/workspaces/{w}/jobs/{jobId}` | Poll an async-ingest job |
| `GET` | `/api/v1/workspaces/{w}/jobs/{jobId}/events` | SSE stream of job updates until terminal state |
| `GET / POST` | `/api/v1/workspaces/{w}/vector-stores` | List / create vector-store descriptors (POST provisions the collection too) |
| `GET` | `/api/v1/workspaces/{w}/vector-stores/discoverable` | List data-plane collections not yet wrapped in a descriptor |
| `POST` | `/api/v1/workspaces/{w}/vector-stores/adopt` | Wrap an existing collection in a descriptor without re-provisioning |
| `GET / PUT / DELETE` | `/api/v1/workspaces/{w}/vector-stores/{v}` | Descriptor CRUD (DELETE drops the collection) |
| `POST` | `/api/v1/workspaces/{w}/vector-stores/{v}/records` | Upsert vector or text records (text → server-side `$vectorize` when supported, otherwise client-side embed) |
| `DELETE` | `/api/v1/workspaces/{w}/vector-stores/{v}/records/{rid}` | Delete one |
| `POST` | `/api/v1/workspaces/{w}/vector-stores/{v}/search` | Vector or text search; supports `hybrid`, `lexicalWeight`, `rerank` |
| `GET / POST` | `/api/v1/workspaces/{w}/api-keys` | List / issue workspace API keys |
| `DELETE` | `/api/v1/workspaces/{w}/api-keys/{keyId}` | Revoke a workspace API key |

### `/auth/*` (browser OIDC login, optional)

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/auth/config` | Tells the UI which credential surfaces to render |
| `GET` | `/auth/login` | 302 to the IdP's authorization endpoint (PKCE) |
| `GET` | `/auth/callback` | Exchanges code for tokens, sets signed session cookie |
| `GET` | `/auth/me` | Current session subject + access-token `expiresAt` + `canRefresh` |
| `POST` | `/auth/refresh` | Silent refresh — swaps the cookie's refresh_token at the IdP without a redirect |
| `POST` | `/auth/logout` | Clears the session cookie |

See [`docs/auth.md`](docs/auth.md) for the threat model and rollout
phases.

## Documentation

| Document | Purpose |
|----------|---------|
| [`docs/overview.md`](docs/overview.md) | Product overview, workflows, quickstart path |
| [`docs/architecture.md`](docs/architecture.md) | System model, components, data flow |
| [`docs/api-spec.md`](docs/api-spec.md) | HTTP API contract narrative |
| [`docs/auth.md`](docs/auth.md) | `/api/v1/*` auth middleware, OIDC login, silent refresh, threat model |
| [`docs/configuration.md`](docs/configuration.md) | `workbench.yaml` schema reference |
| [`docs/workspaces.md`](docs/workspaces.md) | Workspace model, scoping, cascade semantics |
| [`docs/green-boxes.md`](docs/green-boxes.md) | Multi-runtime "green box" architecture |
| [`docs/playground.md`](docs/playground.md) | Playground UX, text/vector dispatch, hybrid + rerank, ingest dialog |
| [`docs/conformance.md`](docs/conformance.md) | Cross-runtime contract testing |
| [`docs/cross-replica-jobs.md`](docs/cross-replica-jobs.md) | Design note for cross-replica job pub/sub + in-flight resume (proposed) |
| [`docs/roadmap.md`](docs/roadmap.md) | Phased delivery plan and open questions |
| [`docs/examples/workbench.yaml`](docs/examples/workbench.yaml) | Annotated sample config |
| [`apps/web/README.md`](apps/web/README.md) | Web UI quickstart, bundle layout, test commands |
| [`runtimes/README.md`](runtimes/README.md) | Index of language-native runtimes |
| [`conformance/README.md`](conformance/README.md) | Conformance harness overview |
| [`site/README.md`](site/README.md) | Landing page + docs site (VitePress, deployed to GitHub Pages on every push that touches `docs/**`) |

## Project layout

```
ai-workbench/
├── package.json                      # Root orchestration + Biome
├── biome.json                        # Shared lint/format config
├── runtimes/                         # N language-native runtimes (green boxes)
│   ├── README.md
│   ├── typescript/                   # Default runtime — embedded with the UI
│   │   ├── src/
│   │   │   ├── root.ts               # Process entry point
│   │   │   ├── app.ts                # Hono app factory
│   │   │   ├── config/               # workbench.yaml loader + schema
│   │   │   ├── control-plane/        # Backend-agnostic store (memory/file/astra)
│   │   │   ├── drivers/              # Vector-store drivers (mock/astra)
│   │   │   ├── astra-client/         # astra-db-ts wrapper for wb_* tables
│   │   │   ├── secrets/              # SecretResolver + env/file providers
│   │   │   └── routes/
│   │   │       ├── operational.ts
│   │   │       └── api-v1/
│   │   ├── tests/                    # Vitest suite (460+ tests)
│   │   ├── scripts/
│   │   ├── examples/workbench.yaml
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── Dockerfile
│   ├── python/                       # Python runtime (FastAPI, scaffold)
│   │   ├── src/workbench/
│   │   ├── tests/
│   │   ├── pyproject.toml
│   │   └── README.md
│   └── java/                         # Java runtime (Spring Boot, scaffold)
│       ├── src/main/java/com/datastax/aiworkbench/
│       ├── src/test/java/com/datastax/aiworkbench/
│       ├── build.gradle.kts
│       └── README.md
├── conformance/                      # Cross-runtime contract harness
│   ├── scenarios.json
│   ├── scenarios.md
│   ├── fixtures/                     # Expected normalized HTTP responses
│   ├── mock-astra/                   # Deterministic Astra stand-in
│   ├── normalize.mjs
│   └── runner.mjs
└── docs/                             # Narrative documentation
```

## License

TBD.
