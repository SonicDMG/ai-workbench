# Changelog

All notable changes to AI Workbench are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html)
starting at `0.1.0`. Pre-`1.0`, breaking changes can land in a minor
release — they will be called out under **Changed** below.

## [Unreleased]

## [0.2.0] — 2026-05-22

### Added

- **Conformance coverage for the chat surface.** The chat / agent
  message routes were previously excluded from the cross-runtime
  conformance harness because chat completion depended on an upstream
  LLM API. The runtime now ships a tiny `FixtureChatService`
  ([`runtimes/typescript/src/chat/fixture.ts`](./runtimes/typescript/src/chat/fixture.ts))
  that replays a scripted reply (sync) and a scripted token stream
  (async); scenarios opt in via a new optional `chatScript` field in
  [`conformance/scenarios.json`](./conformance/scenarios.json) that
  the regen + drift harness wires through `createApp({chatService:
  new FixtureChatService(scenario.chatScript)})`. The runner now
  detects `text/event-stream` bodies and parses them via a shared
  `parseSseBody` helper ([`conformance/runner.mjs`](./conformance/runner.mjs))
  into a deterministic array of `{event, data}` records, so SSE
  fixtures normalize cleanly through the existing UUID / timestamp
  rules. Two new committed fixtures, `chat-message-sync` and
  `chat-message-stream`, pin the user + assistant wire shape +
  metadata for both delivery modes. Drift guard picks them up
  automatically.
- **Opt-in anonymous telemetry (wired-but-dark by default).** The
  runtime and CLI gain a tiny telemetry surface, off unless explicitly
  enabled. Posture: off by default; `WORKBENCH_TELEMETRY=1` /
  `AIW_TELEMETRY=1` flips it on; `WORKBENCH_TELEMETRY_URL` /
  `AIW_TELEMETRY_URL` points at a sink. When enabled without a URL,
  the emitter constructs events and logs `telemetry: dark mode (no
  sink configured)` but never sends anything — operators can verify
  the wiring before standing up a sink. Three event types: `runtime_start`
  (controlPlane, authMode, environment, hasChat, chatProvider),
  `error` from `app.onError` (code + status), `command_run` from the
  CLI's top-level wrapper (subcommand name only, never argument
  values), plus a CLI-side `error` (code + exit). Every event carries
  an anonymous install id persisted at `$WORKBENCH_DATA_DIR/.install-id`
  (runtime) or `$AIW_CONFIG_HOME/.install-id` (CLI). Wire format is a
  fire-and-forget `POST` with a 2 s timeout — network failures never
  block the runtime or the CLI. New
  [`docs/telemetry.md`](./docs/telemetry.md) is the canonical event
  catalog and no-PII guarantee. New runtime config block
  `runtime.telemetry: { enabled, url }` (env vars win over YAML).
  ([`runtimes/typescript/src/lib/telemetry.ts`](./runtimes/typescript/src/lib/telemetry.ts),
  [`packages/aiw-cli/src/telemetry.ts`](./packages/aiw-cli/src/telemetry.ts),
  [`docs/telemetry.md`](./docs/telemetry.md))
- **Observability surfaces: `/health/details`, `/health/recent-errors`,
  curated metrics, Grafana starter dashboard, web `/status` page.**
  Two new unauthenticated read-only endpoints surface deep backend
  health: `GET /health/details` returns `{controlPlane, chat, ingest,
  recentErrors}` with per-probe `{status: ok|degraded|down, detail,
  durationMs}`; `GET /health/recent-errors` exposes an in-memory ring
  buffer (cap 100, newest first) of the last error envelopes —
  `code`, `status`, `method`, matched route pattern, request id,
  timestamp, no PII. Five new Prometheus families land at
  `/metrics`: `workbench_chat_requests_total{provider,outcome}`,
  `workbench_chat_stream_tokens_total{direction}`,
  `workbench_ingest_documents_total{outcome}`,
  `workbench_search_requests_total{mode,outcome}`,
  `workbench_search_duration_seconds{mode}`. `ChatService` now
  declares `providerId` (`"huggingface"`, `"openai"`, …) and an
  optional `ping()` (HF `whoami-v2`, OpenAI `/models`) that powers
  the chat probe. A starter Grafana dashboard with rows for HTTP,
  chat, ingest, and search is committed at
  [`docs/observability/grafana-workbench.json`](./docs/observability/grafana-workbench.json) —
  drop-in via Dashboards → Import. The web UI gains a `/status`
  route (lazy-loaded [`apps/web/src/pages/StatusPage.tsx`](./apps/web/src/pages/StatusPage.tsx))
  rendering traffic-light cards for each probe + the recent-errors
  table, polled every 10 seconds.
  ([`runtimes/typescript/src/lib/health-probes.ts`](./runtimes/typescript/src/lib/health-probes.ts),
  [`runtimes/typescript/src/lib/recent-errors.ts`](./runtimes/typescript/src/lib/recent-errors.ts),
  [`runtimes/typescript/src/lib/runtime-metrics.ts`](./runtimes/typescript/src/lib/runtime-metrics.ts),
  [`runtimes/typescript/src/routes/operational.ts`](./runtimes/typescript/src/routes/operational.ts),
  [`docs/production.md`](./docs/production.md))
