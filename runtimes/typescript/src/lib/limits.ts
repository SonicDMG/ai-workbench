/**
 * Basic request/resource ceilings. These are intentionally conservative
 * guardrails, not a complete abuse-prevention system.
 *
 * Body caps are split: `MAX_API_JSON_BODY_BYTES` is the default applied
 * to all `/api/v1/workspaces/*` routes (CRUD, search, agent chat), and
 * `MAX_INGEST_BODY_BYTES` is the higher ingest-only cap applied at the
 * route layer of `POST .../ingest`. Splitting narrows the attack surface
 * for everything except ingest while still allowing realistic non-ASCII
 * documents to fit inside the ingest envelope.
 */

/**
 * Default JSON body size accepted by `/api/v1/workspaces/*`. Sized for
 * CRUD payloads, agent chat turns, and search bodies — not document
 * ingest. Ingest routes raise this limit explicitly; see
 * `MAX_INGEST_BODY_BYTES`.
 */
export const MAX_API_JSON_BODY_BYTES = 10_000_000;

/**
 * Maximum JSON body size accepted by ingest endpoints
 * (`POST .../knowledge-bases/{kb}/ingest`, equivalent file routes).
 * Roughly 2.5× the text-char cap so realistic non-ASCII docs at the
 * char cap still fit inside the JSON envelope (UTF-8 expansion + JSON
 * quoting overhead).
 */
export const MAX_INGEST_BODY_BYTES = 50_000_000;

/** Maximum raw document text accepted by `POST .../ingest`. Sized to
 * cover real-world long-form documents (textbook chapters, full
 * CHANGELOGs, long technical specs); the previous 200k cap rejected
 * routine-size markdown files. */
export const MAX_INGEST_TEXT_CHARS = 20_000_000;

/** Maximum text query / saved-query text length. */
export const MAX_QUERY_TEXT_CHARS = 8_192;

/** Maximum per-record text length for vector-store upserts. */
export const MAX_VECTOR_RECORD_TEXT_CHARS = 16_384;

/** Maximum vector array length in search/upsert requests. */
export const MAX_VECTOR_VALUES = 16_384;

/** Maximum chat message body length (user-typed prompt or persisted assistant turn). */
export const MAX_CHAT_MESSAGE_CHARS = 32_000;

/**
 * Maximum agent `systemPrompt` / `userPrompt` length. Operator-supplied
 * persona text is concatenated verbatim into the model context — an
 * unbounded cap lets a malicious operator wedge giant adversarial
 * preludes into every conversation, drive token-exhaustion costs, and
 * crowd out the user turn. 128 KB is generous for legitimate use
 * (multi-paragraph personas, detailed instructions) without leaving the
 * field unbounded.
 */
export const MAX_AGENT_PROMPT_CHARS = 131_072;

/** Maximum agent `name` length. */
export const MAX_AGENT_NAME_CHARS = 200;

/** Maximum agent `description` length. */
export const MAX_AGENT_DESCRIPTION_CHARS = 2_000;
