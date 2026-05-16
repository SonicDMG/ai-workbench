<!-- Generated: 2026-05-16 | Token estimate: ~700 -->

# Architecture Codemap

**Product:** Self-hosted control center for retrieval-backed AI apps on DataStax Astra.
**Runtime model:** Polyglot "green-box" — one HTTP contract, N language implementations.

## Top-level layout

```
ai-workbench/
├── apps/web/                # Vite + React 19 UI (built into runtime)
├── runtimes/
│   ├── typescript/          # Production runtime (Hono + Node 22)
│   ├── python/              # Preview scaffold (FastAPI, 501s)
│   └── java/                # Preview scaffold (Spring Boot, 501s)
├── conformance/             # Cross-runtime contract tests + fixtures
├── docs/                    # ADRs, architecture, API spec, integrations
└── scripts/                 # Build/lint guards (secret-scan, error-helper)
```

## System diagram

```
                  ┌──────────────────┐
                  │  Browser (SPA)   │  Vite + React 19, TanStack Query
                  └────────┬─────────┘
                           │ HTTPS  /api/v1/*, /docs, /metrics
                  ┌────────▼─────────┐
                  │ Hono runtime     │  apps/web build → runtime/src/ui/assets.ts
                  │ runtimes/        │
                  │   typescript/    │
                  └────┬───────┬─────┘
                       │       │
        ┌──────────────▼─┐   ┌─▼────────────────┐
        │ Control Plane  │   │ Data Plane       │
        │ Store          │   │ - Vector search  │
        │ (3 backends:   │   │ - Chunkers       │
        │  memory/file/  │   │ - Embedders      │
        │  astra)        │   │ - Rerankers      │
        └──────┬─────────┘   │ - LLM (chat)     │
               │              └──────┬───────────┘
        ┌──────▼──────────┐          │
        │ DataStax Astra  │◄─────────┘ astra-db-ts (vector + tabular)
        │ (production)    │
        └─────────────────┘
```

## Service boundaries

| Layer | Owns | Reusable across runtimes? |
|---|---|---|
| Routes (`src/routes/api-v1/`) | HTTP contract, request validation | No — per-runtime |
| Services (`src/services/`) | Cross-aggregate orchestration (ingest, cascade) | No — per-runtime |
| Repos (`src/control-plane/repos/`) | Per-aggregate CRUD | No — per-runtime |
| Store (`src/control-plane/store.ts`) | Storage backend abstraction | No — per-runtime |
| Astra client (`src/astra-client/`) | Table defs, row adapters | No — per-runtime |
| Policy engine (`src/policy/`) | RLAC parser/compiler/enforcer | No — per-runtime |
| Conformance (`conformance/`) | Contract fixtures + scenarios | **Yes — source of truth** |

## Data flow (request lifecycle)

```
HTTP request → Hono middleware chain:
  1. requestId          (src/lib/request-id.ts)
  2. requestLogger      (src/lib/request-logger.ts)
  3. rateLimit          (src/lib/rate-limit.ts)
  4. authResolver       (src/auth/principal-resolver.ts)
  5. workspaceRouteAuthz (src/auth/middleware.ts)
  6. RLAC enforcer      (src/policy/enforcer.ts) — when enabled
  7. Route handler      (src/routes/api-v1/<aggregate>.ts)
       → Service        (src/services/<feature>-service.ts)
       → Repo           (src/control-plane/repos/<aggregate>.ts)
       → Store backend  (memory | file | astra)
  8. app.onError        (src/lib/errors.ts) — envelope + secret masking
```

## Key architectural decisions

- **Contract-first:** Zod schemas → OpenAPI → TypeScript types (UI consumes generated types).
- **Immutable records:** every `update*` returns a new object; never in-place mutation.
- **Per-aggregate repos** (ADR-0002): store interface split so handlers declare narrow deps.
- **Service layer** (ADR-0001): cross-aggregate ops live in `services/`, routes stay thin.
- **Secrets by reference:** `env:FOO` / `file:/path` resolved at runtime by pluggable providers.
- **Cross-replica jobs:** durable job store with heartbeat leasing + orphan sweeper (`src/jobs/`).

## See also

- [backend.md](backend.md) — routes, services, repos in detail
- [frontend.md](frontend.md) — UI page tree and hooks
- [data.md](data.md) — Astra tables and storage drivers
- [dependencies.md](dependencies.md) — external services and third-party deps
- [../adr/](../adr/) — Architecture Decision Records (3 records)
- [../architecture.md](../architecture.md) — long-form architecture narrative
