# What's new in 0.1.0

> **0.1.0 is AI Workbench's first named release.** It marks the point
> where we switch from "unversioned monorepo" to semver-tracked
> releases with a published CHANGELOG and an automated release
> workflow. Internal beta — interfaces may still change between
> minor versions until 1.0.

For the formal entry, see [`CHANGELOG.md`](../CHANGELOG.md). The
sections below give the narrative behind the headline changes.

## `aiw` — a command-line interface

The biggest new surface in 0.1.0 is the
[`@ai-workbench/cli`](../packages/aiw-cli/README.md) package, which
publishes the `aiw` binary. It talks to a running runtime over the
same HTTP API as the web UI:

```bash
npm install -g @ai-workbench/cli

aiw login --url http://localhost:8080 --profile dev
aiw whoami
aiw workspace list
aiw doc upload ./notes.pdf --workspace ws_123 --kb kb_456
aiw search "vector indexing" --workspace ws_123 --kb kb_456
```

Profiles live in `~/.aiw/config.json` (mode `0600`) so you can keep
credentials for multiple runtimes side-by-side. `--profile` and
`--url` flags override the active profile per call. Output defaults to
a compact human table and switches to `--output json` for pipelines.

Auth is API-key only in this release — generate a key in the web UI
under **Workspace settings → API keys**, then paste it into
`aiw login`. OIDC device-flow login is on the roadmap for 0.2.

## MCP write surface — `list_agents` + `get_agent`

The Model Context Protocol facade at
`/api/v1/workspaces/{workspaceId}/mcp` now exposes:

- `list_agents` — enumerate the workspace's agents (ids, names, KB
  bindings, LLM service ids).
- `get_agent` — return one agent's full configuration (system prompt,
  user prompt, tool ids, reranking overrides).

Both are read-only and bind to the existing workspace-scope gate,
so any authenticated MCP caller can discover and inspect agents.
`create_knowledge_base` / `delete_knowledge_base` / `run_agent` write
tools are tracked for 0.2 — they need the knowledge-base + chat
services threaded into the MCP deps, which is a separate refactor.

## RLAC on Documents — Preview

Row-level access control on Documents shipped in
[#237](https://github.com/datastax/ai-workbench/pull/237). 0.1.0
keeps it explicitly labeled **Preview** in the workspace settings
card and the docs; the API and audit-log shapes may change before
0.2.

See [`docs/rlac-preview.md`](./rlac-preview.md) for the model, how to
enable it per workspace, the View-as picker workflow, and the audit
panel walkthrough.

## Web UI polish

- **Skeleton loaders.** `SkeletonCard` and `SkeletonRow` replace the
  centered spinner on list pages so the layout doesn't jump when data
  arrives.
- **a11y on shared state components.** `LoadingState`, `ErrorState`,
  and the skeletons emit the right `role` / `aria-live` / `aria-busy`
  attributes; decorative icons are hidden from assistive tech.
- **Beta · v0.1.0 chip.** Header now shows release status so internal
  users know what they're looking at.

## Polyglot runtimes — re-framed

- TypeScript is the **supported runtime** for 0.1.0 and powers the
  bundled Docker image.
- Python and Java runtimes are explicitly labeled
  **Experimental contrib**. They remain valuable as contract-conformance
  targets (the harness in `conformance/` works against all three) but
  carry no stability promise.

The READMEs in `runtimes/python/` and `runtimes/java/` lead with a
status block so contributors land on the right framing.

## What we deferred

The 0.1.0 PR intentionally kept a few things out of scope so the
release can land:

- **OIDC device-flow login** for the CLI (API key only today).
- **MCP write expansion** beyond agent reads (`create_knowledge_base`,
  `delete_knowledge_base`, `run_agent`).
- **RLAC GA** — staying Preview through 0.1.x.
- **Full guided onboarding tour** in the web UI.
- **Visual regression tests** (Percy / Chromatic).

All of these are reasonable 0.2.0 candidates. File issues against
`v0.2.0` if you want one prioritized.

## How 0.1.x and beyond will work

Starting with 0.1.0:

- Every user-facing change ships with a
  [Changesets](https://github.com/changesets/changesets) markdown
  file declaring the bump (patch / minor / major).
- The `CHANGELOG.md` follows the
  [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) format;
  commits follow Conventional Commits.
- Tagging `v<major>.<minor>.<patch>` on `main` triggers
  `.github/workflows/release.yml`, which builds + publishes the npm
  package, pushes the Docker image to GHCR, and attaches single-binary
  CLI builds to the GitHub Release.

See [`CONTRIBUTING.md`](../CONTRIBUTING.md) for the changeset workflow
and the branch/tag policy.
