# Changelog

All notable changes to AI Workbench are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html)
starting at `0.1.0`. Pre-`1.0`, breaking changes can land in a minor
release — they will be called out under **Changed** below.

## [Unreleased]

## [0.2.1] — 2026-05-27

Headline: **RLAC on Documents graduates from Preview to GA**, with
new `aiw principal` and `aiw policy` CLI surfaces and a wider
test-coverage sweep behind it. No public API or schema changes;
safe upgrade from `0.2.0`.

### Changed

- **Default seeded LLM service is HuggingFace.** Every freshly-created
  workspace used to be auto-seeded with an `openai-gpt-4o-mini` LLM
  service ([control-plane/default-services.ts](./runtimes/typescript/src/control-plane/default-services.ts)),
  which pushed operators toward an OpenAI key just to try the
  out-of-the-box experience even though the runtime's default
  `chat.tokenRef` already pointed at `HUGGINGFACE_API_KEY`. The seed
  is now `huggingface-gpt-oss-20b` pointing at
  `openai/gpt-oss-20b` (matches the runtime's default chat
  model and the wizard's managed-env allow-list), so
  pasting a HuggingFace token at `/settings` lights up agent chat
  with zero LLM-service edits. HF doesn't expose native function
  calling, so the agent dispatcher falls back to the
  retrieve-and-answer flow described in
  [`chat/agent-dispatch.ts`](./runtimes/typescript/src/chat/agent-dispatch.ts) —
  tools still execute, just not via a function-call protocol.
  Existing workspaces are unaffected (only seeded on POST).
- **LLM-service form: popular-model picker + Other (custom).**
  [`LlmServiceForm`](./apps/web/src/components/agents/LlmServiceForm.tsx)
  used to be a free-form `<Input>` where operators had to remember
  the exact HF model slug
  (e.g. `openai/gpt-oss-20b`). It's now a `<Select>`
  with four curated HuggingFace defaults — GPT-OSS 20B
  (default), GPT-OSS 120B, Qwen3 32B, Llama 3.3 70B Instruct, all
  currently served by the HF Inference Providers router — plus an
  **Other (custom)…** row that reveals the free-form input for any
  other model name. Picking a popular row
  also pre-fills the provider and a sensible `maxOutputTokens`.
  Edit mode renders the free-form input automatically when the
  service points at a non-popular model (existing services keep
  working unchanged). 3 new tests
  ([`LlmServiceForm.test.tsx`](./apps/web/src/components/agents/LlmServiceForm.test.tsx))
  cover the picker + Other branch + edit-mode pre-fill, plus a
  Radix-`hasPointerCapture` jsdom polyfill in the shared test
  setup ([`src/test/setup.ts`](./apps/web/src/test/setup.ts)) so
  other Select-driven tests work without per-file workarounds.
- **Chat is default-on.** Previously, omitting `chat:` from
  `workbench.yaml` left chat disabled and every agent send route
  returned `503 chat_disabled`. The default flips: a fresh install
  boots with `chat.enabled: true`,
  `tokenRef: env:HUGGINGFACE_API_KEY`, and the canonical HF
  defaults
  ([`src/config/schema.ts`](./runtimes/typescript/src/config/schema.ts)).
  When the env var isn't set, the existing degraded path applies
  unchanged — preflight is advisory, `buildChatService` returns
  null with a `warn` log, and the agent send routes still return
  `503 chat_disabled` until the operator pastes a token via
  `/settings` (which writes the managed dotenv file and triggers a
  restart). To **opt out** of chat entirely, add the new
  single-field block:

  ```yaml
  chat:
    enabled: false
  ```

  Explicit `chat:` blocks in existing configs continue to work —
  the new `enabled` field defaults to `true`, so omitting it
  preserves prior behavior. 4 new tests
  ([`tests/config.test.ts`](./runtimes/typescript/tests/config.test.ts)
  + [`tests/chat/factory.test.ts`](./runtimes/typescript/tests/chat/factory.test.ts))
  lock the four branches: default-on, explicit opt-out, unresolved
  token (bootstrap path), and the healthy resolve.

### Fixed

- **Default chat model is actually routable.** A HuggingFace model
  can be unusable for chat in two distinct ways, and both used to
  surface only at *send* time. (1) **Not a chat model** — HF's router
  stopped serving `mistralai/Mistral-7B-Instruct-v0.3` for the
  `conversational` task (`… is not a chat model`). (2) **Not
  routable** — the Inference Providers router only serves models a
  provider has onboarded, so `Qwen/Qwen2.5-7B-Instruct` (onboarded by
  no provider) failed with `not supported by any provider you have
  enabled`. The runtime default chat model, the auto-seeded LLM
  service, the wizard managed-env allow-list, and the form's
  popular-model menu all now use **`openai/gpt-oss-20b`** — the
  widest-served *ungated* small chat model on the router (live across
  groq, novita, together, fireworks, and more) — so a fresh token
  with default provider settings routes out of the box.
- **Config-time chat-model guard.** Creating or updating a
  HuggingFace LLM service now runs a fail-open probe
  ([`src/chat/model-probe.ts`](./runtimes/typescript/src/chat/model-probe.ts))
  before persisting: a single `max_tokens: 1` chat completion that,
  on a *definitive* signal, rejects the save so a bad custom model
  (picked via **Other (custom)…**) is caught at configuration time
  instead of when an agent first replies — `422 llm_model_not_chat`
  when the model is served but not for chat, `422
  llm_model_unavailable` when no provider serves it. The probe is
  strictly fail-open — it only runs when a credential resolves, and
  any transient failure (network, rate limit, auth, cold-start) lets
  the save through rather than blocking it. New unit coverage for
  the classifiers
  ([`tests/chat/model-probe.test.ts`](./runtimes/typescript/tests/chat/model-probe.test.ts))
  and route-level reject / allow / skip / PATCH-re-probe coverage
  ([`tests/llm-services.test.ts`](./runtimes/typescript/tests/llm-services.test.ts)).

### Added

- **Rescue-mode boot.** Control-plane init throwing at startup
  (typo'd Astra endpoint resolving to `ENOTFOUND`, revoked token
  triggering 401, region hibernating past the resume window) used
  to take down the whole process: the operator would see
  `startup failed` in logs and be left with no in-app remediation
  for credentials they'd just entered through `/settings`. The
  runtime now wraps control-plane init in `main()` at
  [`root.ts`](./runtimes/typescript/src/root.ts) and, on failure,
  pivots to a minimal HTTP server
  ([`src/rescue/app.ts`](./runtimes/typescript/src/rescue/app.ts))
  that:
  - serves the SPA so `/settings` actually renders,
  - reports the classified failure via `GET /setup-status`'s new
    optional `bootError: {code, message}` field
    (`control_plane_dns_unresolvable`,
    `control_plane_unauthorized`,
    `control_plane_unreachable`,
    `control_plane_forbidden`, or the catch-all
    `control_plane_unavailable`),
  - accepts `POST /setup/env` with no auth gate (rescue mode is
    open by definition — no privilege boundary exists when the
    control plane is down),
  - triggers `POST /setup/restart` so the container restart policy
    brings the runtime back with the corrected credentials,
  - returns `503 control_plane_unavailable` on every `/api/v1/*`
    call so callers see a clean failure instead of a 404, and
  - returns 503 on `/healthz` and `/readyz` so external probes
    know the runtime is degraded.

  The SPA cooperates: the new
  [`SettingsPage`](./apps/web/src/pages/SettingsPage.tsx) renders
  a red rescue-mode banner with a tailored remediation hint per
  error code, and
  [`AppShell`](./apps/web/src/components/layout/AppShell.tsx)
  redirects users from data routes to `/settings` whenever
  `bootError` is present so the dead-end is broken on first paint.
  12 new runtime tests
  ([`tests/rescue/app.test.ts`](./runtimes/typescript/tests/rescue/app.test.ts))
  + 1 new SPA test lock the contract.
- **Header nav: icons-only + reorder.** The header `<nav>` was
  half text-half icons (`API docs` was the lone text link). Reorder
  to `Theme · API docs · Settings · What's new · UserMenu`, all
  rendered as icon buttons (BookOpen for API docs, Cog for
  settings) with `aria-label`s and tooltips for accessibility. No
  behavior change.
- **Runtime settings page (`/settings`).** The first-run onboarding
  wizard captures Astra and HuggingFace credentials into a managed
  dotenv file and disappears once setup completes. There was no
  in-app surface to **update** those credentials afterwards — a
  missing `HUGGINGFACE_API_KEY` left chat at `503 chat_disabled`
  with no remediation short of shelling into the container and
  editing the env file by hand. This release adds:
  - A new top-level [`SettingsPage`](./apps/web/src/pages/SettingsPage.tsx)
    at `/settings`, reachable from a gear-icon link in the header.
    Hosts a **Runtime credentials** card with paste-and-update
    fields for `ASTRA_DB_API_ENDPOINT`,
    `ASTRA_DB_APPLICATION_TOKEN`, and `HUGGINGFACE_API_KEY` (the
    same `MANAGED_ENV_KEYS` allow-list the wizard uses). Saving
    POSTs to `/setup/env`, triggers `/setup/restart`, polls
    `/readyz`, and reconnects automatically. Surfaces a banner
    when `setup-status.hasChatProvider` is false so the
    chat-disabled state is discoverable from the SPA.
  - Backend: [`setupAuthGate`](./runtimes/typescript/src/routes/setup.ts)
    was relaxed so `/setup/env` and `/setup/restart` accept
    post-setup updates when `auth.mode: disabled` (the single-user
    dev posture — no privilege boundary exists). Auth-enabled
    deployments still require the bootstrap token, unchanged.
  - **Dev-mode self-respawn.** `/setup/restart` previously SIGTERMed
    the process and relied on a container restart policy to bring
    the runtime back. In `npm run dev` / `node dist/root.js` /
    `tsx watch` there's no orchestrator, so the SPA's `/readyz`
    poll spun forever. A new
    [`respawn` helper](./runtimes/typescript/src/lib/respawn.ts)
    now detects "no orchestrator" mode (PID != 1 AND no
    `WORKBENCH_DISABLE_SELF_RESPAWN=1` override) and spawns a
    detached child process with the same argv + execArgv + env
    before draining the parent. Container mode (PID 1) stays
    unchanged — the orchestrator already does this and a stray
    detached child wouldn't survive container teardown.
  - **Managed env file is loaded at boot.**
    [`loadDotEnv`](./runtimes/typescript/src/config/env-file.ts)
    used to only walk for a project `.env`, so a HuggingFace token
    pasted via `/settings` (which writes to
    `.workbench-data/.env`) never reached the respawned child's
    `process.env` — the SPA banner kept saying *"Chat is
    unconfigured"* even after a successful save + restart. The
    loader now additionally calls `loadEnvFile` on
    `managedEnvLocation()` after the primary source, so the
    managed file fills any gaps without overriding higher-priority
    sources (process env > explicit `WORKBENCH_ENV_FILE` > managed
    > walked `.env`). New optional `managedEnvPath` field on
    `EnvFileResult` for the boot-time log.
  - 6 new SPA render tests
    ([`SettingsPage.test.tsx`](./apps/web/src/pages/SettingsPage.test.tsx))
    + 1 new runtime gate test
    ([`setup-routes.test.ts`](./runtimes/typescript/tests/setup-routes.test.ts))
    + 8 respawn-helper tests
    ([`tests/lib/respawn.test.ts`](./runtimes/typescript/tests/lib/respawn.test.ts))
    + 3 env-loader tests
    ([`tests/env-file.test.ts`](./runtimes/typescript/tests/env-file.test.ts))
    lock the contract.
- **DSL: admin bypass for the default policy.** The default policy
  DSL applied when a KB has `policyEnabled: true` and no custom
  predicate is now:

  ```
  $principal.admin = 'true'
    OR current_principal_id() = ANY(visible_to)
    OR '*' = ANY(visible_to)
  ```

  Principals carrying `admin: 'true'` see every row regardless of
  `visible_to` — the workspace operator no longer has to add
  themselves to every doc to read their own data. The compiler
  evaluates the bypass clause at compile time and collapses the
  surrounding `OR` to an empty Data API filter (MATCH_ALL) for
  admin-attributed callers, so admin reads have no per-row
  overhead. Non-admin principals see exactly the prior behavior:
  the bypass clause drops out of the compiled filter, leaving the
  same `$or` of `visible_to` grants as before. New compiler
  short-circuit logic + `applyVisibleToFilter` sentinel handling +
  evaluator/compiler/validator tests
  ([`src/policy/compiler.ts`](./runtimes/typescript/src/policy/compiler.ts),
  [`src/policy/validator.ts`](./runtimes/typescript/src/policy/validator.ts),
  [`tests/policy/policy.test.ts`](./runtimes/typescript/tests/policy/policy.test.ts))
  lock the contract.
- **Header: icon-only theme toggle + Settings repositioned.** The
  theme picker dropped its dropdown and is now a single icon
  button that cycles light → dark → system → light; matches the
  other icon-only header affordances. Settings (Cog) moved to the
  right of What's New so the final order reads:
  Theme · API docs · What's new · Settings · UserMenu.
- **RLAC flip-on bootstrap.** Flipping a workspace's `rlacEnabled`
  from `false` to `true` used to drop operators into a UX dead-end
  on the in-memory / `auth.mode: disabled` quickstart: the KB list
  was still visible, but every document call returned
  `policy_principal_required` because (a) no principal record
  existed, so the View-as picker didn't even render, and (b) every
  pre-RLAC document had a null `visibleTo`, which the canonical DSL
  treats as invisible. The PATCH handler at
  [`routes/api-v1/workspaces.ts`](./runtimes/typescript/src/routes/api-v1/workspaces.ts)
  now detects the false→true transition and runs
  [`bootstrapRlacFlipOn`](./runtimes/typescript/src/policy/flip-on-bootstrap.ts):
  - **Default principal with admin bypass.** If the workspace has
    zero principals, creates `admin` with
    `attributes: { admin: "true" }`. The default DSL grants
    universal read access to admin-attributed principals (see
    "DSL: admin bypass" below), so the operator sees every document
    immediately without having to add themselves to each doc's
    `visible_to`. The View-as picker auto-selects the first
    principal alphabetically, so the next render sends
    `x-view-as-principal: admin` on every API call.
  - **Visibility backfill.** Every document with `visibleTo: null`
    is upgraded to `visibleTo: ["*"]`. Documents with an explicit
    `visibleTo` (including the empty array — a deliberate
    "no audience" choice) are left alone.
  - **Best-effort + idempotent.** A bootstrap failure logs `warn`
    but doesn't fail the workspace toggle. Re-flipping is a no-op.

  The web UI side cooperates by broadening `useUpdateWorkspace`'s
  cache invalidation
  ([`apps/web/src/hooks/useWorkspaces.ts`](./apps/web/src/hooks/useWorkspaces.ts))
  to also invalidate the workspace-scoped query subtree, so the
  principals list, View-as picker, and document table all refetch
  through the post-bootstrap state. 8 new tests
  ([`tests/policy/flip-on-bootstrap.test.ts`](./runtimes/typescript/tests/policy/flip-on-bootstrap.test.ts))
  lock the bootstrap contract.
- **RLAC on Documents — GA.** The audit-log shape was locked in
  0.2.0; the in-process policy evaluator hit 100% statement coverage
  in this release (see the next entry). With both the shape and the
  primary code path now stable, RLAC on Documents drops the
  `Preview` chip and graduates to GA:
  - The amber `Preview` badge on the **Access control** card in
    workspace settings is removed; the "Learn about the Preview
    status →" link becomes a neutral "Learn more →"
    ([`apps/web/src/pages/WorkspaceSettingsPage.tsx`](./apps/web/src/pages/WorkspaceSettingsPage.tsx)).
  - [`docs/rlac-preview.md`](./docs/rlac.md) is renamed to
    [`docs/rlac.md`](./docs/rlac.md) and reworded: the "Preview
    feature" callout is gone, "Known limitations" is reframed as
    "Scope of this release", and the doc gains a CLI-quickstart
    block. Out-of-scope items (RLAC on conversations/agents, rich
    predicates like group hierarchies or time-bounded visibility)
    are flagged as additive 0.3.x follow-ups that won't break the
    GA surface.
  - The visibility-list semantics and the principal CRUD surface
    are now part of the stable contract alongside the audit shape.
- **`aiw principal` and `aiw policy` CLI commands.** The runtime
  routes have existed since RLAC shipped; 0.2.1 wires the
  long-promised CLI on top. All commands respect the active profile
  + `--workspace` / profile `defaultWorkspace`.
  - [`aiw principal {list,get,create,update,delete}`](./packages/aiw-cli/src/commands/principal.ts)
    wraps `/api/v1/workspaces/{w}/principals[/{id}]`. `create` and
    `update` accept repeatable `--attribute key=value` flags so a
    principal's `attributes` map (the same one the policy DSL
    queries via `$principal.<attr>`) can be set from the shell.
  - [`aiw policy preview --dsl "..." [--principal id]`](./packages/aiw-cli/src/commands/policy.ts)
    POSTs to `/policy/compile-preview` and surfaces the compiled
    Data API filter alongside any validation issues — useful for
    iterating on a DSL before flipping `rlacEnabled` on a workspace.
  - [`aiw policy audit`](./packages/aiw-cli/src/commands/policy.ts)
    lists recent RLAC decisions with `--principal` / `--kb` /
    `--day` / `--limit` filters.
  - 16 new pure-helper tests
    ([`tests/principal-command.test.ts`](./packages/aiw-cli/tests/principal-command.test.ts),
    [`tests/policy-command.test.ts`](./packages/aiw-cli/tests/policy-command.test.ts))
    lock the human renderer layouts.
