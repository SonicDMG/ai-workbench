# Changelog

All notable changes to AI Workbench are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html)
starting at `0.1.0`. Pre-`1.0`, breaking changes can land in a minor
release — they will be called out under **Changed** below.

## [Unreleased]

## [0.5.3] — 2026-06-04

**Security tooling + dependency maintenance.** No HTTP wire-contract change and
no data migration — the runtime, API, and web app behave exactly as they did in
0.5.2. This release adds a trust gate for MCP tool definitions and keeps PDF
ingestion working across a major `pdfjs-dist` upgrade.

### Added

- **MCP tool-surface trust gate (`toolprint`).** AI Workbench both hosts an MCP
  server (`/api/v1/workspaces/{id}/mcp`) and lets agents call external MCP
  servers as tools, and an agent reads each tool's description + input schema to
  decide what to do — so a server that silently rewrites a tool definition (a
  "rug-pull") can redirect an agent. The MCP tool surface of our own server and
  of the external servers we trust (`.toolprint/mcp.json`) is now hashed and
  pinned into a committed [`toolprint.lock`](./toolprint.lock); every change is
  diffed against that pin, and drift — a changed description or schema, an
  injected instruction, a leaked secret — fails CI
  (`.github/workflows/toolprint.yml`). Run it locally with `npm run security:mcp`
  (`-- --pin` to re-pin after an intended change). The scanner only lists tools;
  it never executes one. See [`docs/mcp-trust.md`](./docs/mcp-trust.md) and the
  new "MCP tool-surface trust" section in [`SECURITY.md`](./SECURITY.md).

### Fixed

- **PDF ingestion under `pdfjs-dist` 6.** The `pdfjs-dist` 5 → 6 upgrade removed
  `PDFDocumentProxy.destroy()`; the native PDF extractor called it during
  teardown, which threw *after* a successful parse and turned every
  `POST /ingest/file` PDF upload into a `500`. The extractor now tears down via
  the loading task (`loadingTask.destroy()`), which works on both 5 and 6; text
  extraction itself was unaffected.

### Changed

- **`pdfjs-dist` upgraded 5.7.284 → 6.0.227**, alongside grouped Dependabot
  updates to the TypeScript-runtime, web, and GitHub-Actions dependency sets. The
  `toolprint` CLI pinned by the trust gate tracks 0.1.1, which classifies a
  rug-pull as `high` (so the default `--fail-on high` gates on drift) and adds
  `--header`/`--bearer` for authenticated remote targets.

## [0.5.2] — 2026-06-03

**Maintenance release.** A housekeeping pass on the 0.5 **Enterprise Access
Control** line with **no wire-contract change** and **no data migration**. It
drops a metric that never carried a signal and reconciles the contributor
codemaps with the shipped 0.5.x code; the runtime, HTTP API, and web app are
otherwise unchanged.

### Removed

- **The `workbench_chat_stream_tokens_total` metric.** This counter was
  registered on the `/metrics` endpoint but never incremented anywhere, so it
  always exported `0` — a flat-zero "Stream tokens / sec" Grafana panel and a
  doc claim with nothing behind it. Populating it faithfully would need a
  prompt-vs-completion token split the chat abstraction does not surface
  (`ChatCompletion` / `ChatStreamEvent` carry only a total `tokenCount`, and the
  OpenAI-compatible provider narrows the API `usage` object to `total_tokens`),
  so the dead counter is removed rather than left misleading. It is gone from
  the runtime metrics registry, the bundled Grafana dashboard
  (`docs/observability/grafana-workbench.json`), `docs/production.md`, and
  `docs/api-spec.md`. If you scrape it, drop the panel or alert — no replacement
  metric is emitted.

### Documentation

- **Contributor codemaps reconciled with the shipped code.** `docs/CODEMAPS/*`
  had drifted from the 0.5.x source: a route undercount is fixed, misleading
  "Generated:" headers are relabeled, several stale routes and table names are
  corrected, the `packages/aiw-cli` package and the Auth service boundary are
  added, the scoped-auth (0.5.0) decision is recorded, and the RLAC
  "(prototype)" labels are dropped now that it ships enforced. These are
  contributor-facing docs only — no user-facing behavior changes.

