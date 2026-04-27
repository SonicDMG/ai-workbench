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
