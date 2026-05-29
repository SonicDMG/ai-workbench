# What's new in 0.4

> **0.4 is the agents-and-access release.** Two flagship capabilities
> landed on a security + reliability hardening pass: agents can now call
> **tools** mid-conversation, and every API surface is gated by
> **role-based access control**. 0.4.1 follows with a hardening +
> docs/UX polish pass (see [Refined in 0.4.1](#refined-in-041)).

For the formal entries, see [`CHANGELOG.md`](../CHANGELOG.md). The
sections below give the narrative behind the headline changes.

## Agent tool-calling

Agents are no longer chat-only. Each agent resolves a per-agent
**tool allow-list** and calls tools in a bounded multi-step loop (cap
6 steps) during a conversation. Tools come from four sources:

- **Built-in workspace tools** — retrieval over the agent's knowledge
  bases (`search_kb`, `list_documents`, …). Always available.
- **External MCP servers** — register a remote
  [Model Context Protocol](mcp.md) server per workspace and its tools
  appear to agents as `mcp:{server}:{tool}`. An in-runtime MCP client
  discovers each enabled server's tools at chat time.
- **Native tools** — `native:fetch` (SSRF-guarded, with a timeout,
  response-size cap, and content-type allow-list) and
  `native:web_search` (pluggable, off until configured).
- **Astra Data API** — a read-only `astra:data_api` tool.

An empty allow-list grandfathers in all built-in tools (the default);
native, Astra, and external-MCP tools are always opt-in. Every tool
call is bounded by a timeout + output cap and recorded as a
`tool.invoke` audit event (arguments omitted). Code execution is a
documented non-goal for this release.

In the UI, the chat transcript shows inline expandable tool-call /
result cards, and the agent form has a source-grouped tool picker
backed by a `GET .../available-tools` catalog endpoint.

## Role-based access control

Access is now gated by three coarse roles that map to privilege
scopes:

| Role | Scopes | Can… |
|---|---|---|
| **Viewer** | `read` | Retrieve and search workspace content. |
| **Editor** | `read`, `write` | …plus ingest and create/update KBs, agents, and services. |
| **Admin** | `read`, `write`, `manage` | …plus mint/revoke API keys and delete the workspace. |

You issue an API key with a role from **Workspace settings → API keys**;
the role expands into the scopes sent to the server. Enforcement is
uniform across the HTTP routes, the MCP tools, the `aiw` CLI, and the
web UI, and a self-maintaining route-inventory guard proves every
mutating route is gated.

> **Migration (breaking).** The new `manage` scope was split out of
> `write`. A pre-0.4.0 read+write key can no longer perform admin
> actions (issuing keys, deleting a workspace) — re-mint an **Admin**
> key for those. See the [`CHANGELOG`](../CHANGELOG.md) migration note.

## OIDC device-flow login

`aiw login --oidc` brings [RFC 8628](https://www.rfc-editor.org/rfc/rfc8628)
device-flow login to the CLI. Runtime proxy endpoints keep the IdP
client secret server-side, so you authenticate in the browser and the
CLI never sees the secret. See [`docs/auth.md`](auth.md).

## SQLite control-plane driver

A `driver: "sqlite"` control-plane + job-store backend joins the `file`
and `astra` options for durable single-node deployments — row-level WAL
writes instead of the `file` backend's whole-file rewrite. See
[`docs/configuration.md`](configuration.md).

## Reliability: durable jobs + robust streaming

- **Job durability for all kinds.** The async-resume path (previously
  ingest-only) is generalized: a kind-tagged `inputSnapshot` plus a
  `JobKind → resume` registry let the orphan sweeper replay any
  registered job kind idempotently after a crash.
- **Streaming robustness.** A shared SSE helper guarantees exactly one
  terminal event; the job-events stream supports `Last-Event-ID`
  resume; a client disconnect aborts the in-flight LLM call; and a
  dropped stream still persists a terminal assistant row.

## Refined in 0.4.1

0.4.1 is a hardening + polish release. The two user-facing refinements:

- **Unified agent editor.** Creating or editing an agent now uses the
  same full form everywhere — the workspace overview, the dedicated
  Agents page, and the chat zero-state. Previously the tool picker
  only appeared on one of those screens; now tools (and every other
  field) are always available, with an empty-state nudge to register
  MCP servers when a workspace has no external tools yet, and an
  "all tools / N tools" badge on each agent card.
- **Simpler access control.** The workspace settings page now centers
  on role-based API keys. The advanced row-level access-control
  prototype (raw principals, per-row policies, and the "view as"
  picker) is no longer surfaced in the app — it remains available
  through the HTTP API and the `aiw` CLI for advanced operators.

Plus a leaner README, a published docs site, CLI help/output polish,
and the usual round of UI and dependency cleanup.

## What we deferred

- **Row-level access control in the UI.** Kept API/CLI-only while the
  model stabilizes.
- **Python / Java runtime parity.** Still preview scaffolds; the
  TypeScript runtime remains the only production ship path.
- **`native:web_search` providers.** The hook is in place; wiring a
  default provider is future work.

## How releases work

Every user-facing change ships with a
[Changesets](https://github.com/changesets/changesets) file, the
[`CHANGELOG.md`](../CHANGELOG.md) follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and tagging
`v<major>.<minor>.<patch>` on `main` triggers the release workflow. See
[`CONTRIBUTING.md`](../CONTRIBUTING.md) for the full process.