## [0.5.1] — 2026-06-01

**RLAC "view as" in the web app.** A fix-and-polish release on the 0.5.0
Enterprise Access Control line. There is **no wire-contract change** and **no
data migration** — it closes a UX dead-end where enabling RLAC made knowledge
bases unreadable from the web app under the default auth-disabled posture, and
adds a discreet control for previewing a knowledge base as any principal.

### Fixed

- **Enabling RLAC no longer dead-ends knowledge-base reads in the web app.**
  With `auth.mode: disabled` (the default / quickstart posture), the SPA carried
  no token and no principal, so every document read against an RLAC-enabled
  knowledge base returned `401 policy_principal_required` the instant the KB was
  opened — even though flip-on bootstrap had already created the default `admin`
  principal. The runtime's disabled-mode principal resolver and the flip-on
  design both assumed the web app would send an `x-view-as-principal` header, but
  the picker that sets it was never ported into `apps/web`. The web API client
  now sends that header on workspace-scoped requests, defaulting to the `admin`
  principal (universal read) when no auth token is present, so an RLAC-enabled
  workspace is immediately usable again. An explicit "view as" selection always
  wins; when a bearer token is present the header is omitted and the runtime
  derives the principal from the token exactly as before.

### Added

- **A discreet "view as principal" control on the knowledge-base explorer.**
  When RLAC is enabled and the app runs without an auth token, a small icon in
  the explorer's action row lets you browse the knowledge base as any principal
  to preview exactly what they can see. It defaults to `admin` (sees all) and
  turns into an accent chip naming the principal while you're impersonating
  someone else; switching refetches the document list under that identity. The
  control is hidden in token-authenticated deployments, where the principal is
  derived from the token and the header is ignored.

### Documentation

- `docs/rlac.md` now documents the shipped web-app view-as behavior (the default
  `admin` header plus the explorer control) instead of the prototype picker it
  previously described.

## [0.5.0] — 2026-06-01

**"Enterprise Access Control."** 0.5.0 turns AI Workbench's access-control story
from *prototype + coarse roles* into *enforced, fine-grained, and audited* — so
it is safe to run multi-team retrieval workloads where "who can see what" holds
at the data plane. Three must-have features land together: row-level access
control (RLAC) enforced on **every** read path, fine-grained API-key scopes, and
access-controlled agent MCP tool-calling.

There is **no breaking wire-contract change** and **no required data migration**
— fine-grained scopes are additive (coarse keys keep working), and RLAC chunk
visibility backfills automatically. See **Migration** below before enabling RLAC
on an existing deployment.

### Added

- **Row-level access control is now enforced on every read path — including
  agent chat retrieval.** RLAC policies were previously enforced on the REST
  document routes only; an agent's RAG retrieval bypassed them entirely. Now
  `search_kb`, `list_chunks`, `get_document`, document listing, and the Astra
  `data_api` tool all compose the compiled policy filter, so a principal's agent
  can only retrieve what that principal can see. Chunks are stamped with their
  document's `visible_to` **at ingest**, so the data plane matches the control
  plane — the central bug that made RLAC-on search return nothing.
- **RLAC admin UI.** A new Access Control card (RLAC on/off), Principals panel
  (CRUD), and Policy Audit panel in workspace settings — the admin surface
  `docs/rlac.md` described but that did not previously exist.
- **Fine-grained API-key scopes.** Keys can be minted with narrow scopes
  (`read:content`, `read:chat`, `read:audit`, `write:ingest`, `write:kb`,
  `write:services`, `write:agents`, `manage:keys`, `manage:access`,
  `manage:workspace`, `tools:invoke`) alongside the coarse `read` / `write` /
  `manage` tiers. A "Custom (advanced)" scope picker in the create-key dialog,
  tier-colored scope chips, and a new `aiw key create|list|revoke` CLI command
  (with `--role` presets and repeatable `--scope`) expose them.
- **Agent external MCP tool-calling, access-controlled.** Agents can call tools
  on registered external MCP servers under a `tools:invoke` grant, enforced
  per-call — a call without the scope is denied and audited, never executed.
  Save-time `toolId` validation rejects an agent that references an unresolvable
  `mcp:` / `native:` / `astra:` tool (`422 agent_tool_unresolved`). The agent
  form groups tools by server, shows required arguments, and warns about saved
  tools that no longer resolve. Per-server tool discovery is memoized with a
  short TTL to keep agent turns and form loads fast.
