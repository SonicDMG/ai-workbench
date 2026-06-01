/**
 * Reserved payload keys that the KB ingest pipeline stamps onto every
 * chunk record, and that KB-scoped surfaces filter on.
 *
 * One shared module means the writer (pipeline) and readers (search,
 * chunk listing, document delete) can't drift on the key names.
 * Putting them in the ingest subtree breaks an otherwise-cyclic
 * dependency between routes and the pipeline.
 */

/** Payload key carrying the owning knowledge base's ID. */
export const KB_SCOPE_KEY = "knowledgeBaseId";

/** Payload key identifying which source document a chunk belongs to.
 * Used for future document-scoped surfaces ("show all chunks of this
 * doc"). */
export const DOCUMENT_SCOPE_KEY = "documentId";

/** Payload key recording a chunk's 0-based position within its source
 * document. Useful for reassembling context around a hit. */
export const CHUNK_INDEX_KEY = "chunkIndex";

/** Payload key carrying the chunk's original text. Stamped during
 * ingest so the document-chunks UI can show what each chunk
 * actually contains without depending on the driver also persisting
 * `$vectorize`. Adds a small storage overhead to client-side-
 * embedded paths but keeps the chunk view consistent across
 * drivers. Search hits round-trip this key through `payload`. */
export const CHUNK_TEXT_KEY = "chunkText";

/** Payload key carrying RLAC visibility — the set of principal ids (or
 * `"*"` for public) allowed to see the chunk. Mirrors the owning
 * document's `visibleTo`, stamped at ingest so the RLAC filter the
 * policy compiler emits (`{ visible_to: <caller> }` set-membership) can
 * be pushed down into the vector query. **Snake_case is deliberate**: it
 * must match the column name the compiler emits, since the chunk payload
 * key and the compiled filter key are the same identifier.
 *
 * Stamped only when the document has a non-null `visibleTo` (i.e. RLAC is
 * in effect for it); RLAC-off documents leave the key unset so their
 * payloads — and unfiltered search — are unchanged. */
export const VISIBLE_TO_KEY = "visible_to";
