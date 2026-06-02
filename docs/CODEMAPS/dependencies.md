<!-- Hand-maintained · last updated: 2026-06-02 | Token estimate: ~750 -->

# Dependencies Codemap

## External services

| Service | Use | Required? |
|---|---|---|
| **DataStax Astra** | Tabular + vector storage (production control plane) | Yes (when control-plane=astra) |
| **OpenRouter** | Hosted chat completions + embeddings via OpenAI-compatible API (default; one key → 300+ models, tool-capable) | Optional |
| **OpenAI API** | Direct/BYOK embeddings, chat completions, function calling | Optional (gated per workspace) |
| **Ollama** | Local/offline chat + embeddings via OpenAI-compatible API (no credential) | Optional |
| **Cohere** | Reranking | Optional |
| **OIDC provider** | SSO (any compliant: Auth0, Okta, Authelia, Keycloak…) | Optional (API keys also supported) |
| **OpenTelemetry collector (OTLP/HTTP)** | Trace export | Optional |

## Runtime dependencies (`runtimes/typescript/package.json`)

### Core
| Package | Why |
|---|---|
| `hono` | Web framework |
| `@hono/node-server` | Node adapter |
| `@hono/zod-openapi` | Route definition → OpenAPI schema |
| `zod` | Runtime validation; source of truth for schemas |
| `pino` (+ `pino-pretty`) | Structured JSON logs |
| `ulid` | Lexicographically sortable IDs |
| `jose` | JWT verification (OIDC) |
| `yaml` | `workbench.yaml` parsing |

### Astra
| Package | Why |
|---|---|
| `@datastax/astra-db-ts` | Astra SDK (tables + vectors) |

### AI / RAG
| Package | Why |
|---|---|
| `@langchain/core` | Chunker / embedder / reranker abstractions |
| `@langchain/openai` | OpenAI-compatible client for chat + embeddings across OpenRouter, OpenAI, and Ollama (baseURL override) |
| `@langchain/cohere` | Cohere reranker |
| `@modelcontextprotocol/sdk` | MCP server facade + remote-MCP client |

### Document extraction
| Package | Why |
|---|---|
| `mammoth` | DOCX → text |
| `pdfjs-dist` | PDF extraction |
| `read-excel-file`, `write-excel-file` | XLSX in/out |

### Observability
| Package | Why |
|---|---|
| `@opentelemetry/api` + `sdk-node` + `auto-instrumentations-node` | Tracing |
| `@opentelemetry/exporter-trace-otlp-http` | OTLP HTTP exporter |

### Docs UI
| Package | Why |
|---|---|
| `@scalar/hono-api-reference` | Renders `/docs` from OpenAPI |

## Web app dependencies (`apps/web/package.json`)

- **Framework:** `react`, `react-dom` (v19), `react-router` (v7)
- **State:** `@tanstack/react-query` (v5)
- **Forms:** `react-hook-form`, `@hookform/resolvers`, `zod`
- **UI:** `@radix-ui/*` primitives, `tailwindcss` (v4), `class-variance-authority`, `lucide-react`, `sonner` (toasts)
- **Build:** `vite`, `vite-tsconfig-paths`, `typescript`
- **Test:** `vitest`, `@testing-library/react`, `@testing-library/user-event`, `@playwright/test`
- **Types:** `openapi-typescript` (runtime OpenAPI → TS types)

## Dev tooling (root)

- `@biomejs/biome` — single linter/formatter (no prettier/eslint)
- `npm` workspaces NOT used; root script orchestration via `--prefix`

## Version overrides (security mitigations)

Pinned per-package (the root `package.json` has no `overrides` block):

- **`runtimes/typescript/package.json`:** `uuid ^14.0.0`, `picomatch ^4.0.4`, `brace-expansion >=2.0.3`, `ip-address ^10.1.1`, `fast-uri ^3.1.2`, `fast-xml-builder ^1.1.7`, `protobufjs ^8.0.2`, `langsmith ^0.6.0`
- **`apps/web/package.json`:** `picomatch ^4.0.4`, `brace-expansion ^2.0.3`, `ip-address ^10.1.1`

## Engines

- Node: `>=22.0.0` (root + runtime)
- Browsers: modern only (Vite default, no IE/legacy)

## CI dependencies (`.github/workflows/`)

- `ci.yml` — lint, typecheck, test, build, schema-drift, E2E smoke
- `codeql.yml` — CodeQL security scanning
- `runtimes.yml` — per-runtime conformance
- `secret-scan.yml` — `scripts/secret-scan.mjs`
- `smoke-astra.yml` — gated on Astra creds (skipped by default)
- `release.yml` — release/publish automation
- `deploy-site.yml` — docs site deploy

## See also

- [../configuration.md](../configuration.md) — `workbench.yaml` schema + env vars
- [../production.md](../production.md) — deployment hardening
- [data.md](data.md) — Astra storage details