- **Branch-complete RLAC policy evaluator tests.** The in-process
  evaluator at [`runtimes/typescript/src/policy/evaluator.ts`](./runtimes/typescript/src/policy/evaluator.ts)
  drives every write-path authz check, but coverage was sitting at
  **33.9% statements / 27.5% branches** — well below the rest of the
  policy module despite the RLAC audit shape being a stability
  commitment as of 0.2.0. A new `evaluator.test.ts` adds 41 targeted
  tests covering scalar resolution (literals, `$principal.<attr>`,
  `current_principal_id()`, row column refs), every comparison
  operator on both numbers and strings, NULL semantics, type-mismatch
  defenses, `IN` / `ANY()` / `@>` membership against arrays and
  `Set`s, and boolean composition (including `AND[]` and `OR[]`
  identity edge cases). Evaluator now lands at **100% statements /
  98% branches** — the single remaining branch is the documented
  `NULL = NULL → true` quirk in `compare()`.
- **Agent-resolution branch coverage.** [`agent-resolution.ts`](./runtimes/typescript/src/chat/agent-resolution.ts)
  was at **63% statements** because the per-agent llm-service binding
  path (HuggingFace / OpenAI construction, the 4xx surface for
  missing credential refs and unsupported providers, the 503
  `chat_disabled` failure mode) was only exercised indirectly through
  dispatcher integration tests. 14 new tests now cover every failure
  mode plus the system-prompt / KB-scope precedence rules, taking the
  file to **100% statements**.