- **Tool-invocation and scope-denial audit detail.** `tool.invoke` audit rows
  carry `source` and `mcpServerId`; a scope-denied API request records the
  `requiredScope`.
- **New cross-runtime conformance scenarios** pinning the RLAC principal/policy
  contract, fine-scope mint/normalization, the external MCP-server registry
  lifecycle (incl. SecretRef enforcement), and the available-tools catalog
  shape.

### Changed

- **Scope checks use hierarchical containment instead of exact-string match.**
  A held scope `X` grants a required scope `Y` when `Y === X` or `Y` is nested
  under `X` (so a coarse `write` key grants `write:ingest`). This is what lets
  the coarse tiers stay supersets of the new fine scopes with **no data
  migration** — every existing key keeps exactly the access it had. The MCP
  JSON-RPC façade adopts the same containment check, replacing its own
  exact-match copy of the gate.
- **A single shared in-memory Data API filter interpreter** now backs the mock
  driver, the document-list path, and the mock-Astra conformance server, so
  `$or` / `$and` visibility filters evaluate identically across them — closing a
  silent mock-vs-production semantic drift.
- **Docs rewritten to match shipped reality:** `docs/rlac.md`, `docs/auth.md`
  (scope taxonomy + containment table + migration notes), `docs/audit.md` (new
  fields), and the stale client-side-MCP line in `docs/roadmap.md`.

### Security

- **DNS-resolution SSRF parity for external MCP server URLs.** Beyond the
  literal-host check, an MCP server's hostname is resolved and every resolved
  address re-validated against the same egress policy, so a benign-looking name
  that resolves to `169.254.169.254` — or, when private egress is locked down,
  an internal IP — is refused before any connection is opened. On-prem
  deployments that allow private egress can still register internal MCP servers.
- **Untrusted MCP servers can no longer bloat the model prompt.** An advertised
  tool description is length-capped and an oversized advertised input schema is
  dropped to a permissive object, bounding the metadata an external server
  injects into the tool manifest each turn. Tool descriptions render as inert
  text, never HTML.

### Migration

- **Enabling RLAC on an existing workspace:** new ingests are tagged with their
  visibility automatically, and existing chunks are re-tagged from each
  document's `visibleTo` when you flip RLAC on (and via the backfill script).
  Until a workspace is backfilled, an RLAC-on search reflects only re-tagged
  chunks — flip on, let the backfill run, then verify.
- **Fine-grained scopes are additive — no action required.** Existing coarse
  `read` / `write` / `manage` keys keep working unchanged; the default for a new
  key is still `["read", "write"]`. Mint narrower keys only where you want them.
- **Two deliberate behavior changes to note:** reading the **policy-audit log**
  now requires `manage:access` (a coarse `manage` key still grants it), and an
  agent calling an **external MCP tool** now requires `tools:invoke` (a coarse
  `write` key grants it, so existing write-capable keys are unaffected). Chat
  message sends remain ungated for read-shaped keys.

## [0.4.3] — 2026-05-31

A hardening-and-correctness release on the 0.4.x line. There is **no HTTP
wire-contract change** and **no data migration** — this release completes the
control-plane delete cascade, adds a self-healing cross-partition cascade with
an opt-in orphan reconciler, hardens the rescue/setup surface, and keeps
secrets out of structured logs.

### Added

- **Self-healing control-plane cascade + opt-in orphan reconciler.** On the
  Astra backend, deleting a workspace now removes its child rows
  children-first / parent-last. A partial failure leaves the workspace row in
  place and returns `500 cascade_incomplete` (a new error code) so the
  idempotent cascade finishes on retry instead of stranding orphans. A new
  `reconcileOrphans()` pass — opt-in via `controlPlane.reconcileOrphansOnStart`
  — sweeps pre-existing orphaned rows at startup.

### Changed

- **Unified row-level access control (RLAC) defaulting** behind a single
  `resolveRlacDefaults` path: a document's owner defaults are applied
  independently of `visibleTo`. Authorization behaviour is unchanged
  (security-reviewed) — this removes a divergent code path, not a rule.
