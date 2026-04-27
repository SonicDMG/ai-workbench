# Schema notes — Knowledge-Base refactor (issue #98)

The Python runtime is a stub. The canonical schema and types live in
the TypeScript runtime under
`runtimes/typescript/src/astra-client/table-definitions.ts` and
`runtimes/typescript/src/control-plane/types.ts`.

When this runtime is implemented, mirror the TypeScript shapes exactly
— same table names, same columns, same partition keys, same camelCase
JSON on the wire. The TypeScript file is the source of truth.

## What changed (vs. the legacy `wb_workspaces` / `wb_catalog_*` set)

Three new layers, all `snake_case` table names:

- **`wb_config_*`** — workspaces, knowledge bases, and the four
  reusable execution services (chunking, embedding, reranking, LLM)
  and the MCP tool registry.
- **`wb_rag_*`** — documents indexed three ways: by KB, by
  KB+status, by content hash. Replaces `wb_documents_by_catalog`.
- **`wb_agentic_*`** — agents, conversations, messages (Stage 2).

Decisions worth carrying over when the routes are implemented here:

1. **`wb_config_workspaces`** replaces `wb_workspaces`. Renames:
   `endpoint → url`, `keyspace → namespace`, `credentials_ref → credentials`.
2. **Knowledge Base** replaces "catalog". The KB row binds an
   embedding service, a chunking service, and an optional reranking
   service by id. The vector collection is auto-provisioned on KB
   create using the embedding service's `embedding_dimension` +
   `distance_metric`; the resulting collection name is stored in
   `vector_collection`.
3. **Embedding service id is immutable** after KB create — vectors
   on disk are bound to the model that produced them. Return 409 on
   any PATCH that would change it.
4. **Lexical config lives on the KB row**, not in a separate service
   table. Lexical/BM25 is a property of the underlying collection,
   not a network-callable service.
5. **Reranking precedence**: an agent's `reranking_service_id`
   overrides the KB's. The KB value is the default for non-agentic
   search.
6. **Conversations are clustered `created_at DESC`** so list endpoints
   return newest-first without server-side sort.
7. **Conversation lookup goes through agent_id** in URL paths
   (`/agents/{id}/conversations/{cid}`) — there is no
   conversation→agent reverse index.
8. **`saved_queries` is dropped.** Don't carry it over.
9. **`wb_api_key_*` tables are unchanged** and remain orthogonal to
   the data model.
