/**
 * Shape-agnostic normalizer for conformance fixtures.
 *
 * Walks any JSON tree, substitutes volatile values with stable
 * placeholders:
 *
 *   workbench API tokens       → {{WB_TOKEN_N}}   (full `wb_live_<12>_<32>`,
 *                                 matched before prefixes so the inner
 *                                 12-char segment doesn't get swapped
 *                                 independently)
 *   UUIDs (RFC 4122)           → {{UUID_N}}       (1-indexed, by first
 *                                 appearance)
 *   ISO-8601 timestamps        → {{TS}}           (collapsed — ms-granularity
 *                                 collisions between records make ordered
 *                                 placeholders non-deterministic; we trade
 *                                 some signal for CI reliability)
 *   ULID request IDs           → {{REQID_N}}      (26-char Crockford base32,
 *                                 what the TS runtime's request-id
 *                                 middleware generates)
 *   32-char hex request IDs    → {{REQID_N}}      (historical fallback for
 *                                 runtimes that emit UUID.hex)
 *   API-key wire prefixes      → {{WB_PREFIX_N}}  (12-char base36 standalone
 *                                 strings; runs AFTER UUID/TS/REQID so
 *                                 previously-replaced segments don't match)
 *
 * Object keys are sorted alphabetically for deterministic output.
 *
 * Port this file verbatim into any language whose conformance harness
 * needs to compare against these fixtures. Keeping rule ordering and
 * placeholder names identical is what makes cross-language diffs work.
 */

// API tokens: full `wb_live_<12>_<32>`. Matched FIRST so the inner
// 12-char segment doesn't get picked up by the prefix rule.
const WB_TOKEN_RE = /\bwb_live_[a-z0-9]{12}_[a-z0-9]{32}\b/g;
const UUID_RE =
	/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
const TS_RE = /\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z\b/g;
// ULIDs are 26 chars of Crockford base32 (digits + A–Z minus I, L, O, U).
// Matched before the hex fallback so ULIDs don't get misclassified.
const ULID_RE = /\b[0-9A-HJKMNP-TV-Z]{26}\b/g;
// Hex request IDs — kept for runtimes that emit UUID.hex instead of ULIDs.
// Matched after UUIDs so proper UUIDs (with hyphens) take precedence.
const REQID_RE = /\b[0-9a-f]{32}\b/g;
// API-key prefixes — 12 chars base36. Matched LAST so anything inside
// UUIDs / timestamps / tokens / ULIDs is already replaced with
// non-matching placeholders.
const WB_PREFIX_RE = /\b[a-z0-9]{12}\b/g;

function substituteIndexed(input, pattern, placeholderPrefix, mapping) {
	return input.replaceAll(pattern, (match) => {
		if (!(match in mapping)) {
			mapping[match] =
				`{{${placeholderPrefix}_${Object.keys(mapping).length + 1}}}`;
		}
		return mapping[match];
	});
}

function substituteFlat(input, pattern, placeholder) {
	return input.replaceAll(pattern, placeholder);
}

function normalizeString(s, state) {
	let out = s;
	out = substituteIndexed(out, WB_TOKEN_RE, "WB_TOKEN", state.wbTokens);
	out = substituteIndexed(out, UUID_RE, "UUID", state.uuids);
	out = substituteFlat(out, TS_RE, "{{TS}}");
	out = substituteIndexed(out, ULID_RE, "REQID", state.reqIds);
	out = substituteIndexed(out, REQID_RE, "REQID", state.reqIds);
	out = substituteIndexed(out, WB_PREFIX_RE, "WB_PREFIX", state.wbPrefixes);
	return out;
}

function normalizeValue(value, state) {
	if (typeof value === "string") return normalizeString(value, state);
	if (Array.isArray(value)) return value.map((v) => normalizeValue(v, state));
	if (value && typeof value === "object") {
		const sorted = {};
		for (const key of Object.keys(value).sort()) {
			sorted[key] = normalizeValue(value[key], state);
		}
		return sorted;
	}
	return value;
}

/**
 * Normalize any JSON-serializable structure for fixture comparison.
 *
 * @template T
 * @param {T} input
 * @returns {T}
 */
export function normalize(input) {
	const state = {
		uuids: {},
		reqIds: {},
		wbTokens: {},
		wbPrefixes: {},
	};
	return normalizeValue(input, state);
}