- **Internal modularization sweep (no behaviour change).** Continued splitting
  large modules — the multipart ingest parser moved to
  `routes/api-v1/ingest-file-form.ts`, and the Playground code generation moved
  into its own tested module.
- **The OpenAPI document now describes the job-progress SSE endpoint.**
  `GET .../jobs/{jobId}/events` was served but missing from
  `/api/v1/openapi.json`; it is now registered (path params, the
  `Last-Event-ID` resume header, and the `text/event-stream` response), so the
  generated web API types and any client built from the spec cover the
  async-progress contract. No behaviour change.

### Fixed

- **Workspace delete now cascades `mcpServers`, `principals`, and
  `policyAudit`.** These three child collections were previously left behind
  when a workspace was deleted; they are now removed on every backend (memory,
  file, SQLite, Astra). Policy-audit rows are **purged** rather than retained —
  they become unreadable once their workspace is gone, so keeping them would
  only strand inaccessible rows.
- **Reliability hardening.** `/readyz` is now bounded by a deadline so a slow
  dependency can't hang the readiness probe; chat requests carry a request
  timeout; and the web app guards against a malformed JSON response instead of
  throwing.
- **Bounded prompt-history read in agent dispatch.** Assembling a prompt no
  longer reads unbounded conversation history, so long, tool-heavy
  conversations stop re-scanning the full transcript on every turn.

### Security

- **Gated the rescue/setup mutation routes.** The setup/rescue surface's
  mutating routes now sit behind the setup auth-gate, and the bootstrap-token
  comparison is constant-time (timing-safe), removing a token-guessing side
  channel.
- **Secret redaction in structured logs.** The logger now redacts secret- and
  token-shaped values so credentials don't leak into structured log output.
- **Hardened the release workflow's supply chain.** Every GitHub Action in
  `release.yml` — the workflow that publishes the runtime image to GHCR and
  cuts the GitHub Release — is now pinned to a full commit SHA, and each job
  declares least-privilege `permissions:` so the build/test jobs no longer
  inherit `packages: write` / `id-token: write`.

## [0.4.2] — 2026-05-30

Hardening continues on the 0.4.x line, with one new capability:
**store-level keyset pagination for the chat surface**. The wire shape is
unchanged (`{ items, nextCursor }`) and there is **no data migration** —
this release changes how a conversation's history is read, tightens a
fetch-tool SSRF boundary, and makes shutdown cleaner.

### Added

- **Keyset pagination for chat history.** An agent's conversations
  (`GET .../conversations`) and a conversation's messages
  (`GET .../conversations/{c}/messages`) now page with an opaque **keyset**
  cursor instead of an offset, pushed down into all four control-plane
  backends (memory, file, SQLite, Astra) so the runtime stops
  materialising the whole conversation on every list call — SQLite uses a
  real `pk`-indexed partition scan. The model's prompt assembly and the
  MCP façade continue to read **full** history; paging never truncates
  what the model sees. The user-visible message listing still filters
  internal tool-call scaffolding, so a page may be shorter than `limit`
  (or empty) with a non-null cursor — drain on the cursor, not on an empty
  page. See [`docs/api-spec.md`](docs/api-spec.md).

### Changed

- **Chat list cursors are now keyset, not offset.** They remain opaque and
  are **not stable across deploys**: a client mid-pagination across an
  upgrade gets `400 invalid_cursor` and restarts from the first page.
  Unlike an offset, a row inserted or deleted *above* the cursor no longer
  shifts the caller's position. The bounded control-plane list surfaces
  (workspaces, services, knowledge bases, API keys, agents, …) keep their
  existing offset cursors.
- **Conservative dependency refresh** across all workspaces (patch/minor
  only); `npm audit` reports **0 known vulnerabilities**.

### Fixed

- **Cleaner graceful shutdown with active job streams.** A long-lived
  `.../jobs/{id}/events` SSE stream no longer holds its connection open
  through the shutdown drain window: on `SIGTERM` the stream ends so the
  client's `EventSource` reconnects (to a surviving replica or after
  restart) and resumes via `Last-Event-ID`, and `server.close()` finishes
  promptly instead of waiting out the timeout.

