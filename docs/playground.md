# Playground

The playground is a browser scratchpad for running ad-hoc vector
and text queries against a workspace's knowledge bases. It's the
"aha moment" path for the product — after onboarding a workspace,
registering a chunking + embedding service, creating a knowledge
base that binds them, and ingesting some content, open
[`/playground`](../apps/web/README.md) to see what the KB
actually returns.

No persistence. Nothing is saved between queries. If you want a
repeatable run, script it against the same HTTP API the UI uses.

## UI flow

1. Pick a workspace.
2. Pick one of its knowledge bases. The form unlocks.
3. **Text tab** — type a query. The runtime embeds it (see
   [Dispatch](#dispatch) below) and runs an ANN search. Useful
   when the KB's bound embedding service points at a provider the
   runtime can reach (OpenAI today).
4. **Vector tab** — paste a raw vector. The runtime sends it
   straight through to the driver. Useful for debugging, for
   KBs whose embedding service the runtime can't currently reach,
   or when you want to sanity-check a specific coordinate.
5. **Top-K** (1–25) and an **optional filter** (JSON object,
   shallow-equal over payload) round out the knobs.
6. Hit Run. Results land in a table; each row expands to show the
   full payload.

## Dispatch

`POST /api/v1/workspaces/{w}/knowledge-bases/{kb}/search` accepts
either `{ vector }` or `{ text }` (exactly one). When the request
carries a vector it goes straight to `driver.search()`. Text
queries pick one of two paths:

1. **Server-side embedding** — if the driver has a
   `searchByText()` method and it doesn't throw
   `NotSupportedError`, the driver handles the query itself
   (e.g. Astra's `$vectorize`). Nothing about the vector reaches
   the runtime.
2. **Client-side embedding** — otherwise, the runtime builds an
   `Embedder` from the KB's bound embedding-service config, embeds
   the text locally via LangChain JS (`@langchain/openai`,
   `@langchain/cohere`), then does a normal vector search.

The driver decides whether it can do server-side embedding on a
per-collection basis, so the two paths can coexist within a single
workspace.

### Why the fallback matters

Most Astra collections in the wild today don't have a
`vectorize` service config on them — they were created before
Astra added that feature, or by a tool that didn't know about it.
Client-side embedding lets the playground work against those
collections without any migration.

## Embedder abstraction

The runtime's `Embedder` interface is a thin wrapper over LangChain JS:

```ts
interface Embedder {
  readonly id: string;            // e.g. "openai:text-embedding-3-small"
  readonly dimension: number;     // matched against the KB's declared dim
  embed(text: string): Promise<readonly number[]>;
  embedMany(texts: readonly string[]): Promise<readonly (readonly number[])[]>;
}
```

The factory (`EmbedderFactory.forConfig(config)`) takes an
embedding-service `EmbeddingConfig` (resolved from the KB's
`embeddingServiceId`) and returns an `Embedder`. It resolves
the `secretRef` through the existing `SecretResolver`, then
dispatches on `provider`. Today: OpenAI and Cohere. Adding another
provider (Voyage, Bedrock, …) is one `npm install @langchain/<prov>`
+ one case in [`embeddings/langchain.ts`](../runtimes/typescript/src/embeddings/langchain.ts).

Errors surface as `EmbedderUnavailableError` (`400
embedding_unavailable`) when the config is missing a secret or
names an unsupported provider, and `embedding_dimension_mismatch`
(`400`) when the provider returns a vector whose length doesn't
match the KB's declared dimension.

## Astra vectorize

Astra's Data API can do the embedding itself when a collection is
created with a `vector.service` block. The driver detects this
path from the KB's embedding-service config: when the provider
is one of `openai`, `azureOpenAI`, `cohere`, `jinaAI`, `mistral`,
`nvidia`, `voyageAI` (allowlist in
[`drivers/astra/vectorize.ts`](../runtimes/typescript/src/drivers/astra/vectorize.ts))
**and** a `secretRef` is configured, the driver:

1. At KB-create / `createCollection` time, attaches
   `{ provider, modelName }` to the collection's `vector.service`.
   New KB collections under this runtime get server-side embedding
   by default.
2. At `searchByText` time, resolves the embedding secret, opens
   the collection handle with `embeddingApiKey: <resolved>`, and
   runs `find(sort: { $vectorize: text })`. The runtime never
   sees or transmits the vector — Astra embeds and searches in a
   single round trip.

The secret rides as an `x-embedding-api-key` header per request
(Astra's header-auth path), so operators can keep using the
existing `env:OPENAI_API_KEY` style `secretRef`. If you'd prefer
Astra-KMS shared secrets (by name), set
`authentication.providerKey` directly on your collection — the
driver leaves that path untouched.

**Legacy collections** (created before this landed, or by another
tool, without a `service` block) don't have vectorize. When the
driver's `searchByText` catches Astra's
`COLLECTION_VECTORIZE_NOT_CONFIGURED` family of errors it rethrows
as `NotSupportedError`, which the route layer already treats as
"fall back to client-side embedding" — so playground text queries
continue to work on those collections with zero migration. The
tradeoff: one extra round trip per query on legacy collections
(the failed vectorize attempt) before the fallback kicks in.

Upsert uses the same dispatch:

- `{id, vector, payload}` → `driver.upsert` (unchanged)
- `{id, text, payload}` → `driver.upsertByText` first (Astra
  `$vectorize` on insertMany, mock driver's pseudo-embed when
  the KB opts in). On `NotSupportedError` — unsupported provider
  or legacy collection — the route embeds client-side via
  LangChain JS and retries through plain `upsert`.
- Mixed batches → client-embed the text records, combine with the
  vector records, one transactional `upsert` call. (Splitting
  across `upsertByText` + `upsert` would break transactional
  semantics on the underlying collection.)

## Hybrid + rerank toggles

The query form exposes two optional toggles when the bound knowledge
base has the relevant capabilities enabled (lexical configured on
the KB, reranking service bound):

- **Hybrid** — flips `hybrid: true` on the search request. The
  driver runs a combined vector + lexical lane. On `astra` this
  routes through `findAndRerank` (one call); on `mock` it's
  vector + tokenizer-based lexical with min-max normalization.
  Requires `text` (not vector) input. Toggling Hybrid on reveals
  a **lexical-weight slider** that controls the blend:
  - `0` → vector-only (lexical signal contributes nothing)
  - `0.5` → balanced (default)
  - `1` → lexical-only (vector signal contributes nothing)
  The 0–1 value is forwarded as `lexicalWeight` on the search
  request body. Step is `0.05`. Honored on `mock`; ignored on
  `astra` (the reranker owns the blend, so any value the slider
  sends is dropped server-side).
- **Rerank** — flips `rerank: true`. Requires the KB to have a
  `rerankingServiceId` bound. On `mock` this is a standalone
  post-processing phase over the retrieval hits. On `astra`
  standalone rerank is **not** exposed — pair `rerank` with
  `hybrid: true` to get the combined Astra path; otherwise the
  API returns 501.

Both toggles default to the bound KB's `lexical.enabled` /
`rerankingServiceId != null`. Drivers that lack the relevant
method return 501 (`hybrid_not_supported` / `rerank_not_supported`);
the UI surfaces these as a toast.

## Hits are chunks, not documents

The KB indexes at the chunk level. A document ingested
with three paragraphs becomes three chunks; a search query can
return all three as separate hits. The results table reflects that
shape directly: each row shows the chunk's `chunkIndex` (its
0-based position within the source document), the parent
`documentId`, and a 2-line preview of the chunk's text. Click a
row to expand the full payload and score.

To browse chunks **under** a specific document — for inspection,
not search — open the KB documents view and click any row in the
documents table. The detail dialog lists the chunks under that
document directly, sorted by `chunkIndex`, sourced from
`GET /knowledge-bases/{kb}/documents/{d}/chunks`.

## Knowledge base ingest from the workspace UI

Ingest now has a dedicated UI surface, complementing the data-plane
`POST .../records` upsert path:

- **Workspace detail → Knowledge Bases → Ingest** (or **Open** → KB
  detail → **Ingest**) opens a multi-file / folder queue. Drop
  files (or pick a folder via the directory picker) and they
  ingest sequentially through the KB's bound chunking + embedding
  services. The queue accepts plain-text documents, data, config,
  and source files such as Markdown, YAML, TOML, JSON, CSV, logs,
  SQL, and TypeScript. Each row shows live progress for the active
  file and terminal status for everything before it.
- Async ingest jobs stream progress via the SSE
  `GET .../jobs/{jobId}/events` endpoint until a terminal state.
  The dialog renders the live `processed/total` counter and
  surfaces the final `status` + `errorMessage`.

The playground stays a scratchpad — no ingest in the playground
itself. Use the workspace UI to populate a KB, then come back
to the playground to query it.

## Document delete cascade

The KB documents view's per-row trash button removes a document
**and** its chunks. The runtime runs `deleteRecords` on the KB's
driver before dropping the document row, so deleted documents stop
surfacing in KB-scoped search hits immediately.

## Future extensions

- **Streaming results** — not meaningful for vector search (one
  round trip), but the shape could change when reranking /
  generation join the request path.
- **Saved playground runs** — useful search configurations could be
  persisted as shareable workspace artifacts once the product needs a
  repeatable evaluation workflow rather than a scratchpad only.
