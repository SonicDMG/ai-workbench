<!-- Generated: 2026-05-16 | Token estimate: ~900 -->

# Backend Codemap

**Runtime:** `runtimes/typescript/` — Hono on Node 22, Zod-validated, OpenAPI-generated.
**Entry:** `src/root.ts` → `src/app.ts` (Hono app factory).

## Routes (`src/routes/api-v1/`)

All mount at `/api/v1`. 20 route modules + 2 dispatch helpers.

| Module | Surface |
|---|---|
| `workspaces.ts` | `GET/POST/PATCH/DELETE /workspaces[/:id]` |
| `api-keys.ts` | `*/workspaces/:ws/api-keys[/:id]` |
| `knowledge-bases.ts` | `*/workspaces/:ws/knowledge-bases[/:id]` |
| `kb-descriptor.ts` | KB metadata + service bindings |
| `kb-documents.ts` | `*/knowledge-bases/:kb/documents[/:id]` (ingest, list, edit, delete) |
| `kb-data-plane.ts` | Search & retrieval under a KB |
| `knowledge-filters.ts` | Saved filter expressions for KBs |
| `chunking-services.ts` | CRUD for chunker service configs |
| `embedding-services.ts` | CRUD for embedder service configs |
| `reranking-services.ts` | CRUD for reranker service configs |
| `llm-services.ts` | CRUD for LLM service configs |
| `agents.ts` | Agents (Bobby/Maven/Quill/Sage personas) + chat |
| `playground.ts` | Retrieval playground (vector/text/hybrid) |
| `connect.ts` | Snippets + traffic mirror for client setup |
| `jobs.ts` | Job status + SSE stream |
| `mcp.ts` | Model Context Protocol facade |
| `policy.ts` | RLAC policy CRUD (prototype) |
| `principals.ts` | RLAC principal CRUD (prototype) |
| `helpers.ts` | Shared route utilities |
| `search-dispatch.ts` | Search request → driver routing |
| `upsert-dispatch.ts` | Upsert request → driver routing |
| `serdes/` | Request/response shape converters |

## Middleware chain (app.ts)

```
requestId → requestLogger → cors → rateLimit
         → authResolver (apiKey | session)
         → workspaceRouteAuthz (per workspace-scoped route)
         → RLAC enforcer (when feature flag on)
         → handler → app.onError
```

## Services (`src/services/`)

Cross-aggregate orchestration. Thin routes call into here.

| Service | Purpose |
|---|---|
| `knowledge-base-service.ts` | KB lifecycle, service-binding resolution |
| `ingest-service.ts` | Document upload → chunk → embed → upsert pipeline |
| `document-cascade.ts` | Cascading delete (KB → documents → chunks) |

## Chat / Agent layer (`src/chat/`)

```
HTTP /agents/:id/chat
  → agent-dispatch.ts        (orchestration)
  → retrieval.ts             (vector / hybrid / reranked search)
  → tools/registry.ts        (kb-search tool)
  → ChatService impl
        ├── openai.ts        (native function calling)
        └── huggingface.ts   (JSON-prompted tool calls)
```

## Policy engine (`src/policy/`)

| File | Role |
|---|---|
| `parser.ts` | Expression-language → AST |
| `ast.ts` | AST node types |
| `validator.ts` | Static checks (referenced fields, principal scopes) |
| `compiler.ts` | AST → Astra query filter |
| `evaluator.ts` | AST eval against in-memory context |
| `enforcer.ts` | Middleware that injects policy into query path |
| `index.ts` | Public entry |

## Control plane (`src/control-plane/`)

Per-aggregate repos under `repos/`:

| Repo | Aggregate |
|---|---|
| `workspaces.ts` | Workspaces |
| `knowledge-bases.ts` | Knowledge bases |
| `rag-documents.ts` | Documents |
| `agents.ts` | Agents |
| `conversations.ts` | Conversations |
| `chat-messages.ts` | Chat messages |
| `api-keys.ts` | API keys |
| `principals.ts` | Principals (RLAC) |
| `policy-audit.ts` | Policy audit log |
| `chunking-services.ts`, `embedding-services.ts`, `reranking-services.ts`, `llm-services.ts`, `knowledge-filters.ts` | Service endpoint configs |
| `_service-endpoint.ts` | Shared base for the four service-endpoint repos |
| `index.ts` | Composite store interface |

## Background work (`src/jobs/`)

- `store.ts` — durable job store with lease/heartbeat
- `ingest-worker.ts` — async ingest pipeline runner
- `sweeper.ts` — orphan reclaim

## Shared utilities (`src/lib/`)

| File | Use |
|---|---|
| `errors.ts` | `ApiError`, error envelope |
| `safe-error.ts` | Secret-masking before log |
| `audit.ts` | Structured audit events |
| `pagination.ts` | Cursor-based pagination |
| `logger.ts`, `request-id.ts`, `request-logger.ts` | Pino + correlation IDs |
| `rate-limit.ts` | Per-IP throttle |
| `tracing.ts` | OpenTelemetry setup |
| `openapi.ts` | Hono-Zod schema generation |
| `safe-fetch.ts` | Outbound HTTP w/ timeouts + retries |

## See also

- [../api-spec.md](../api-spec.md) — full HTTP contract narrative (47 KB)
- Live OpenAPI: `/api/v1/openapi.json`; rendered at `/docs`
