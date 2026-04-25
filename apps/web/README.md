# AI Workbench — web UI

Workspace management UI for AI Workbench. Vite + React + TypeScript,
consumes `/api/v1/workspaces` on the default TypeScript runtime.

## Status

**Shipped.** First-run onboarding wizard, workspace list / detail /
edit / destructive delete, full CRUD over catalogs, vector-store
descriptors, and workspace-scoped API keys. Async ingest from the
browser (file upload → chunk → embed → upsert) with live progress
streamed via SSE. Saved-query CRUD per catalog, runnable from the UI.
Playground for ad-hoc text / vector / hybrid / rerank queries against
any vector store. OIDC login + silent refresh and paste-a-token
fallback are both wired through the same auth layer.

HCD and OpenRAG kinds are visible in the onboarding picker but
intentionally non-selectable ("Coming soon" badge) — the runtime
schema accepts them, but no driver is wired yet, so blocking
selection here keeps the next step from stalling on
`driver_unavailable`.

## Quickstart

In two terminals:

```bash
# Terminal 1 — start the runtime (from repo root)
npm run dev
# http://localhost:8080

# Terminal 2 — start the UI (from repo root)
npm run install:web
npm run dev:web
# http://localhost:5173
```

Vite proxies `/api/*` to `http://localhost:8080` so the UI is
same-origin with the backend in dev — no CORS setup needed. Override
the target for non-default runtime locations:

```bash
VITE_API_TARGET=http://localhost:9000 npm run dev:web
```

## Build

```bash
npm run build:web
# → apps/web/dist/ (static assets ready to serve)
```

The official `ai-workbench` Docker image (from
[`runtimes/typescript/Dockerfile`](../../runtimes/typescript/Dockerfile))
builds this UI in a first stage and copies `dist/` into `/app/public`
of the final image. At runtime the TypeScript server serves those
files at `/`, falls back to `index.html` for SPA routes, and keeps
the JSON API at `/api/v1/*` and the reference UI at `/docs`. One
container, UI + backend.

For a local smoke test without Docker, `npm run preview` serves
`dist/` against the dev-mode runtime via the Vite proxy.

### Bundle layout

The production build splits into named vendor chunks +
route-level lazy chunks rather than one monolithic bundle. The
split is declared in [`vite.config.ts`](vite.config.ts):

| Chunk | Contents | When it loads |
|---|---|---|
| `index` | App shell, workspace-list page, auth UI | Initial page load |
| `react` | `react`, `react-dom`, `react-router-dom` | Initial page load |
| `query` | `@tanstack/react-query` | Initial page load |
| `radix` | All `@radix-ui/*` primitives | Initial page load |
| `zod` | `zod` — used by `lib/api.ts` to validate every response | Initial page load |
| `forms` | `react-hook-form`, `@hookform/resolvers` | Only when a form renders (lazy via the detail / onboarding routes) |
| `OnboardingPage` | The two-step onboarding wizard | `/onboarding` visit |
| `WorkspaceDetailPage` | Detail + edit + API-key + test-connection panels | `/workspaces/:uid` visit |
| `PlaygroundPage` | Query form + results table | `/playground` visit |

`zod` and `forms` are deliberately kept in separate chunks: `zod`
is imported by the eager API client, so it has to preload; lumping
`react-hook-form` in with it would pull a form library into first
paint for no reason. The split is verifiable via `modulepreload`
tags in the built `index.html`.

Route components are lazy via `React.lazy(...)` and wrapped in a
`<Suspense fallback={<LoadingState />}>` at the shell level, so
navigation shows the shared loader while the chunk streams.

## What's here

| Route | Purpose |
|---|---|
| `/` | Workspaces list. Redirects to `/onboarding` when empty. |
| `/onboarding` | Two-step wizard — pick a backend kind, then fill details. HCD / OpenRAG tiles render but are non-selectable. |
| `/workspaces/:uid` | Detail + edit + destructive delete (type-to-confirm). Hosts the catalogs, vector-stores, and API-keys panels for this workspace. |
| `/playground` | Ad-hoc text / vector / hybrid / rerank queries against a workspace's vector stores. See [`docs/playground.md`](../../docs/playground.md). |

