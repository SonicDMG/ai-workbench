/**
 * Basic request/resource ceilings. These are intentionally conservative
 * guardrails, not a complete abuse-prevention system.
 */

/** Maximum JSON body size accepted by `/api/v1/workspaces/*`. */
export const MAX_API_JSON_BODY_BYTES = 1_000_000;

/** Maximum raw document text accepted by `POST .../ingest`. */
export const MAX_INGEST_TEXT_CHARS = 200_000;

/** Maximum text query / saved-query text length. */
export const MAX_QUERY_TEXT_CHARS = 8_192;

/** Maximum per-record text length for vector-store upserts. */
export const MAX_VECTOR_RECORD_TEXT_CHARS = 16_384;

/** Maximum vector array length in search/upsert requests. */
export const MAX_VECTOR_VALUES = 16_384;

/** Maximum chat message body length (user-typed prompt or persisted assistant turn). */
export const MAX_CHAT_MESSAGE_CHARS = 32_000;
