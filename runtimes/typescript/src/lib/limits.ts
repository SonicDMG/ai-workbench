/**
 * Basic request/resource ceilings. These are intentionally conservative
 * guardrails, not a complete abuse-prevention system.
 *
 * The two ingest-relevant ceilings are coupled: `MAX_INGEST_TEXT_CHARS`
 * is the product cap on a single document's character count, and
 * `MAX_API_JSON_BODY_BYTES` is the envelope cap that wraps it
 * (text + metadata + JSON quoting + UTF-8 multi-byte expansion). Keep
 * the body cap at roughly 2.5× the text-char cap so realistic non-ASCII
 * docs at the char cap still fit inside the envelope.
 */

/** Maximum JSON body size accepted by `/api/v1/workspaces/*`. */
export const MAX_API_JSON_BODY_BYTES = 5_000_000;

/** Maximum raw document text accepted by `POST .../ingest`. Sized to
 * cover real-world long-form documents (textbook chapters, full
 * CHANGELOGs, long technical specs); the previous 200k cap rejected
 * routine-size markdown files. */
export const MAX_INGEST_TEXT_CHARS = 2_000_000;

/** Maximum text query / saved-query text length. */
export const MAX_QUERY_TEXT_CHARS = 8_192;

/** Maximum per-record text length for vector-store upserts. */
export const MAX_VECTOR_RECORD_TEXT_CHARS = 16_384;

/** Maximum vector array length in search/upsert requests. */
export const MAX_VECTOR_VALUES = 16_384;

/** Maximum chat message body length (user-typed prompt or persisted assistant turn). */
export const MAX_CHAT_MESSAGE_CHARS = 32_000;
