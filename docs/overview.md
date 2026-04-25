# Product overview

AI Workbench is a self-hosted control center for building and operating
retrieval-backed AI applications on DataStax Astra. It gives teams one
place to connect workspaces, organize source material, create vector
stores, ingest documents, test search behavior, and keep the same
workflow portable across runtime implementations.

The goal is not to make operators think about runtimes first. The goal
is to help a team get from "we have documents and embeddings" to "we can
trust, inspect, and iterate on this knowledge workflow" without gluing
together a one-off admin app for every project.

## What you can do with it

- **Create workspaces** for each project, tenant, or environment you want
  to manage.
- **Connect Astra-backed stores** while keeping credentials outside
  records and config.
- **Model catalogs** around the content domains your application queries.
- **Ingest documents** through sync or async flows with job status and
  server-sent progress updates.
- **Test retrieval quality** in the browser with text, vector, hybrid,
  and rerank search paths.
- **Save repeatable queries** so useful checks do not live only in a
  developer's scratch file.
- **Run the same HTTP contract** from the default TypeScript runtime or
  another language-native runtime as the project evolves.

## Why teams use it

Most retrieval projects start with a script and a vector database. That
works until the team needs shared environments, safer credentials,
repeatable ingest, observable jobs, an API contract, and a browser
surface for people who are not living inside the implementation.

AI Workbench packages those product workflows into one deployable
runtime and UI:

| Need | Workbench surface |
|---|---|
| Bring up a retrieval environment quickly | One Docker image with the UI and default runtime |
| Keep project data isolated | Workspace-scoped catalogs, vector stores, documents, jobs, and API keys |
| Avoid storing secrets in records | `SecretRef` pointers such as `env:OPENAI_API_KEY` and `file:/path` |
| Inspect search behavior | Playground for text, vector, hybrid, and rerank queries |
| Move from demo to production | Memory, file, and Astra-backed control-plane stores |
| Keep runtimes aligned | Shared `/api/v1/*` contract and conformance fixtures |

## Product shape

AI Workbench has three connected surfaces:

1. **Workspace management.** Create and configure the spaces that own
   catalogs, vector stores, documents, saved queries, jobs, and API keys.
2. **Knowledge operations.** Ingest content, track status, bind catalogs
   to vector stores, and keep the operational state visible.
3. **Retrieval playground.** Try real searches against real workspace
   data before wiring the same API into an application.

The technical architecture exists to keep those surfaces deployable,
portable, and testable. If you want the implementation model, start with
[Architecture](architecture.md). If you want to run the product locally,
continue with the quickstart below.

## Quickstart

```bash
npm ci && npm run install:ts
npm run dev
```

Then open the bundled UI at `http://localhost:8080`, create a workspace,
add a vector store, ingest content from the workspace detail page, and
use the playground to inspect the results.

The generated API reference is available from the running runtime at
`http://localhost:8080/docs`, and the machine-readable contract is
served at `http://localhost:8080/api/v1/openapi.json`.

## Where to go next

- [Playground](playground.md) explains the browser path for evaluating
  search behavior.
- [Workspaces](workspaces.md) describes the product model and scoping
  rules.
- [Configuration](configuration.md) shows how to move from an in-memory
  demo to file-backed or Astra-backed state.
- [Architecture](architecture.md) explains the runtime design when you
  want to go deeper.