### Security

- **Closed a DNS-based SSRF hole in the `native:fetch` agent tool.** The
  tool's URL is model-supplied (so reachable via prompt injection) and
  previously range-checked only literal-IP hosts — a DNS *name* that
  resolved to `169.254.169.254`, a `10.x` address, loopback, etc. slipped
  through. It now resolves the host and validates **every** resolved
  address against the same blocked ranges, failing closed (a host that
  won't resolve, resolves to nothing, or resolves to any blocked address
  is refused). `safeFetch`'s `redirect: "error"` still bounds the residual
  sub-second rebind window.

## [0.4.1] — 2026-05-29

Hardening + docs/UX polish on top of 0.4.0. **No API contract changes
and no data migration** — this release simplifies surfaces and fixes a
bug, it doesn't change the wire model. The headlines are a **unified
agent editor** and a deliberately **simpler access-control UI**.

### Added

- **Unified agent editor.** All three agent create/edit surfaces — the
  workspace overview, the dedicated Agents page, and the chat
  zero-state — now share one form and dialog (`AgentFormDialog`, which
  owns the tool-catalog fetch so no surface can omit it). The tool
  picker and every other field are available everywhere. When a
  workspace has no external tools the picker shows an empty-state
  callout linking to MCP settings, and each agent card/row carries an
  "all tools / N tools" scope badge.
- **Published documentation site** at
  <https://datastax.github.io/ai-workbench/> (VitePress → GitHub Pages),
  linked from the README, plus a public
  [`docs/whats-new-0.4.0.md`](docs/whats-new-0.4.0.md) narrative.

### Changed

- **Simplified access control (UI only).** Role-based API keys
  (Viewer / Editor / Admin) are now the single access-control surface in
  the web app. The advanced row-level access-control prototype — raw
  principals, per-row policies, and the "view as" picker — is no longer
  surfaced in the UI. It remains fully available through the HTTP API
  and the `aiw` CLI for advanced operators; no backend or schema change.
- **CLI polish.** `aiw principal` and `aiw policy` are hidden from
  `aiw --help` (still fully functional for scripting); the `--workspace`
  flag description and the "--workspace is required" error are
  consistent across commands; `aiw login --oidc --output json` now emits
  a JSON result envelope for scripting parity.
- **Leaner README** focused on getting an end user running, with the
  dev/contributor detail consolidated into
  [`CONTRIBUTING.md`](CONTRIBUTING.md).
- **Consistent error messaging** in the web UI — workspace, knowledge-
  base, document, and service panels now route load errors through the
  shared `formatApiError` helper.
- Unified `vitest` versions across workspaces and added a `format:check`
  gate to `npm run check`.

### Fixed

- **Agent tool selector missing on the workspace-overview dialogs.**
  Creating or editing an agent from the workspace overview silently hid
  the Tools section because that dialog never fetched the tool catalog;
  the shared dialog now owns the fetch, so tools appear on every
  surface.
- The `aiw` CLI version constant was stale at `0.3.0` (missed in the
  0.4.0 cut); it now reports the correct version.

### Removed

- The web UI's principals panel, policy-audit panel, "view as" picker,
  and per-document visibility editor (the RLAC prototype surfaces). The
  underlying API and CLI commands are unchanged.

## [0.4.0] — 2026-05-28

Headline: **two flagship capabilities — agent tool-calling and
role-based access control (RBAC) — on a security + reliability
hardening pass.** Agents can now call tools mid-conversation in a
bounded multi-step loop; every `/api/v1/*` surface is gated by coarse
roles (viewer / editor / admin) with a new `manage` tier for admin-only
operations. This is a **breaking** release for write-scoped API keys
that performed admin actions — see **Migration**.

### Added

- **Agent tool-calling.** Agents resolve a per-agent allow-list
  (`agent.toolIds`) and call tools in a multi-step loop (cap 6). Tool
  sources: the built-in workspace tools; the workspace's **external MCP
  servers** (a new per-workspace registry + REST CRUD at
  `/api/v1/workspaces/{w}/mcp-servers` + an in-runtime MCP client);
  **native tools** `native:fetch` (SSRF-guarded, with a timeout,
  response-size cap, and content-type allow-list) and
  `native:web_search` (pluggable, off until configured); and a
  read-only `astra:data_api` tool. Empty `toolIds` grandfathers in all
  built-in tools; external / native / Astra tools are opt-in. Every tool
  call is bounded by a timeout + output cap and recorded as a
  `tool.invoke` audit event (arguments omitted). Code execution is a
  documented non-goal this release.