The workspace detail page composes four panels (collapsible cards):

| Panel | What it does |
|---|---|
| Catalogs | List + create + delete catalogs. Each row expands to the most recent documents, supports inline async ingest (file upload + SSE-streamed progress), and houses the saved-queries section for that catalog. |
| Vector stores | List + create + delete vector-store descriptors. Create flow provisions the underlying collection on the bound driver. |
| API keys | List + issue + revoke workspace-scoped `wb_live_*` keys. Fresh keys are shown once, then masked. |
| Detail / edit | The kind-aware edit form (kind is read-only after create) and the destructive delete dialog. |

## Stack

- **Vite + React 19 + TypeScript** — standard modern baseline.
- **Tailwind CSS 4** (via `@tailwindcss/postcss`) — utility styling.
- **Radix UI** primitives for dialog, select, label — accessible by
  default.
- **TanStack Query** for server state (cache, invalidate, mutations).
- **React Hook Form + Zod** for forms; the same Zod schemas that
  describe API shapes drive form validation, so the UI and backend
  can't disagree about request shape.
- **React Router** for the four routes (`/`, `/onboarding`, `/workspaces/:uid`, `/playground`).
- **Sonner** for toasts.
- **Lucide React** for icons.

## Source layout

```
apps/web/
├── index.html
├── vite.config.ts
├── tailwind/postcss config
├── src/
│   ├── main.tsx                     ← entry
│   ├── App.tsx                      ← QueryClient + Router + AppShell
│   ├── index.css                    ← Tailwind imports + theme tokens
│   ├── lib/
│   │   ├── api.ts                   ← typed fetch client, ApiError
│   │   ├── schemas.ts               ← Zod mirrors of runtime types
│   │   ├── query.ts                 ← QueryClient + key factory
│   │   ├── authToken.ts             ← localStorage bearer-token helpers
│   │   ├── session.ts               ← /auth/* fetch helpers (cookie-aware)
│   │   └── utils.ts                 ← cn() + formatDate()
│   ├── hooks/
│   │   ├── useWorkspaces.ts         ← list/get/create/update/delete
│   │   ├── useCatalogs.ts           ← catalog CRUD
│   │   ├── useDocuments.ts          ← per-catalog document list
│   │   ├── useVectorStores.ts       ← vector-store descriptor CRUD
│   │   ├── useIngest.ts             ← async ingest + SSE progress
│   │   ├── useSavedQueries.ts       ← saved-query CRUD + /run
│   │   ├── usePlaygroundSearch.ts   ← /search dispatch + result hits
│   │   ├── useApiKeys.ts            ← workspace API-key mutations
│   │   ├── useAuthToken.ts          ← reactive bearer-token hook
│   │   └── useSession.ts            ← /auth/config + /auth/me + silent refresh
│   ├── components/
│   │   ├── ui/                      ← Button, Input, Card, Dialog, Select, Label
│   │   ├── layout/AppShell.tsx
│   │   ├── auth/TokenMenu.tsx       ← paste-a-token fallback
│   │   ├── auth/UserMenu.tsx        ← header: signed-in / "Log in" / TokenMenu
│   │   ├── common/                  ← states (Loading/Error/Empty), ErrorBoundary
│   │   ├── playground/
│   │   │   ├── QueryForm.tsx        ← text/vector + hybrid/rerank/topK/filter
│   │   │   └── ResultsTable.tsx     ← scored hits with payload expansion
│   │   └── workspaces/
│   │       ├── KindBadge.tsx
│   │       ├── KindPicker.tsx       ← onboarding kind-selection
│   │       ├── CredentialsEditor.tsx
│   │       ├── WorkspaceForm.tsx    ← shared create/edit form
│   │       ├── WorkspaceCard.tsx
│   │       ├── DeleteDialog.tsx
│   │       ├── TestConnectionPanel.tsx
│   │       ├── ApiKeysPanel.tsx
│   │       ├── CreateApiKeyDialog.tsx
│   │       ├── CatalogsPanel.tsx    ← catalog list + per-row docs
│   │       ├── CreateCatalogDialog.tsx
│   │       ├── IngestDialog.tsx     ← file upload + async ingest + SSE
│   │       ├── SavedQueriesSection.tsx
│   │       ├── VectorStoresPanel.tsx
│   │       └── CreateVectorStoreDialog.tsx
│   └── pages/
│       ├── WorkspacesPage.tsx
│       ├── OnboardingPage.tsx
│       ├── WorkspaceDetailPage.tsx
│       └── PlaygroundPage.tsx
```

