# Changelog

All notable changes to AI Workbench are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html)
starting at `0.1.0`. Pre-`1.0`, breaking changes can land in a minor
release — they will be called out under **Changed** below.

## [Unreleased]

### Added

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

[Unreleased]: https://github.com/datastax/ai-workbench/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/datastax/ai-workbench/releases/tag/v0.1.0
