/**
 * Reserved payload keys that the ingest pipeline stamps onto every
 * chunk record, and that the catalog-scoped search route filters on.
 *
 * One shared module means the writer (pipeline) and reader (search
 * route) can't drift on the key names. Putting them in the ingest
 * subtree breaks a cycle between `routes/api-v1/documents.ts` (which
 * consumes them for search) and `ingest/pipeline.ts` (which writes
 * them).
 */

/** Payload key carrying the owning catalog's UID. The catalog-scoped
 * search route merges `{ [CATALOG_SCOPE_KEY]: catalog.uid }` into the
 * effective filter unconditionally, so records without it — or with a
 * mismatched value — are invisible. */
export const CATALOG_SCOPE_KEY = "catalogUid";

/** Payload key identifying which source document a chunk belongs to.
 * Used for future document-scoped surfaces ("show all chunks of this
 * doc"). */
export const DOCUMENT_SCOPE_KEY = "documentUid";

/** Payload key recording a chunk's 0-based position within its source
 * document. Useful for reassembling context around a hit. */
export const CHUNK_INDEX_KEY = "chunkIndex";