- **First-run setup wizard + managed credentials file.** New
  unauthenticated `GET /setup-status` reports whether the runtime
  needs first-run configuration (`setupComplete`, `workspacesCount`,
  `controlPlane`, `hasAstraCreds`, `hasChatProvider`, `managedEnv`).
  New `POST /setup/env` atomically writes a wizard-managed dotenv
  file (allow-list: `ASTRA_DB_API_ENDPOINT`,
  `ASTRA_DB_APPLICATION_TOKEN`, `HUGGINGFACE_API_KEY`) to
  `$WORKBENCH_DATA_DIR/.env` with mode `0600`; `POST /setup/restart`
  triggers graceful shutdown so the bundled compose `restart:
  unless-stopped` brings the runtime back with the new values
  loaded. Both mutation routes accept the bootstrap token, or run
  unauthenticated only while `auth.mode === "disabled"` AND no
  workspaces exist (the fresh-install window). The web onboarding
  page gains a new "Credentials" step 0 driven by
  [`apps/web/src/components/onboarding/CredentialsStep.tsx`](./apps/web/src/components/onboarding/CredentialsStep.tsx)
  that posts to the new routes, polls `/readyz`, and advances to the
  existing backend/details/agents flow. The compose file sets
  `WORKBENCH_DATA_DIR` and `WORKBENCH_ENV_FILE` so the wizard's
  output is auto-loaded on the next boot. `WORKBENCH_ENV_FILE` is
  no longer fatal-on-absent — fresh containers boot with no managed
  file and the wizard writes it.
  ([`runtimes/typescript/src/routes/setup.ts`](./runtimes/typescript/src/routes/setup.ts),
  [`runtimes/typescript/src/setup/managed-env.ts`](./runtimes/typescript/src/setup/managed-env.ts),
  [`apps/web/src/pages/OnboardingPage.tsx`](./apps/web/src/pages/OnboardingPage.tsx),
  [`docker-compose.yml`](./docker-compose.yml))
