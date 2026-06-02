<!-- Hand-maintained · last updated: 2026-06-02 | Token estimate: ~1000 -->

# Backend Codemap

**Runtime:** `runtimes/typescript/` — Hono on Node 22, Zod-validated, OpenAPI-generated.
**Entry:** `src/root.ts` → `src/app.ts` (Hono app factory).

## Routes (`src/routes/api-v1/`)

All mount at `/api/v1`. 21 route modules + 2 dispatch helpers, plus shared
utilities (`helpers.ts`, `ingest-file-form.ts`, `rlac-defaults.ts`) and a
`serdes/` converter directory — 26 `.ts` files total.

| Module | Surface |
|---|---|
| `workspaces.ts` | `GET/POST/PATCH/DELETE /workspaces[/:id]` |
| `api-keys.ts` | `*/workspaces/:ws/api-keys[/:id]` (scope: `manage`) |
| `knowledge-bases.ts` | `*/workspaces/:ws/knowledge-bases[/:id]` |
| `kb-descriptor.ts` | KB metadata + service bindings |
| `kb-documents.ts` | `*/knowledge-bases/:kb/documents[/:id]` (ingest, list, edit, delete) |
| `kb-data-plane.ts` | Search & retrieval under a KB |
| `knowledge-filters.ts` | Saved filter expressions for KBs |
| `chunking-services.ts` | CRUD for chunker service configs |
| `embedding-services.ts` | CRUD for embedder service configs |
| `reranking-services.ts` | CRUD for reranker service configs |
| `llm-services.ts` | CRUD for LLM service configs |
| `llm-models.ts` | `GET /llm-models` — live chat-model catalog (model picker) |
| `agents.ts` | Agents (Bobby/Maven/Quill/Sage personas) + chat |
| `available-tools.ts` | `GET /workspaces/:ws/available-tools` — selectable agent-tool catalog (read-only) |
| `mcp-servers.ts` | `*/workspaces/:ws/mcp-servers[/:id]` — remote MCP server registry CRUD |
| `playground.ts` | Retrieval playground (vector/text/hybrid) |
| `connect.ts` | Snippets + traffic mirror for client setup |
| `jobs.ts` | Job status + SSE stream |
| `mcp.ts` | Model Context Protocol JSON-RPC facade |
| `policy.ts` | RLAC policy CRUD (scope: `manage`) |
| `principals.ts` | RLAC principal CRUD (scope: `manage`) |
| `helpers.ts` | Shared route utilities |
| `ingest-file-form.ts` | Multipart parsing for KB file ingest (shared helper) |
| `rlac-defaults.ts` | RLAC `visibleTo`/owner defaulting shared by document write paths |
| `search-dispatch.ts` | Search request → driver routing |
| `upsert-dispatch.ts` | Upsert request → driver routing |
| `serdes/` | Request/response shape converters |

## Middleware chain (app.ts)

Workspace-scoped requests (`/api/v1/workspaces/*`) pass through:

```
requestId → requestTracing → requestLogger → requestMetrics
         → securityHeaders → rateLimit → bodyLimit
         → csrfOriginCheck (cookie sessions only)
         → authMiddleware (apiKey | OIDC session)
         → principalResolver (RLAC sub-workspace principal)
         → workspaceRouteAuthz
         → mutatingRouteWriteScope (write scope on mutations)
         → manageRouteScope (manage scope on admin routes)
         → handler → app.onError (envelope + secret masking)
```

RLAC policy filters are injected in the KB query path (`policy/enforcer.ts`),
not as a global middleware.

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
        ├── openai.ts        (shared OpenAI-compatible adapter)
        ├── providers.ts     (provider registry: openrouter / openai / ollama)
        └── model-catalog.ts (live model-picker catalog)
```

## Policy engine (`src/policy/`)

| File | Role |
|---|---|
| `parser.ts` | Expression-language → AST |
| `ast.ts` | AST node types |
| `validator.ts` | Static checks (referenced fields, principal scopes) |
| `compiler.ts` | AST → Astra query filter |
| `evaluator.ts` | AST eval against in-memory context |
| `enforcer.ts` | Compiles policy into the KB query-path filter (called by data-plane handlers) |
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
| `mcp-servers.ts` | MCP servers (remote MCP registry) |
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