## UX notes

- **`kind` is immutable.** Matches the runtime contract (PR #15). The
  edit form shows `kind` read-only; the onboarding flow picks it
  first, before the user invests time in other details.
- **Credentials are SecretRefs, not values.** The editor enforces
  `provider:path` shape inline and drops empty rows before submit.
  The runtime rejects raw secrets with `400` anyway.
- **Destructive delete requires typing the workspace name.** Cascade
  is real — catalogs, vector-store collections, and documents all go.
- **Empty state → onboarding redirect.** First-run users never see a
  bare "no workspaces" screen; they land directly in the wizard.
- **List order is deterministic.** The runtime sorts by `createdAt`
  (with `uid` as tie-breaker), so the grid is stable across reloads.
- **Credential menu.** The header renders one of three things based
  on `GET /auth/config`:
  1. **Signed in (OIDC session)** — user's label + logout.
  2. **"Log in" button** — redirects to `/auth/login?redirect_after=…`,
     the IdP handles the rest, the runtime sets an `HttpOnly`
     session cookie at `/auth/callback`.
  3. **Paste-a-token** — legacy fallback used when only
     `auth.mode: apiKey` is configured. Stores a `wb_live_*` token
     in `localStorage` and attaches `Authorization: Bearer …` to
     every `/api/v1/*` fetch. See the XSS caveat in
     [`docs/auth.md`](../../docs/auth.md).
- **Auto-redirect on 401.** `lib/api.ts` checks `/auth/config` once
  on the first 401; if OIDC login is available it navigates the
  browser to `/auth/login` carrying the current path so the user
  lands back where they started after authenticating.

## Tests

| Command | What it runs |
|---|---|
| `npm test` | Unit + component tests under `src/**/*.{test,spec}.{ts,tsx}` (vitest + jsdom + RTL). Fast — no browser. |
| `npm run test:watch` | Same in watch mode. |
| `npm run test:coverage` | Same as `npm test` but with v8 coverage. **Gates `src/lib/**` at lines: 50, statements: 50, branches: 80, functions: 20.** Components are exercised end-to-end through Playwright; locking thresholds on them prematurely pushes toward shallow tests. |
| `npm run test:e2e` | Playwright golden-path spec. Builds the runtime + SPA, boots the runtime against the bundled `examples/workbench.yaml` (memory backend, auth disabled), drives Chromium through the onboarding → vector-store → upsert → playground flow. Reuses an existing `:8080` server in dev; CI starts a fresh one. |
| `npm run test:e2e:ui` | Same in Playwright's UI mode for debugging. |
| `npm run e2e:install` | One-time: `playwright install chromium --with-deps`. |

E2E specs deliberately stay on the **vector** lane. The route's `resolveQuery()` always builds an `Embedder` for any text query (so hybrid search has a vector handle); with a mock embedding descriptor the production embedder factory throws `embedding_unavailable`. Vector input bypasses that path entirely. Adding text-search coverage to the E2E suite needs either a real provider key in CI or a runtime override that lets a fake embedder run alongside production code — both deferred.

## House rules

- Schemas in `lib/schemas.ts` are the single source of truth for
  request/response shapes on the UI side. When the runtime's OpenAPI
  changes, update here too.
- No `any`. Use Zod `.parse()` at the network boundary so everything
  downstream is typed.
- Toast on every mutation outcome — success and error. Never fail
  silently.