- **Prompt-assembly tool-call paths.** [`prompt.ts`](./runtimes/typescript/src/chat/prompt.ts)
  went from **65% → 100% statements**. New tests pin: persisted
  `toolCallPayload` decode (well-formed, malformed, missing,
  partial), tool-result row validation (`toolResponse.content` /
  `toolCallId` / `toolId` triple required), orphan-tool stripping
  when the matching `assistant(toolCalls)` is history-trimmed away,
  and skipping `role:"system"` history entries.
- **Jobs SSE route coverage.** [`routes/api-v1/jobs.ts`](./runtimes/typescript/src/routes/api-v1/jobs.ts)
  jumped from **24% → 88% statements**. The previous suite only
  exercised the polling GET; the new tests open a real SSE stream,
  push two `update()` calls into the `JobStore`, and assert that
  every update appears as a `data:` frame and a terminal `done` event
  closes the stream. Also covers the 404 envelope on a missing job.
- **Web hook coverage uplift.** Five hooks gained dedicated test
  files or expansions:
  - [`useRlac.ts`](./apps/web/src/hooks/useRlac.ts): **11.5% →
    96%**. Covers `useRlacEnabled` precedence, principal CRUD
    invalidation, `usePolicyCompilePreview` gating (workspaceId,
    non-blank DSL, null-vs-undefined principal id), and `usePolicyAudit`
    filter pass-through.
  - [`useServices.ts`](./apps/web/src/hooks/useServices.ts): **13.6%
    → 100%**. Covers list hooks for all three service kinds
    (chunking / embedding / reranking), the `enabled: false` path
    when workspaceId is undefined, and create / update / delete
    invalidation for every kind.
  - [`useSession.ts`](./apps/web/src/hooks/useSession.ts): **14.8%
    → 93%**. Covers `useAuthConfig`, the `enabled` gating on
    `useSession` against `auth/config.modes.login`, and all four
    `useSilentRefresh` no-op branches (missing refreshPath, opaque
    session, `canRefresh: false`) plus the 80%-of-lifetime timeout
    schedule.
  - [`useWorkspaces.ts`](./apps/web/src/hooks/useWorkspaces.ts):
    **16.7% → 100%**. Covers `useWorkspace` single-fetch, the
    enabled-on-id gate, all CRUD mutations with cache invalidation
    + detail-cache seeding, and `useTestConnection`.
