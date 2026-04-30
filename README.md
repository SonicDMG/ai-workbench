# AI Workbench

AI Workbench is a self-hosted product surface for building, inspecting,
and operating retrieval-backed AI applications on **DataStax Astra**.
It gives teams one place to manage workspaces, knowledge bases,
chunking / embedding / reranking services, document ingest, API keys,
and retrieval experiments.

Under the product UI is a stable HTTP runtime. The **TypeScript
runtime is the production ship path** — it bundles with the UI in one
Docker image and is the only runtime that implements the full
`/api/v1/*` contract today. Language-native "green box" runtimes for
**Python (FastAPI) and Java (Spring Boot) are preview scaffolds**:
they boot, serve operational endpoints, and answer every `/api/v1/*`
route with HTTP 501 until handlers are implemented. They live under
[`runtimes/`](runtimes/) so the cross-runtime contract is testable
end-to-end as the implementations land. See
[`runtimes/README.md`](runtimes/README.md) for the per-runtime status
table.

## At a glance

- **Workspace command center.** Workspaces isolate knowledge bases,
  execution services, documents, jobs, credentials, and API keys.
- **Knowledge bases as first-class.** A KB owns its Astra collection
  end-to-end and binds the chunking + embedding + (optional)
  reranking services that produce its content. The collection is
  auto-provisioned on create.
- **Knowledge operations.** Ingest raw text or files into a KB,
  track sync/async job state, and let the KB's bound services drive
  chunking and embedding.
- **Retrieval playground.** Run text, vector, hybrid, and rerank
  searches in the browser against real workspace data.
- **Production-friendly controls.** Start in memory, switch to file
  storage for single-node deployments, or use Astra Data API tables for
  a durable control plane.
- **Technical spine intact.** One `/api/v1/*` contract, direct Astra
  SDK usage, secrets by reference, and fixture-enforced conformance.
  The TypeScript runtime ships today; Python and Java runtimes are
  preview scaffolds working toward parity.

## Architecture

