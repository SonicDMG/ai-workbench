<!-- Generated: 2026-05-16 | Token estimate: ~700 -->

# Frontend Codemap

**App:** `apps/web/` — Vite + React 19 + TanStack Query 5 + Tailwind 4.
**Build target:** `runtimes/typescript/src/ui/assets.ts` (embedded in Docker image).
**Dev:** `npm run dev:web` (Vite :5173, proxies `/api/*` to runtime).

## Page tree (`src/pages/`)

```
/                            → WorkspacesPage              (workspace list)
/workspaces/:ws              → WorkspaceDetailPage         (KBs + activity)
/workspaces/:ws/settings     → WorkspaceSettingsPage       (services + auth)
/workspaces/:ws/kb/:kb       → KnowledgeBaseExplorerPage   (documents, filters)
/workspaces/:ws/playground   → PlaygroundPage              (search retrieval)
/workspaces/:ws/agents       → AgentsPage                  (Bobby/Maven/Quill/Sage)
/workspaces/:ws/agents/:id   → ChatPage                    (RAG chat UI)
/workspaces/:ws/connect      → ConnectPage                 (API key + snippets)
/onboarding                  → OnboardingPage              (first-run wizard)
```

Companion `*.test.tsx` files alongside each page (component-level smoke tests).

## Component tree (`src/components/`)

| Dir | Owns |
|---|---|
| `agents/` | Persona cards, agent editor, conversation list |
| `astra/` | Astra connection + CLI info widgets |
| `auth/` | Sign-in, OIDC callback, API key reveal |
| `brand/` | Logo, marks, theme primitives |
| `chat/` | Message bubbles, tool-call panels, retrieval citations |
| `common/` | Buttons, inputs, dialogs, status pills |
| `layout/` | Shell, nav rail, page header |
| `playground/` | Query input, mode switcher, result list |
| `ui/` | Radix-UI primitives + Tailwind variants |
| `workspaces/` | KB list, document table, **EditDocumentDialog**, **VisibilityPicker**, **ViewAsPicker**, **PolicyAuditPanel** (RLAC) |

## React Query hooks (`src/hooks/`)

| Hook | Endpoint family |
|---|---|
| `useWorkspaces` | `/workspaces` |
| `useKnowledgeBases` | `/workspaces/:ws/knowledge-bases` |
| `useDocuments` | `/knowledge-bases/:kb/documents` |
| `useIngest` | `/documents` POST (sync + async) |
| `useApiKeys` | `/workspaces/:ws/api-keys` |
| `useServices` | chunkers / embedders / rerankers (list/create) |
| `useServicePresetState` | Form state for service presets |
| `usePlayground` | Search dispatch (vector/text/hybrid) |
| `useConversations` | `/agents/:id/conversations` |
| `useAuthToken`, `useSession` | OIDC session + token refresh |
| `useFeatures` | Feature flags (RLAC gate) |
| `useRlac` | `useRlacEnabled`, `usePrincipals` (gated by feature flag) |
| `useConnectSnippets`, `useConnectTraffic`, `useConnectVerify` | Connect page |
| `useAstraCliInfo`, `useAstraCliInventory` | Astra CLI integration |
| `useTheme` | Dark/light/system |

## API client

```
src/lib/api.ts        → typed fetch client (auto-generated types from runtime OpenAPI)
src/lib/schemas.ts    → Zod schemas mirrored from runtime
src/lib/viewAs.ts     → RLAC "view as principal" client state
```

## State strategy

- **Server state:** TanStack Query for everything HTTP. No Redux/Zustand for server data.
- **UI-only state:** local `useState` + a couple of singletons (theme, viewAs).
- **Forms:** React Hook Form + Zod resolvers.

## Testing

- **Component tests:** Vitest + `@testing-library/react` + `userEvent`.
- **E2E:** `apps/web/tests/e2e/` Playwright specs (golden-path, ingest, agent-templates).
- **Coverage:** `npm run test:coverage` (Vitest v8).

## See also

- [apps/web/README.md](../../apps/web/README.md) — long-form web UI docs
- [backend.md](backend.md) — companion API surface