- **CLI pure-logic extraction.** Several CLI command files were at
  0% coverage because their tests run the compiled binary in a
  subprocess (v8 can't instrument across process boundaries). To
  make pure logic measurable:
  - [`exit-codes.ts`](./packages/aiw-cli/src/exit-codes.ts) gained
    a 55-case `tests/exit-codes.test.ts` that locks the
    server-error-code → exit-code table and the HTTP-status
    fallback heuristic. Public contract surface — scripts depend on
    this. **0% → 100%**.
  - [`commands/status.ts`](./packages/aiw-cli/src/commands/status.ts)
    was refactored to export `buildStatusReport`, `renderHuman`,
    and `probe` (with an injectable `fetchImpl`). 15 unit tests now
    cover the report-shape assembly, the human renderer (every
    fallback branch — '?' placeholders, mcp on/off, ✗/✓
    indicator), and probe success / non-JSON / schema-rejection /
    fetch-rejection paths.
  - [`commands/job.ts`](./packages/aiw-cli/src/commands/job.ts)
    extracted `renderJob`; new tests lock the human layout of the
    `aiw job status` output.
  - [`types.ts`](./packages/aiw-cli/src/types.ts) gained a smoke
    suite for every wire schema — including the `passthrough()`
    tolerance for runtime upgrades and the bare-array shape of
    `SearchResponseSchema`. **0% → 100%**.

### Fixed

- **Boot no longer crashes when Astra rotates wire shapes mid-resume.**
  [`isAstraResumingError`](./runtimes/typescript/src/astra-client/client.ts)
  used to match only the legacy 503 envelope (`"resuming your
  database"`). Astra has been observed switching to a newer
  400/`"resuming from hibernation"` envelope across LB hand-offs while
  a single resume is still in progress: the first failure classifies
  and retries, the second comes back as the new shape, the classifier
  rejects it, and `main()` exits with a `DataAPIHttpError` instead of
  waiting out the rest of the 60-second resume window. The classifier
  now accepts both `503` and `400`, and matches either body phrasing,
  so a hibernated DB resumes cleanly under either shape (or any mix of
  them). A new
  [`waitForAstraResume`](./runtimes/typescript/tests/astra-client/resume-retry.test.ts)
  integration test reproduces the rotating-shape scenario directly so
  this can't regress.

### Coverage summary

| Surface | Before | After (statements) |
|---|---|---|
| TS runtime | 79.5% / 70.4% branch | **80.8% / 71.9% branch** |
| Web app | 57.1% / 50.0% funcs | **59.7% / 55.5% funcs** |
| CLI | 18.3% | **24.2%** (`src/` excluding command files now at 82%) |

Total tests: **1,932 passing** (+248 new vs 0.2.0 — 1,316 runtime /
422 web / 194 CLI; the +16 CLI tests on top of the sweep are the
new principal + policy renderer tests, and the +4 runtime tests
cover the Astra wire-shape rotation fix above).

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
  ([`docs/rlac.md`](./docs/rlac.md#audit-log),
  [`runtimes/typescript/src/control-plane/types.ts`](./runtimes/typescript/src/control-plane/types.ts))
- **RLAC scope clarification.** The Preview label now covers only
  the policy DSL (visibility-list semantics only). The audit log is
  no longer marked unstable, and the doc redirects integrators to
  the new Audit-log shape table for the canonical wire shape.

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
- **`docs/rlac.md`** — dedicated guide for the Preview-labeled
  RLAC feature (renamed from `docs/rlac-preview.md` when RLAC went
  GA in 0.2.1).
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
  `docs/rlac.md` (renamed in 0.2.1). API and audit-log shapes may
  change before 0.2; see the doc for the deferred items.
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

[Unreleased]: https://github.com/datastax/ai-workbench/compare/v0.2.1...HEAD
[0.2.1]: https://github.com/datastax/ai-workbench/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/datastax/ai-workbench/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/datastax/ai-workbench/releases/tag/v0.1.0
