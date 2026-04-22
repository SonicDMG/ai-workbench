# AI Workbench

An HTTP runtime that sits in front of **Astra DB** (via the Data API) and
exposes a cohesive workbench surface for workspaces, document catalogs,
vector stores, ingestion, and — in later phases — chat and MCP
integrations.

The runtime ships as a Docker container. The default (TypeScript)
runtime is embedded with the UI; alternative language runtimes ("green
boxes") live under [`clients/`](clients/) and expose the same
`/api/v1/*` contract.

## At a glance

- **One HTTP contract, N runtimes.** TypeScript today. Python scaffold
  under [`clients/python-runtime/`](clients/python-runtime/). Others
  plug in against a shared, fixture-enforced conformance suite.
- **Pluggable control plane.** Workspaces, catalogs, and vector-store
  descriptors persist in one of three backends:
  `memory` (default), `file` (JSON on disk), or `astra` (Data API Tables).
  Same API contract regardless of backend.
- **Astra-native.** The `astra` backend uses
  [`@datastax/astra-db-ts`](https://www.npmjs.com/package/@datastax/astra-db-ts)
  directly. The Python runtime uses `astrapy`. No wrapper libraries.
- **Secrets by reference.** Credentials are never stored by value —
  records hold `SecretRef` pointers (`env:FOO` / `file:/path`) that the
  runtime resolves on demand.
- **Declarative config.** `workbench.yaml` picks the runtime's control
  plane and (optionally) seeds it. Everything else is runtime data,
  mutable via the HTTP API.

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
   │   embedded)      │       │                  │         │                  │
   │                  │       │                  │         │                  │
   │  /api/v1/*       │       │  /api/v1/*       │         │  /api/v1/*       │
   └────────┬─────────┘       └────────┬─────────┘         └────────┬─────────┘
            │                          │                            │
            └──────────────── same HTTP contract ───────────────────┘
                                       │
                                       ▼ (per-runtime Astra SDK)
                        ┌─────────────────────────────┐
                        │   Astra Data API Tables     │
                        │   wb_workspaces             │
                        │   wb_catalog_by_workspace   │
                        │   wb_vector_store_by_ws     │
                        │   wb_documents_by_catalog   │
                        └─────────────────────────────┘
```

See [`docs/architecture.md`](docs/architecture.md) for the full model.

## Quickstart

```bash
# Install + boot with the default in-memory control plane.
npm ci
npm run dev                            # http://localhost:8080

# Hit it.
curl http://localhost:8080/healthz     # {"status":"ok"}
curl http://localhost:8080/docs        # Scalar-rendered API reference
```

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
| `GET / POST` | `/api/v1/workspaces/{w}/catalogs` | List / create catalogs |
| `GET / PUT / DELETE` | `/api/v1/workspaces/{w}/catalogs/{c}` | Catalog CRUD (DELETE cascades to documents) |
| `GET / POST` | `/api/v1/workspaces/{w}/vector-stores` | List / create vector-store descriptors |
| `GET / PUT / DELETE` | `/api/v1/workspaces/{w}/vector-stores/{v}` | Descriptor CRUD |

Documents, ingestion, and search land in Phase 2 —
[`docs/roadmap.md`](docs/roadmap.md).

## Documentation

| Document | Purpose |
|----------|---------|
| [`docs/architecture.md`](docs/architecture.md) | System model, components, data flow |
| [`docs/api-spec.md`](docs/api-spec.md) | HTTP API contract (implemented + planned) |
| [`docs/configuration.md`](docs/configuration.md) | `workbench.yaml` schema reference |
| [`docs/workspaces.md`](docs/workspaces.md) | Workspace model, scoping, cascade semantics |
| [`docs/green-boxes.md`](docs/green-boxes.md) | Multi-runtime "green box" architecture |
| [`docs/conformance.md`](docs/conformance.md) | Cross-runtime contract testing |
| [`docs/roadmap.md`](docs/roadmap.md) | Phased delivery plan and open questions |
| [`docs/examples/workbench.yaml`](docs/examples/workbench.yaml) | Annotated sample config |
| [`clients/README.md`](clients/README.md) | Alternative-language runtimes and conformance harness |

## Project layout

```
ai-workbench/
├── src/                              # Default (TypeScript) runtime
│   ├── root.ts                       # Process entry point
│   ├── app.ts                        # Hono app factory
│   ├── config/                       # workbench.yaml loader + schema
│   ├── control-plane/                # Backend-agnostic store (memory/file/astra)
│   │   ├── store.ts                  # ControlPlaneStore interface
│   │   ├── memory/                   # In-process backend
│   │   ├── file/                     # JSON-on-disk backend
│   │   ├── astra/                    # Astra Data API Tables backend
│   │   └── factory.ts                # Build a store from config
│   ├── astra-client/                 # astra-db-ts wrapper for wb_* tables
│   ├── secrets/                      # SecretResolver + env/file providers
│   └── routes/
│       ├── operational.ts            # health, readyz, banner, version
│       └── api-v1/                   # /api/v1/* CRUD routes
├── clients/
│   ├── README.md                     # Overview
│   ├── python-runtime/               # Python green box (FastAPI, scaffold)
│   └── conformance/                  # Cross-runtime harness + fixtures
├── docs/                             # Documentation (this dir)
├── examples/workbench.yaml           # Minimal default config
├── scripts/                          # Fixture regen + utilities
└── tests/                            # Vitest suite (98+ tests)
```

## License

TBD.
