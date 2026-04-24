# Playground

The playground is a browser scratchpad for running ad-hoc vector
and text queries against a workspace's vector stores. It's the
"aha moment" path for the product — after onboarding a workspace
and upserting data (via API or an external ingester), open
[`/playground`](../apps/web/README.md) to see what the store
actually returns.

No persistence. Nothing is saved between queries. If you want a
repeatable run, script it against the same HTTP API the UI uses.

## UI flow

1. Pick a workspace.
2. Pick one of its vector stores. The form unlocks.
3. **Text tab** — type a query. The runtime embeds it (see
   [Dispatch](#dispatch) below) and runs an ANN search. Useful
   when the store's `embedding` block points at a provider the
   runtime can reach (OpenAI today).
4. **Vector tab** — paste a raw vector. The runtime sends it
   straight through to the driver. Useful for debugging, for
   stores with no `embedding` config, or when you want to sanity-
   check a specific coordinate.
5. **Top-K** (1–25) and an **optional filter** (JSON object,
   shallow-equal over payload) round out the knobs.
6. Hit Run. Results land in a table; each row expands to show the
   full payload.

## Dispatch

`POST /api/v1/workspaces/{w}/vector-stores/{vs}/search` accepts
either `{ vector }` or `{ text }` (exactly one). When the request
carries a vector it goes straight to `driver.search()`. Text
queries pick one of two paths:

1. **Server-side embedding** — if the driver has a
   `searchByText()` method and it doesn't throw
   `NotSupportedError`, the driver handles the query itself
   (e.g. Astra's `$vectorize`). Nothing about the vector reaches
   the runtime.
2. **Client-side embedding** — otherwise, the runtime builds an
   `Embedder` from the vector store's `embedding` config, embeds
   the text locally via the Vercel AI SDK, then does a normal
   vector search.

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

The runtime's `Embedder` interface is a thin wrapper over the
Vercel AI SDK:

```ts
interface Embedder {
  readonly id: string;            // e.g. "openai:text-embedding-3-small"
  readonly dimension: number;     // matched against the vector store's declared dim
  embed(text: string): Promise<readonly number[]>;
  embedMany(texts: readonly string[]): Promise<readonly (readonly number[])[]>;
}
```

The factory (`EmbedderFactory.forConfig(config)`) takes a vector
store's `EmbeddingConfig` and returns an `Embedder`. It resolves
the `secretRef` through the existing `SecretResolver`, then
dispatches on `provider`. Today: OpenAI. Adding another provider
(Cohere, Voyage, Bedrock, …) is one `npm install @ai-sdk/<prov>`
+ one case in [`embeddings/vercel.ts`](../runtimes/typescript/src/embeddings/vercel.ts).

Errors surface as `EmbedderUnavailableError` (`400
embedding_unavailable`) when the config is missing a secret or
names an unsupported provider, and `embedding_dimension_mismatch`
(`400`) when the provider returns a vector whose length doesn't
match the vector store's declared dimension.

## Astra vectorize

Astra's Data API can do the embedding itself when a collection is
created with a `vector.service` block. The driver detects this
path from the descriptor's `embedding` config: when the provider
is one of `openai`, `azureOpenAI`, `cohere`, `jinaAI`, `mistral`,
`nvidia`, `voyageAI` (allowlist in
[`drivers/astra/vectorize.ts`](../runtimes/typescript/src/drivers/astra/vectorize.ts))
**and** a `secretRef` is configured, the driver:

1. At `createCollection` time, attaches
   `{ provider, modelName }` to the collection's `vector.service`.
   New collections under this runtime get server-side embedding by
   default.
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
  the descriptor opts in). On `NotSupportedError` — unsupported
  provider or legacy collection — the route embeds client-side
  via the Vercel AI SDK and retries through plain `upsert`.
- Mixed batches → client-embed the text records, combine with the
  vector records, one transactional `upsert` call. (Splitting
  across `upsertByText` + `upsert` would break transactional
  semantics on the underlying collection.)

## Future extensions

- **Document ingest** — a UI path for uploading text and chunking
  it into a vector store. Until that lands, upsert via the data
  plane (`POST .../records`) is the way.
- **Saved queries** — currently out of scope by design (the
  playground is a scratchpad). Easy to add as a CRUD table if the
  usage pattern argues for it.
- **Streaming results** — not meaningful for vector search (one
  round trip), but the shape could change when reranking /
  generation join the request path.