- **CLI: `aiw doctor`, `aiw status`, `aiw profile`, `aiw completion`.**
  Pre-flight diagnostics (`aiw doctor`) run a fixed checklist —
  profile resolution, runtime reachability, `/readyz`, `/auth/me`,
  MCP feature flag, Astra-CLI auto-discovery — and exit 0 / 1 / 2
  on pass / fail / warn-only. `aiw doctor --explain <code>` prints
  the runtime's error-registry entry for a given code (fetched live
  from `/error-codes`). `aiw status` is the one-line counterpart for
  scripted health probes. `aiw profile {ls,use,rm}` manages the
  CLI's stored credential profiles without re-running `login`. `aiw
  completion {bash,zsh,fish}` emits a hand-rolled shell-completion
  script (citty has no generator); covers top-level verbs and one
  level of subcommands.
  ([`packages/aiw-cli/src/commands/doctor.ts`](./packages/aiw-cli/src/commands/doctor.ts),
  [`packages/aiw-cli/src/commands/status.ts`](./packages/aiw-cli/src/commands/status.ts),
  [`packages/aiw-cli/src/commands/profile.ts`](./packages/aiw-cli/src/commands/profile.ts),
  [`packages/aiw-cli/src/commands/completion.ts`](./packages/aiw-cli/src/commands/completion.ts))
- **CLI: documented exit codes, retries, timeouts, container-aware
  config path.** Scripts wrapping `aiw` can now branch on stable exit
  codes (`OK`, `RUNTIME_ERROR`, `USAGE_ERROR`, `AUTH_ERROR`,
  `NOT_FOUND`, `CONFLICT`, `UNAVAILABLE`) derived from the server's
  error code first, then HTTP status. `request()` in
  [`packages/aiw-cli/src/http.ts`](./packages/aiw-cli/src/http.ts) now
  enforces a 10-second timeout (override via
  `AIW_REQUEST_TIMEOUT_MS`) and retries network failures once
  (`AIW_REQUEST_RETRIES`); 4xx/5xx are never retried. `HttpError`
  carries the envelope's `hint`, `docs`, and `requestId`, and
  [`packages/aiw-cli/src/output.ts`](./packages/aiw-cli/src/output.ts)
  renders them as indented follow-up lines under the `✗` bullet.
  Profiles now live at `$WORKBENCH_DATA_DIR/cli/config.json` when the
  CLI runs inside the bundled compose container (override with
  `AIW_CONFIG_HOME`) so they survive `docker compose down/up` in the
  same volume that holds control-plane state.
  ([`packages/aiw-cli/src/exit-codes.ts`](./packages/aiw-cli/src/exit-codes.ts),
  [`packages/aiw-cli/src/http.ts`](./packages/aiw-cli/src/http.ts),
  [`packages/aiw-cli/src/config.ts`](./packages/aiw-cli/src/config.ts),
  [`packages/aiw-cli/README.md`](./packages/aiw-cli/README.md))
- **Error code registry + remediation hints in every API envelope.**
  Every error response now carries optional `hint` (one-line
  remediation) and `docs` (relative path under the docs root,
  e.g. `docs/errors.md#workspace-not-found`) alongside the existing
  `code` / `message` / `requestId`. Hints come from a single registry
  at [`runtimes/typescript/src/lib/error-codes.ts`](./runtimes/typescript/src/lib/error-codes.ts);
  the runtime auto-fills them whenever a thrown `ApiError` (or a
  control-plane error mapped to a registered code) matches an entry,
  so route handlers don't restate the hint at every throw site. New
  unauthenticated read-only `GET /error-codes` endpoint returns the
  registry as JSON for tooling (CLI `--explain`, web `/status` page,
  external dashboards). The new [`docs/errors.md`](./docs/errors.md)
  is generated from the registry via `npm run docs:errors`; a vitest
  drift guard fails CI if it goes stale or if a thrown code is
  unregistered. ([`runtimes/typescript/src/lib/error-codes.ts`](./runtimes/typescript/src/lib/error-codes.ts),
  [`runtimes/typescript/src/lib/errors.ts`](./runtimes/typescript/src/lib/errors.ts),
  [`runtimes/typescript/src/routes/operational.ts`](./runtimes/typescript/src/routes/operational.ts),
  [`docs/errors.md`](./docs/errors.md))

### Changed

- **MCP façade is on by default.** `mcp.enabled` now defaults to
  `true` so the Connect tab recipes (LangGraph, Google ADK, CrewAI,
  Microsoft Agent Framework, watsonx Path A) work against a fresh
  install without an extra config edit. The route still sits behind
  the standard `/api/v1/*` auth middleware and the workspace-scoped
  authz wrapper, so the security boundary is unchanged — disabling
  the route never broadened or narrowed what the auth gate allows.
  Operators who want a narrower surface than the REST API can set
  `mcp.enabled: false` explicitly. `mcp.exposeChat` still defaults
  to `false` so MCP clients don't accidentally rack up inference
  cost. ([`runtimes/typescript/src/config/schema.ts`](./runtimes/typescript/src/config/schema.ts),
  [`docs/mcp.md`](./docs/mcp.md),
  [`docs/configuration.md`](./docs/configuration.md))