- **Tool-calling UI.** Inline expandable tool-call / result cards in the
  chat transcript, a source-grouped tool picker in the agent form, a
  `GET /available-tools` catalog endpoint, and an MCP-servers settings
  panel.
- **RBAC.** Coarse roles `viewer | editor | admin` map to the privilege
  scopes `read | write | manage`. A new **`manage`** scope gates
  admin-only surfaces (API keys, RLAC principals + policy, workspace
  delete). Roles unify with RLAC principals (a principal carries a
  `role`); OIDC subjects map to a role via the opt-in
  `auth.oidc.roleMapping` (group/claim → role, with a `viewer` floor).
  API keys are issued with explicit scopes / a role, enforced across
  HTTP routes, MCP tools, the `aiw` CLI, and the web UI (`useRole`
  gating). A self-maintaining route-inventory guard proves every
  mutating route is gated.
- **SQLite control-plane driver.** A `driver: "sqlite"` control-plane +
  job-store backend for durable single-node deployments — row-level WAL
  writes instead of the `file` backend's whole-file rewrite.
- **Job durability for all kinds.** The async-resume path (previously
  ingest-only) is generalized: a kind-tagged `inputSnapshot` + a
  `JobKind → resume` registry let the orphan sweeper replay any
  registered job kind idempotently.
- **Streaming robustness.** A shared SSE helper guarantees exactly one
  terminal event; the job-events stream supports `Last-Event-ID`
  resume; a client disconnect aborts the in-flight LLM call; a dropped
  stream still persists a terminal assistant row.
- **MCP write tools** — `create_knowledge_base`, `delete_knowledge_base`,
  and `run_agent` join the MCP façade (KB writes require `write`).
- **OIDC device-flow login** — `aiw login --oidc` (RFC 8628) with
  runtime proxy endpoints; the IdP client secret stays server-side.
- **In-app "What's new" modal**, auto-opening once per `APP_VERSION`,
  plus discoverability tooltips on commonly-missed operator actions.
- **Chat-surface conformance** scenarios (CRUD + a deterministic SSE
  tool-call happy path), closing the last gap in the cross-runtime
  contract.
- **Secret rotation guide** (`docs/auth.md`), an expanded secret
  scanner, and a wire-leak test asserting no resolved secret crosses the
  API boundary.

### Changed

- **`manage` scope split out of `write` (breaking).** Admin-only
  operations — API-key issuance / revocation, RLAC principal + policy
  management, and workspace deletion — now require the `manage` scope
  (an `admin` role) instead of `write`. See **Migration**.
- **RLAC audit-log contract is stable.** `PolicyAuditRecord`,
  `PolicyAction`, and `PolicyDecision` are committed as a stable public
  contract (`PolicyAuditRecordV1`) for SIEM ingestion; additive changes
  stay non-breaking.
- **`aiw` CLI parses the real wire shapes** (`{ items, nextCursor }`,
  resource-specific ids, bare-array `/search`), gains `--top-k` /
  `--hybrid` / `--rerank`, and translates auth mismatches + 401s into
  actionable guidance.
- Job records carry a generalized `inputSnapshot` (back-compat reads of
  the legacy ingest snapshot).
- Conservative dependency refresh across all workspaces; **0** known
  vulnerabilities.

### Removed

- The dead Stage-2 MCP-*tool* scaffold (`McpToolRow` / `MCP_TOOLS_*` /
  the unmounted `toWireMcpTool` serde), superseded by the MCP-*server*
  registry above.

### Migration

- **Write-scoped API keys lose admin access.** A key minted before
  0.4.0 carries `["read", "write"]` (an `editor`). It can no longer
  issue / revoke API keys, manage RLAC principals or policy, or delete a
  workspace — those now return `403 forbidden` (missing scope `manage`).
  Re-mint an **admin** key (`["read", "write", "manage"]`) for those
  operations. OIDC and bootstrap subjects are unaffected (unscoped);
  set `auth.oidc.roleMapping` to assign OIDC users a role.
