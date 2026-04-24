# Green Boxes — the multi-runtime architecture

Every "green box" is a language-native implementation of the AI
Workbench HTTP runtime. They all serve the same `/api/v1/*` contract
and speak Astra via their language's native SDK internally. The UI
picks which one to target at deploy time via `BACKEND_URL`.

## Why multiple runtimes?

- Different organizations prefer different stacks. A team with heavy
  Python tooling should be able to deploy a Python-native workbench
  runtime that they can extend idiomatically.
- The Astra SDK ecosystem is polyglot (`astra-db-ts`, `astrapy`,
  `astra-db-java`, …). Each runtime uses its native SDK — no wrapper
  libraries, no "universal" middleware to maintain.
- The HTTP contract is small enough to replicate; replicating it
  across languages is easier than mandating one runtime and making
  everyone port their tooling.

## Current runtimes

| Runtime | Location | Status | Astra SDK |
|---|---|---|---|
| **TypeScript** (default) | [`runtimes/typescript/`](../runtimes/typescript/) | Operational through Phase 3 + auth (UI, playground, API keys, OIDC login, vector/text search + upsert) | `@datastax/astra-db-ts` |
| **Python** | [`runtimes/python/`](../runtimes/python/) | FastAPI scaffold — routes return 501 until implemented | `astrapy` (pending) |
| **Java** | [`runtimes/java/`](../runtimes/java/) | Spring Boot scaffold — routes return 501 until implemented | `astra-db-java` (pending) |

The TypeScript runtime is **the default ship path**: it gets bundled
with the UI into one Docker image, so operators deploying the UI get
a working backend out of the box. Alternative-language runtimes
deploy as separate containers and the UI points at them via
`BACKEND_URL`.

## The contract

Every green box serves:

| Path | Purpose |
|---|---|
| `GET /healthz` | Liveness |
| `GET /readyz` | Readiness (must confirm its control plane is reachable) |
| `GET /version` | Build metadata; `runtime` field carries the language tag |
| `GET /` | Service banner (JSON) when no UI is embedded; the UI shell (HTML) in the bundled TypeScript + UI image |
| `GET /docs` | OpenAPI reference UI |
| `GET /api/v1/openapi.json` | Machine-readable OpenAPI 3.1 doc |
| `(CRUD)` `/api/v1/workspaces[/{uid}]` | Workspace lifecycle |
| `(CRUD)` `/api/v1/workspaces/{w}/catalogs[/{uid}]` | Catalog lifecycle |
| `(CRUD)` `/api/v1/workspaces/{w}/vector-stores[/{uid}]` | Descriptor lifecycle (POST also provisions the collection) |
| `POST / DELETE / POST` | `/api/v1/workspaces/{w}/vector-stores/{v}/records`, `.../records/{rid}`, `.../search` | Data plane — upsert, delete, vector search |

Full contract details: [`api-spec.md`](api-spec.md).

Response shapes for every route are captured as fixtures under
[`conformance/fixtures/`](../conformance/fixtures/). Every runtime's
test suite diffs against those fixtures — drift surfaces as a
failing test.

## What's *not* part of the contract

- **Internal storage.** Each runtime picks its own control-plane
  backend(s). The TS runtime ships `memory / file / astra`; the
  Python runtime can reuse those names or invent its own. What
  matters is what shows up on the wire.
- **Astra SDK.** Each runtime uses its language-native client. The
  wire traffic they generate is DataStax's problem to keep
  consistent — not ours.
- **Logging, metrics, tracing shape.** Each runtime can emit what's
  idiomatic for its ecosystem; we'll align on a common telemetry
  schema later.
- **Language-specific deployment ergonomics.** The TS runtime uses
  Hono; the Python one FastAPI; Java (future) would likely use
  Spring. The *internals* are whatever each language prefers.

## Deployment

The UI reaches its runtime via `BACKEND_URL`:

```
                     ┌───────────────────┐
                     │       UI          │
                     │                   │
                     │ BACKEND_URL=…     │
                     └─────────┬─────────┘
                               │
      ┌────────────────────────┼────────────────────────┐
      │                        │                        │
 ┌────┴─────┐            ┌─────┴─────┐            ┌─────┴─────┐
 │ TS       │            │ Python    │            │ Java      │
 │ runtime  │            │ runtime   │            │ runtime   │
 │ :8080    │            │ :8080     │            │ :8080     │
 └────┬─────┘            └─────┬─────┘            └─────┬─────┘
      │                        │                        │
      ▼                        ▼                        ▼
      (their language-native Astra SDK to Astra Data API)
```

The default shipping container embeds the UI with the TS runtime, so
`BACKEND_URL` points at `/` (same origin). For alternative
runtimes, operators deploy the alternative container and set
`BACKEND_URL=http://my-python-runtime:8080` on the UI container.

## Adding a new language

See [`runtimes/README.md`](../runtimes/README.md) for the step-by-step.
In short:

1. Create `runtimes/<lang>/`.
2. Scaffold an HTTP server exposing `/api/v1/*`.
3. Use the language-native DataStax SDK internally.
4. Write a test harness that runs every scenario in
   [`conformance/scenarios.json`](../conformance/scenarios.json)
   against your server and diffs responses against the shared
   fixtures.
5. Add a row to the current-runtimes table above when you open the
   PR.

## Python runtime specifics

See [`runtimes/python/README.md`](../runtimes/python/README.md) for
the quickstart, environment variables, and house rules.

Currently every `/api/v1/*` route scaffolds to `HTTP 501
not_implemented` with the canonical error envelope. Operational
routes (`/healthz`, `/version`, `/`, `/docs`) work today.

## Java runtime specifics

See [`runtimes/java/README.md`](../runtimes/java/README.md) for the
quickstart, environment variables, and house rules.

Spring Boot 3 + Java 21 + Gradle. Same scaffold posture as the Python
runtime — operational routes (`/healthz`, `/version`, `/`, `/docs`)
work today; every `/api/v1/*` route throws `NotImplementedApiError` →
501 with the canonical envelope. Java records under
`com.datastax.aiworkbench.model` mirror the TS `*Record` types one-to-
one so JSON maps cleanly.
