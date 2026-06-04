# AI Workbench

[![Status: Beta · v0.5.3](https://img.shields.io/badge/status-Beta%20%C2%B7%20v0.5.3-9d688f)](./CHANGELOG.md)
[![CI](https://img.shields.io/github/actions/workflow/status/datastax/ai-workbench/ci.yml?branch=main&label=CI)](https://github.com/datastax/ai-workbench/actions/workflows/ci.yml)
[![Runtimes](https://img.shields.io/github/actions/workflow/status/datastax/ai-workbench/runtimes.yml?branch=main&label=Runtimes)](https://github.com/datastax/ai-workbench/actions/workflows/runtimes.yml)
[![Secret scan](https://img.shields.io/github/actions/workflow/status/datastax/ai-workbench/secret-scan.yml?branch=main&label=Secret%20scan)](https://github.com/datastax/ai-workbench/actions/workflows/secret-scan.yml)
[![Node 22+](https://img.shields.io/badge/node-%3E=22-blue)](./.nvmrc)
[![License: MIT](https://img.shields.io/badge/license-MIT-green)](./LICENSE)

AI Workbench is a self-hosted app for building and operating
retrieval-backed AI applications on DataStax Astra. Create workspaces,
organize knowledge bases, configure agents that chat and call tools,
issue scoped API keys, and try Astra Data API commands — all from one
browser app, with a matching HTTP API and CLI.

> **AI Workbench 0.5 is a public beta.** APIs, schemas, and UI surfaces
> may still change between minor versions until 1.0. See
> [`CHANGELOG.md`](./CHANGELOG.md) for what's in this release,
> [`docs/whats-new-0.5.3.md`](./docs/whats-new-0.5.3.md) for the
> latest highlights, and
> [`docs/whats-new-0.5.0.md`](./docs/whats-new-0.5.0.md) for the
> narrative tour.

![AI Workbench workspace overview](docs/assets/workbench-workspace.png)

## What you can do

- **Create workspaces** backed by Astra DB or a local in-memory mock.
- **Build knowledge bases** that own their collections, ingest files,
  and bind to chunking, embedding, and reranking services.
- **Configure agents** with a persona, retrieval defaults, an LLM
  binding, and a per-agent tool allow-list — then chat against your
  workspace's knowledge.
- **Give agents tools** — built-in retrieval tools, native web
  fetch/search, the Astra Data API, and your own external MCP servers.
- **Control access with API keys** scoped to a role — Viewer
  (read-only), Editor (read + write), or Admin (full control).
- **Explore the Data API** in the Playground, then copy the equivalent
  TypeScript, Python, Java, or cURL.

## Quickstart

The shortest path to a running AI Workbench needs only Docker — no Node
install:

```bash
curl -O https://raw.githubusercontent.com/datastax/ai-workbench/main/docker-compose.yml
docker compose up
```

Open [http://localhost:8080](http://localhost:8080). Data persists in a
named Docker volume across `docker compose down` / `up`; reset it with
`docker compose down -v`.

To connect Astra DB or enable chat (OpenRouter), drop a `.env` file next
to `docker-compose.yml` — start from [`.env.example`](./.env.example).
The full Docker guide (overrides, backups, troubleshooting) is in
[`docs/docker.md`](docs/docker.md).

> **Prefer source?** With Node.js 22+, `npm run setup && npm start`
> builds the UI and starts the runtime on `:8080`. The hot-reload dev
> loop and other contributor setup live in
> [`CONTRIBUTING.md`](./CONTRIBUTING.md).

## First tour

1. **Create or select a workspace.** Astra workspaces can use explicit
   endpoint/token references or values discovered from the `astra` CLI.
2. **Add a knowledge base.** Bind it to the workspace's chunking and
   embedding services, then ingest files from the knowledge-base page.
3. **Create an agent.** Start from a template or build your own —
   give it a persona, knowledge bases, and the tools it may call —
   then chat against the workspace's knowledge.
4. **Open the Playground.** For Astra workspaces, pick `Collection` or
   `Table`, choose a command, edit the request JSON, run it, and copy
   client code.
5. **Tune settings.** Services, LLM providers, credentials, and API
   keys live in workspace settings so the main page stays focused.

![AI Workbench Playground](docs/assets/workbench-playground.png)

## Configuration

At startup the runtime chooses a control-plane backend automatically:
Astra Data API tables when Astra credentials are available (including
values discovered from `astra` CLI profiles), local file storage
otherwise, or in-memory storage for tests and throwaway demos.

See [`docs/configuration.md`](docs/configuration.md) for the full
`workbench.yaml` reference, [`docs/astra-cli.md`](docs/astra-cli.md) for
CLI discovery, and [`docs/production.md`](docs/production.md) before
exposing a runtime beyond localhost.

## Documentation

Full docs are published at
**[datastax.github.io/ai-workbench](https://datastax.github.io/ai-workbench/)**.
Start here:

| Document | Read when you need… |
|---|---|
| [`docs/overview.md`](docs/overview.md) | A product-level walkthrough. |
| [`docs/workspaces.md`](docs/workspaces.md) | Workspace semantics, scoping, and cascade behavior. |
| [`docs/agents.md`](docs/agents.md) | Agent personas, tools, RAG defaults, and chat. |
| [`docs/playground.md`](docs/playground.md) | Playground workflow and UX notes. |
| [`docs/mcp.md`](docs/mcp.md) | The MCP facade for external agents. |
| [`docs/auth.md`](docs/auth.md) | API keys, roles, OIDC, and sessions. |
| [`docs/configuration.md`](docs/configuration.md) | `workbench.yaml` configuration details. |
| [`docs/api-spec.md`](docs/api-spec.md) | The HTTP API contract narrative. |
| [`packages/aiw-cli/README.md`](packages/aiw-cli/README.md) | The `aiw` command-line interface. |

A running app also serves an interactive API reference at
[`/docs`](http://localhost:8080/docs), with the machine-readable OpenAPI
document at `/api/v1/openapi.json`.

The runtime ships in TypeScript (the production path); Python and Java
are preview scaffolds. See [`runtimes/README.md`](runtimes/README.md)
for the runtime status table and [`docs/architecture.md`](docs/architecture.md)
for the full system model.

## Contributing

Setup, the dev loop, PR expectations, and contract-change rules live in
[`CONTRIBUTING.md`](./CONTRIBUTING.md). Security issues use the private
channel in [`SECURITY.md`](./SECURITY.md).

## License

MIT. See [`LICENSE`](./LICENSE).