- **Agent tools beyond the built-ins are opt-in.** Existing agents
  (empty `toolIds`) keep every built-in workspace tool. To grant an
  external-MCP / native / Astra tool, add its id to the agent's
  `toolIds`.
- **No data migration required.** Legacy job snapshots, principal rows
  (defaulting to `viewer`), and API-key scopes all back-compat on read.

Tests: **1,686** runtime + **462** web + **198** CLI passing on a green
typecheck, lint, and cross-runtime conformance across all packages.

## [0.3.0] — 2026-05-28

Headline: **HuggingFace is retired; chat and embeddings are unified on
the OpenAI-compatible wire protocol.** One adapter now serves three
providers — **OpenRouter** (hosted default, one key → 300+ models with
standardized function calling), **OpenAI** (direct/BYOK), and
**Ollama** (local, no credential, for air-gapped installs). This is a
**breaking** release for anyone with a stored `provider: "huggingface"`
LLM service or a `HUGGINGFACE_API_KEY`-based config — see **Migration**
below.

### Changed

- **Provider strategy: OpenRouter + Ollama, not HuggingFace.** The
  runtime's chat path was wired specifically to HF (an HF-only adapter,
  HF-only routability probe, HF-only model picker). 0.2.1's release
  notes were largely HF firefighting — symptoms of HF Inference
  Providers being an awkward fit (models silently become unroutable,
  uneven function-calling support). All three wired providers are now
  OpenAI-compatible and dispatched through a single
  [`OpenAIChatService`](./runtimes/typescript/src/chat/openai.ts) +
  [provider registry](./runtimes/typescript/src/chat/providers.ts): a
  provider is just a base URL + an optional credential + a label.
- **Default chat model + credential.** `chat.model` defaults to
  `openai/gpt-4o-mini` (an OpenRouter slug, was `openai/gpt-oss-20b`);
  `chat.tokenRef` defaults to `env:OPENROUTER_API_KEY` (was
  `env:HUGGINGFACE_API_KEY`); a new `chat.provider`
  (`openrouter`|`openai`|`ollama`, default `openrouter`) and nullable
  `chat.baseUrl` are added
  ([`config/schema.ts`](./runtimes/typescript/src/config/schema.ts)).
- **Seed + managed-env allow-list.** The auto-seeded default LLM
  service now targets OpenRouter
  ([`control-plane/default-services.ts`](./runtimes/typescript/src/control-plane/default-services.ts));
  the `/setup/env` allow-list swaps `HUGGINGFACE_API_KEY` for
  `OPENROUTER_API_KEY` + `OPENAI_API_KEY`
  ([`setup/managed-env.ts`](./runtimes/typescript/src/setup/managed-env.ts)).
- **ZDR-only by default.** OpenRouter requests carry
  `provider.data_collection: "deny"` so prompts route only to
  zero-data-retention upstreams; operators opt out with a single
  global flag. Prompt logging is never enabled by default.

### Added

- **Live model catalog.** New `GET /api/v1/llm-models`
  ([route](./runtimes/typescript/src/routes/api-v1/llm-models.ts) +
  [catalog](./runtimes/typescript/src/chat/model-catalog.ts)) proxies
  OpenRouter `/models` (filtered to tool-calling-capable models, a
  curated "recommended" subset surfaced first) or a local Ollama
  server's `/models`, with a curated static fallback so the picker is
  never empty offline. The
  [`LlmServiceForm`](./apps/web/src/components/agents/LlmServiceForm.tsx)
  picker is now driven live from this endpoint. The endpoint is not
  workspace-auth-scoped, so its `baseUrl` query param is validated
  through the same SSRF guard (`EndpointBaseUrlSchema`) as service
  endpoints.
- **Ollama + OpenRouter embeddings.** When Astra `$vectorize` isn't
  configured, embeddings run through the same OpenAI-compatible client
  for `openrouter`/`ollama`/`openai`/`cohere`
  ([`embeddings/langchain.ts`](./runtimes/typescript/src/embeddings/langchain.ts));
  Ollama needs no credential. Each embedding service declares its
  model's native vector dimension (the Ollama seed pins
  `nomic-embed-text` → 768, which can't be truncated); when a returned
  vector doesn't match the declared `embeddingDimension`, the embed
  call now fails with an actionable error naming the exact size to set
  (and to create the KB collection at), instead of a generic mismatch.