- **RLAC audit-log shape is now stable.** The `PolicyAuditRecord`
  field set, JSON types, and the `PolicyAction` / `PolicyDecision`
  enum membership are committed across minor releases starting with
  0.2.0. Additive changes are non-breaking; renames/removals require
  a minor-version deprecation window announced under **Changed**.
  A new `PolicyAuditRecordV1` type alias re-exports the current
  shape so future breaking evolutions can land as `V2` alongside V1
  without breaking integrators. Locked by
  [`audit-shape-lock.test.ts`](./runtimes/typescript/tests/policy/audit-shape-lock.test.ts).
  ([`docs/rlac-preview.md`](./docs/rlac-preview.md#audit-log),
  [`runtimes/typescript/src/control-plane/types.ts`](./runtimes/typescript/src/control-plane/types.ts))
- **RLAC scope clarification.** The Preview label now covers only
  the policy DSL (visibility-list semantics only). The audit log is
  no longer marked unstable, and the doc redirects integrators to
  the new Audit-log shape table for the canonical wire shape.

### Added

- **OIDC device-flow login (RFC 8628).** `aiw login --oidc` opens a
  device-flow grant against the runtime's new
  `/auth/device/authorize` + `/auth/device/token` proxy. The runtime
  fronts the configured IdP's device endpoints (auto-discovered from
  the OIDC discovery doc), so the CLI never needs the IdP issuer URL
  and the IdP client secret stays server-side. The resulting JWT is
  what the existing OIDC verifier already validates — no new
  verifier path on either side. Profiles persist the access token,
  optional refresh token, and expiry under a new `oidc` block; the
  HTTP client prefers the OIDC bearer over the API key when both
  are present. Runtime responds `501 device_flow_not_supported`
  when the IdP doesn't advertise a device endpoint, and
  `/auth/config` exposes `modes.device` so the CLI knows up front.
  `auth.device.authorize` + `auth.device.token` join the audit-
  action union (documented in [`docs/audit.md`](./docs/audit.md)).
  ([`packages/aiw-cli/src/commands/login-oidc.ts`](./packages/aiw-cli/src/commands/login-oidc.ts),
  [`runtimes/typescript/src/routes/auth.ts`](./runtimes/typescript/src/routes/auth.ts))
- **E2E coverage for settings + RLAC + CLI live API.** Three new
  Playwright specs (`settings.spec.ts`, `rlac.spec.ts`) cover the
  workspace-settings RLAC toggle (revealing/hiding the principals +
  audit panels) and the principals-panel CRUD dialog. A new
  vitest subprocess spec (`packages/aiw-cli/tests/cli-live-api.test.ts`)
  drives the compiled `aiw` binary against a Node `http` stub
  mimicking the runtime's `/auth/config`, `/auth/me`, and
  `/api/v1/workspaces` endpoints so the bearer-wiring, config-file
  precedence, and JSON-output envelope are exercised end-to-end
  without spawning the full runtime. A new `e2e/_fixtures.ts`
  helper stamps the "What's new" modal as dismissed via
  `addInitScript` so existing specs (golden-path, agent-templates,
  ingest) no longer have their first click intercepted by the
  modal's Radix overlay.
- **"What's new" modal + discoverability tooltips** — the header
  carries a sparkles trigger that opens a per-release release-notes
  dialog. Auto-opens once per `APP_VERSION` (dismissal persists under
  `aiw:wn:${APP_VERSION}` in `localStorage`) and stays available on
  demand via the trigger. Content lives in
  [`apps/web/src/lib/whats-new-content.ts`](./apps/web/src/lib/whats-new-content.ts)
  as a typed array so the doc isn't parsed at runtime. Plus three
  hover tooltips on commonly-missed operator actions: the KB explorer
  **Ingest** button, the Agents **From template** button, and the
  API-keys **New key** button. The workspace-settings Access-control
  Preview chip already carried its own tooltip and is unchanged.
  ([`apps/web/src/components/onboarding/WhatsNewModal.tsx`](./apps/web/src/components/onboarding/WhatsNewModal.tsx))
- **MCP write expansion** — three new write tools land on the MCP
  façade: `create_knowledge_base`, `delete_knowledge_base`, and
  `run_agent`. The first two wrap the same `KnowledgeBaseService`
  the REST `/knowledge-bases` route uses, so the collection-provision
  and rollback dance runs identically across MCP and REST. `run_agent`
  is a one-call form of `chat_send` — it resolves (or creates) a
  conversation bound to the agent's KB set and drives the same
  orchestration helper, returning a structured envelope with the
  conversation id so callers can follow up without juggling chat
  lifecycle. KB writes require the `write` scope; `run_agent`
  follows the same `read`-passes convention as `chat_send` since
  its mutations are scoped to one conversation.
  ([`runtimes/typescript/src/mcp/server.ts`](./runtimes/typescript/src/mcp/server.ts),
  [`runtimes/typescript/src/mcp/run-agent.ts`](./runtimes/typescript/src/mcp/run-agent.ts))

