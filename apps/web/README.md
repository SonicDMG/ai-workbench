# AI Workbench — web UI

Workspace management UI for AI Workbench. Vite + React + TypeScript,
consumes `/api/v1/workspaces` on the default TypeScript runtime.

## Status

**Phase B slice 1 — workspace management.** Scope is intentionally
narrow: list / create / detail / edit / delete workspaces, with a
first-run onboarding flow. Catalogs, vector stores, documents, and
the playground are not in this UI yet — they land in later slices
alongside Phase 2b and Phase 3 on the backend.

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

Phase 3 will embed this `dist/` output inside the TypeScript runtime's
Docker image, so operators deploying the UI get a working backend in
one container. Until that lands, point a static file server at
`dist/` or run `npm run preview` for a local smoke test.

## What's here

| Route | Purpose |
|---|---|
| `/` | Workspaces list. Redirects to `/onboarding` when empty. |
| `/onboarding` | Two-step wizard — pick a backend kind, then fill details. |
| `/workspaces/:uid` | Detail + edit + destructive delete (with type-to-confirm). |

## Stack

- **Vite + React 19 + TypeScript** — standard modern baseline.
- **Tailwind CSS 4** (via `@tailwindcss/postcss`) — utility styling.
- **Radix UI** primitives for dialog, select, label — accessible by
  default.
- **TanStack Query** for server state (cache, invalidate, mutations).
- **React Hook Form + Zod** for forms; the same Zod schemas that
  describe API shapes drive form validation, so the UI and backend
  can't disagree about request shape.
- **React Router** for three routes.
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
│   │   └── utils.ts                 ← cn() + formatDate()
│   ├── hooks/
│   │   └── useWorkspaces.ts         ← list/get/create/update/delete hooks
│   ├── components/
│   │   ├── ui/                      ← Button, Input, Card, Dialog, Select, Label
│   │   ├── layout/AppShell.tsx
│   │   ├── common/states.tsx        ← Loading / Error / Empty
│   │   └── workspaces/
│   │       ├── KindBadge.tsx
│   │       ├── KindPicker.tsx       ← onboarding kind-selection
│   │       ├── CredentialsEditor.tsx
│   │       ├── WorkspaceForm.tsx    ← shared create/edit form
│   │       ├── WorkspaceCard.tsx
│   │       └── DeleteDialog.tsx
│   └── pages/
│       ├── WorkspacesPage.tsx
│       ├── OnboardingPage.tsx
│       └── WorkspaceDetailPage.tsx
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

## House rules

- Schemas in `lib/schemas.ts` are the single source of truth for
  request/response shapes on the UI side. When the runtime's OpenAPI
  changes, update here too.
- No `any`. Use Zod `.parse()` at the network boundary so everything
  downstream is typed.
- Toast on every mutation outcome — success and error. Never fail
  silently.
