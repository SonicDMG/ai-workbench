---
"@ai-workbench/cli": patch
---

Fix `aiw workspace list`, `aiw kb list`, `aiw agent list`, `aiw doc upload`, `aiw search`, and `aiw job status` so they actually parse the runtime's responses. The 0.1.0 CLI assumed `{ data: [...] }` envelopes and a generic `id` field on every record; the runtime's real wire shapes are `{ items: [...], nextCursor }` with resource-specific ids (`workspaceId`, `knowledgeBaseId`, `agentId`, `documentId`, `jobId`) and a bare-array response for `POST /search`. Schemas in `packages/aiw-cli/src/types.ts` now match `runtimes/typescript/src/lib/pagination.ts` and `runtimes/typescript/src/openapi/schemas.ts`. `aiw search` also switched from `--limit` to `--top-k` and added `--hybrid` / `--rerank` flags to match the `SearchRequestSchema`. `aiw doc upload` handles both the sync `{ document, chunks }` and async `{ job }` outcomes.