- **Settings: per-field "Configured" indicators.** `/settings` now
  shows a green ✓ Configured marker next to each credential that
  already resolves in the runtime environment, backed by a new
  `managedEnv.configuredKeys` field on `GET /setup-status` (the value
  itself never crosses the wire); configured secret fields hint that a
  blank input keeps the current value
  ([`SettingsPage.tsx`](./apps/web/src/pages/SettingsPage.tsx)).
- **Agent cards show their bound LLM model.** The workspace overview's
  agent cards render a `model …` chip — mirroring the KB cards'
  embedding chip — resolving the agent's `llmServiceId` to its model
  id, or `default` when it inherits the workspace chat default
  ([`WorkspaceDetailPage.tsx`](./apps/web/src/pages/WorkspaceDetailPage.tsx)).
- **Browser tab title** now reads `AI Workbench | IBM`.

### Removed

- **HuggingFace chat adapter and SDK.** Deleted
  `runtimes/typescript/src/chat/huggingface.ts` and removed the
  `@huggingface/inference` dependency. The HF-specific
  routability/chat-model probe is replaced by an OpenRouter-aware check
  (a model is valid when it appears in `/models` with `tools` in
  `supported_parameters`); Ollama models are accepted without probing.

### Migration

- **Stored `provider: "huggingface"` LLM services now fail closed.**
  An agent bound to such a service raises `422
  llm_provider_unsupported` at send time (not a 500) with an
  actionable message; recreate the service against `openrouter`,
  `openai`, or `ollama`. Regression-locked in
  [`tests/chat/agent-resolution.test.ts`](./runtimes/typescript/tests/chat/agent-resolution.test.ts).
- **Swap the env var.** Replace `HUGGINGFACE_API_KEY` with
  `OPENROUTER_API_KEY` (or set `OPENAI_API_KEY` for direct BYOK, or
  point `chat.provider: ollama` at a local server for offline use).
  Paste the new key at `/settings` and the runtime restarts and
  reconnects.

Tests: **1,403** runtime + **434** web passing on a green typecheck and
lint across both packages. Docs (configuration, api-spec, agents,
docker, telemetry, roadmap, codemaps) updated to describe the new
provider model.

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

- **HuggingFace agents can actually call tools.** The HF chat adapter
  ([`src/chat/huggingface.ts`](./runtimes/typescript/src/chat/huggingface.ts))
  used to ignore the agent's advertised `tools[]` and never parse
  `tool_calls`, so a tool-using agent (e.g. Bobby) on an HF-backed
  model — whose persona prompt names `list_kbs`, `search_kb`,
  `count_documents`, … — emitted its intended calls as a plain-text
  code block that the dispatcher couldn't execute, then returned that
  text as the answer. The adapter now forwards the OpenAI-compatible
  `tools[]` + `tool_choice` and parses the model's structured
  `tool_calls` (both `complete` and streaming), threading assistant
  tool-call turns and `role: "tool"` results back through the prompt —
  so the dispatcher's list-KBs → search → answer loop works the same
  way it does on the OpenAI adapter. The default `openai/gpt-oss-20b`
  is served for tools; the auto-seeded service now advertises
  `supportsTools: true`. New unit coverage
  ([`tests/chat/huggingface.test.ts`](./runtimes/typescript/tests/chat/huggingface.test.ts)).
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

[Unreleased]: https://github.com/datastax/ai-workbench/compare/v0.5.1...HEAD
[0.5.1]: https://github.com/datastax/ai-workbench/compare/v0.5.0...v0.5.1
[0.5.0]: https://github.com/datastax/ai-workbench/compare/v0.4.3...v0.5.0
[0.3.0]: https://github.com/datastax/ai-workbench/compare/v0.2.1...v0.3.0
[0.2.1]: https://github.com/datastax/ai-workbench/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/datastax/ai-workbench/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/datastax/ai-workbench/releases/tag/v0.1.0
