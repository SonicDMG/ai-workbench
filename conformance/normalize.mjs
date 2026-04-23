/**
 * Shape-agnostic normalizer for conformance fixtures.
 *
 * Walks any JSON tree, substitutes volatile values with stable
 * placeholders:
 *
 *   UUIDs (RFC 4122)           → {{UUID_N}}   (1-indexed, by first
 *                                 appearance)
 *   ISO-8601 timestamps        → {{TS}}       (collapsed — ms-granularity
 *                                 collisions between records make ordered
 *                                 placeholders non-deterministic; we trade
 *                                 some signal for CI reliability)
 *   ULID request IDs           → {{REQID_N}}  (26-char Crockford base32,
 *                                 what the TS runtime's request-id
 *                                 middleware generates)
 *   32-char hex request IDs    → {{REQID_N}}  (historical fallback for
 *                                 runtimes that emit UUID.hex)
 *
 * Object keys are sorted alphabetically for deterministic output.
 *
 * Port this file verbatim into any language whose conformance harness
 * needs to compare against these fixtures. Keeping rule ordering and
 * placeholder names identical is what makes cross-language diffs work.
 */

const UUID_RE =
	/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
const TS_RE = /\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z\b/g;
// ULIDs are 26 chars of Crockford base32 (digits + A–Z minus I, L, O, U).
// Matched before the hex fallback so ULIDs don't get misclassified.
const ULID_RE = /\b[0-9A-HJKMNP-TV-Z]{26}\b/g;
// Hex request IDs — kept for runtimes that emit UUID.hex instead of ULIDs.
// Matched after UUIDs so proper UUIDs (with hyphens) take precedence.
const REQID_RE = /\b[0-9a-f]{32}\b/g;

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
	out = substituteIndexed(out, UUID_RE, "UUID", state.uuids);
	out = substituteFlat(out, TS_RE, "{{TS}}");
	out = substituteIndexed(out, ULID_RE, "REQID", state.reqIds);
	out = substituteIndexed(out, REQID_RE, "REQID", state.reqIds);
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
	const state = { uuids: {}, reqIds: {} };
	return normalizeValue(input, state);
}