```
                   ┌───────────────────────────────────────────┐
                   │               WorkBench UI                │
                   │                                           │
                   │   /playground   /ingest   (agents, MCP)   │
                   └─────────────────────┬─────────────────────┘
                                         │
                                    BACKEND_URL
                                         │
            ┌────────────────────────────┼────────────────────────────┐
            ▼                            ▼                            ▼
   ┌──────────────────┐       ┌──────────────────┐         ┌──────────────────┐
   │  TS runtime      │       │  Python runtime  │         │  Java runtime    │
   │  (production,    │       │  (preview        │         │  (preview        │
   │   embedded       │       │   scaffold —     │         │   scaffold —     │
   │   with UI)       │       │   FastAPI, 501s) │         │   Boot, 501s)    │
   │                  │       │                  │         │                  │
   │  /api/v1/*       │       │  /api/v1/*       │         │  /api/v1/*       │
   └────────┬─────────┘       └────────┬─────────┘         └────────┬─────────┘
            │                          │                            │
            └──────────────── same HTTP contract ───────────────────┘
                                       │
                                       ▼ (per-runtime Astra SDK)
                        ┌──────────────────────────────────┐
                        │   Astra Data API                 │
                        │     Tables (control plane):      │
                        │       wb_workspaces              │
                        │       wb_config_knowledge_       │
                        │         bases_by_workspace       │
                        │       wb_config_chunking/        │
                        │         embedding/reranking      │
                        │         _service_by_workspace    │
                        │       wb_rag_documents_          │
                        │         by_knowledge_base        │
                        │     Collections (data plane):    │
                        │       wb_vectors_<kb_id>         │
                        │       (one per knowledge base)   │
                        └──────────────────────────────────┘
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
see [`docs/configuration.md`](docs/configuration.md). If you have
the [`astra` CLI](https://github.com/datastax/astra-cli) installed
and a profile configured, the runtime can auto-fill
`ASTRA_DB_APPLICATION_TOKEN` / `ASTRA_DB_API_ENDPOINT` at startup —
see [`docs/astra-cli.md`](docs/astra-cli.md).

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
| `GET / PATCH / DELETE` | `/api/v1/workspaces/{w}` | Workspace CRUD (DELETE cascades) |
| `POST` | `/api/v1/workspaces/{w}/test-connection` | Run a live workspace connection check |
| `GET / POST` | `/api/v1/workspaces/{w}/knowledge-bases` | List / create knowledge bases (POST auto-provisions the underlying vector collection) |
| `GET / PATCH / DELETE` | `/api/v1/workspaces/{w}/knowledge-bases/{kb}` | KB CRUD (DELETE drops the collection + cascades RAG documents) |
| `GET / POST` | `/api/v1/workspaces/{w}/knowledge-bases/{kb}/documents` | List / register a document in a KB |
| `GET / PATCH / DELETE` | `/api/v1/workspaces/{w}/knowledge-bases/{kb}/documents/{d}` | Document metadata CRUD (DELETE cascades chunks in the KB's collection) |
| `GET` | `/api/v1/workspaces/{w}/knowledge-bases/{kb}/documents/{d}/chunks` | List the chunks under a document |
| `POST` | `/api/v1/workspaces/{w}/knowledge-bases/{kb}/ingest` | Sync ingest (chunk → embed → upsert → register Document) |
| `POST` | `/api/v1/workspaces/{w}/knowledge-bases/{kb}/ingest?async=true` | Same pipeline, returns 202 + job pointer |
| `POST` | `/api/v1/workspaces/{w}/knowledge-bases/{kb}/records` | Upsert vector or text records (text → server-side `$vectorize` when supported, otherwise client-side embed) |
| `DELETE` | `/api/v1/workspaces/{w}/knowledge-bases/{kb}/records/{rid}` | Delete one |
| `POST` | `/api/v1/workspaces/{w}/knowledge-bases/{kb}/search` | KB-scoped search (vector / text, optional hybrid + rerank) |
| `GET / POST / DELETE` | `/api/v1/workspaces/{w}/chunking-services` | Chunking-service CRUD |
| `GET / POST / DELETE` | `/api/v1/workspaces/{w}/embedding-services` | Embedding-service CRUD |
| `GET / POST / DELETE` | `/api/v1/workspaces/{w}/reranking-services` | Reranking-service CRUD |
| `GET` | `/api/v1/workspaces/{w}/jobs/{jobId}` | Poll an async-ingest job |
| `GET` | `/api/v1/workspaces/{w}/jobs/{jobId}/events` | SSE stream of job updates until terminal state |
| `GET / POST / PATCH / DELETE` | `/api/v1/workspaces/{w}/llm-services` | LLM-service CRUD (workspace-scoped chat-completion executors) |
| `GET / POST / PATCH / DELETE` | `/api/v1/workspaces/{w}/agents` | User-defined agent CRUD — each carries persona, RAG defaults, and an optional `llmServiceId` |
| `GET / POST / PATCH / DELETE` | `/api/v1/workspaces/{w}/agents/{a}/conversations` | Per-agent conversation CRUD |
| `GET` | `/api/v1/workspaces/{w}/agents/{a}/conversations/{c}/messages` | Conversation history, oldest-first |
| `POST` | `/api/v1/workspaces/{w}/agents/{a}/conversations/{c}/messages` | Send a message; sync reply with retrieval-grounded chat-completion |
| `POST` | `/api/v1/workspaces/{w}/agents/{a}/conversations/{c}/messages/stream` | Same flow as SSE — `user-message` + `token` deltas + terminal `done`/`error` |
| `POST` | `/api/v1/workspaces/{w}/mcp` | Model Context Protocol façade (optional, `mcp.enabled: true`) — exposes the workspace as MCP tools for external agents |
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
| [`docs/audit.md`](docs/audit.md) | Structured audit events for sensitive operations |
| [`docs/configuration.md`](docs/configuration.md) | `workbench.yaml` schema reference |
| [`docs/production.md`](docs/production.md) | Production hardening checklist |
| [`docs/workspaces.md`](docs/workspaces.md) | Workspace model, scoping, cascade semantics |
| [`docs/green-boxes.md`](docs/green-boxes.md) | Multi-runtime "green box" architecture |
| [`docs/playground.md`](docs/playground.md) | Playground UX, text/vector dispatch, hybrid + rerank, ingest dialog |
| [`docs/agents.md`](docs/agents.md) | User-defined agents: personas, RAG defaults, per-agent LLM service binding, and the conversation + message routes |
| [`docs/mcp.md`](docs/mcp.md) | Model Context Protocol façade — expose a workspace as MCP tools for external agents |
| [`docs/astra-cli.md`](docs/astra-cli.md) | astra-cli auto-detection of Astra credentials at runtime startup |
| [`docs/conformance.md`](docs/conformance.md) | Cross-runtime contract testing |
| [`docs/cross-replica-jobs.md`](docs/cross-replica-jobs.md) | Design note for cross-replica job pub/sub + in-flight resume (proposed) |
| [`docs/route-plugins.md`](docs/route-plugins.md) | Design note for the in-runtime route-plugin registry (scaffold shipped) |
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
│   │   ├── tests/                    # Vitest suite + conformance drift guard
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

## Contributing

Setup, dev loops, PR expectations, and the rules for changing the
cross-runtime API contract live in [`CONTRIBUTING.md`](CONTRIBUTING.md).
Security issues use the private channel in
[`SECURITY.md`](SECURITY.md).

## License

TBD.
