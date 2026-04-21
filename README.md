# AI Workbench

A single-runtime, multi-workspace workbench for **Astra DB** and the **Data API**.

AI Workbench is a TypeScript service (packaged as a Docker image) that exposes a
unified HTTP surface for exploring and operating Astra DB vector stores,
document catalogs, ingestion pipelines, and — in later phases — chat and MCP
integrations. Everything is driven from YAML configuration and organized into
isolated **workspaces** (`prod`, `dev`, `mock`, …).

> Status: **Phase 0 — Documentation & API Spec.**
> The runtime itself is not yet implemented. See [`docs/roadmap.md`](docs/roadmap.md).

## At a glance

- **Single runtime.** One TypeScript process, one Docker image, one port.
- **Workspaces.** Isolated configurations for prod, dev, and mock environments.
- **Astra-native.** Primary backend is Astra DB via the Data API; a mock driver
  is available for local development and tests.
- **Composable.** Each workspace declares one or more document catalogs, each
  bound strictly 1:1 to a vector store.
- **YAML-first.** All configuration is declarative. No hidden state.
- **Extensible.** Service contracts for chunking, embedding, and catalog
  providers are pluggable.

## Architecture overview

```
                ┌──────────────────────────────────────────────────────┐
                │               WorkBench UI (TypeScript)              │
                │                                                      │
                │   /playground   /ingest   (chats, MCP — future)      │
                └──────────────────────┬───────────────────────────────┘
                                       │
                         Decoupling API (routes, middleware)
                                       │
        ┌──────────────────────────────┼────────────────────────────────┐
        │                              │                                │
        ▼                              ▼                                ▼
  chunking_service            embedding_service                  Astra Data API
                                                                       │
                                         ┌─────────────────────────────┼──────┐
                                         ▼                             ▼      ▼
                                   vector_store                 document    workspace
                                  (/crud /search)                catalog     (config)
                                         │                      (/document
                                         ▼                        /crud)
                                   collections
```

See [`docs/architecture.md`](docs/architecture.md) for the full model.

## Documentation

| Document | Purpose |
|----------|---------|
| [`docs/architecture.md`](docs/architecture.md) | System model, components, data flow |
| [`docs/api-spec.md`](docs/api-spec.md) | HTTP API surface (Phase 0 + forward-looking) |
| [`docs/configuration.md`](docs/configuration.md) | `workbench.yaml` schema reference |
| [`docs/workspaces.md`](docs/workspaces.md) | Workspace model and isolation guarantees |
| [`docs/roadmap.md`](docs/roadmap.md) | Phased delivery plan |
| [`docs/examples/workbench.yaml`](docs/examples/workbench.yaml) | Annotated sample config |

## Phase 0 deliverable

Phase 0 is **documentation + the Hello-World bootstrap**. The initial runtime
surface is intentionally tiny:

- `GET /` — service banner (name, version, commit)
- `GET /healthz` — liveness probe
- `GET /readyz` — readiness probe (config loaded, workspaces resolved)
- `GET /v1/workspaces` — list workspaces resolved from `workbench.yaml`
- `GET /v1/workspaces/{id}` — inspect a workspace's resolved config

Everything beyond this is a forward-looking contract and is marked as such in
[`docs/api-spec.md`](docs/api-spec.md).

## Project layout (target)

```
ai-workbench/
├── docs/                       # This documentation
├── src/
│   ├── root.ts                 # HTTP entry point (Phase 0)
│   ├── config/                 # YAML loading & schema validation
│   ├── workspaces/             # Workspace registry & isolation
│   ├── drivers/                # astra, mock, …
│   ├── services/               # chunking, embedding (Phase 3+)
│   └── routes/                 # HTTP routes, grouped by resource
├── examples/                   # Sample configs
├── Dockerfile
└── package.json
```

## License

TBD.