## [0.1.0] — 2026-05-17

First named release. Establishes semver tracking, an automated release
workflow, a published CHANGELOG, and the `aiw` command-line interface.
Everything in this release is considered **internal Beta** — interfaces
may still change between minor versions until 1.0.

### Added

- **`@ai-workbench/cli` (`aiw` binary).** New
  [`packages/aiw-cli/`](./packages/aiw-cli) workspace. Talks to a
  running runtime over the existing HTTP API. Commands:
  `aiw login`, `aiw logout`, `aiw whoami`, `aiw workspace {list,create,delete}`,
  `aiw kb {list,create}`, `aiw doc upload`, `aiw search`, `aiw agent list`,
  `aiw chat`, `aiw job status`. Profiles live in `~/.aiw/config.json`
  (mode `0600`); `--profile` + `--url` flag overrides supported.
  API-key auth only (paste a key minted in the web UI). Single-binary
  builds attached to GitHub Releases; npm publishes under
  `@ai-workbench/cli`.
- **MCP read tools — `list_agents` and `get_agent`.** External MCP
  clients can now discover and inspect workbench-defined agents
  without leaving the protocol.
  ([`runtimes/typescript/src/mcp/server.ts`](./runtimes/typescript/src/mcp/server.ts))
- **Web UI Beta · v0.1.0 chip** in the header so internal users know
  what release they're looking at.
  ([`apps/web/src/components/layout/AppShell.tsx`](./apps/web/src/components/layout/AppShell.tsx))
- **Skeleton loaders** — `SkeletonCard` + `SkeletonRow` for list/table
  pages; replaces the centered spinner so layouts don't jump when data
  arrives. Live regions + `aria-busy` on all shared state components.
  ([`apps/web/src/components/common/states.tsx`](./apps/web/src/components/common/states.tsx))
- **`docs/whats-new-0.1.0.md`** — narrative tour of this release.
- **`docs/rlac-preview.md`** — dedicated guide for the Preview-labeled
  RLAC feature.
- **Changesets workflow** — every PR with user-visible impact adds a
  `.changeset/*.md` file. See
  [`CONTRIBUTING.md`](./CONTRIBUTING.md#releasing).
- **`.github/workflows/release.yml`** — tag-triggered release that
  builds + publishes the CLI to npm, pushes the runtime Docker image
  to GHCR, builds cross-platform single-binary CLI artifacts, and
  creates the GitHub Release with the matching CHANGELOG section.

### Changed

- **Polyglot runtime framing.** Python + Java runtimes are explicitly
  labeled **Experimental contrib** in their READMEs and in the root
  README runtime matrix. TypeScript is the supported runtime for
  0.1.0; the polyglot runtimes remain valuable as conformance-harness
  targets but carry no stability guarantee.
- **RLAC on Documents** stays labeled **Preview** — the access-control
  card in workspace settings shows a `Preview` chip linking to
  `docs/rlac-preview.md`. API and audit-log shapes may change before
  0.2; see the doc for the deferred items.
- **Root `package.json`** now orchestrates the new `packages/aiw-cli`
  workspace via `install:cli`, `test:cli`, `build:cli`, and includes
  it in `npm run check`.

### Pending — landing in 0.2.0

These were scoped for 0.1.0 but deferred to keep the release focused:

- OIDC device-flow login for the CLI.
- MCP write expansion (`create_knowledge_base`, `delete_knowledge_base`,
  `run_agent`) — requires threading the KB and chat services into the
  MCP deps.
- RLAC GA and stability commitment for the audit log shape.
- Full E2E coverage for chat + settings + RLAC + the `aiw-cli` smoke
  flow.
- Discoverability tooltips + "What's new in 0.1.0" modal in the web UI.

[Unreleased]: https://github.com/datastax/ai-workbench/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/datastax/ai-workbench/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/datastax/ai-workbench/releases/tag/v0.1.0
