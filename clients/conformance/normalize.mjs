/**
 * Request normalizer shared by every language's conformance harness.
 *
 * Purpose: produce deterministic payloads so fixture diffs only fail
 * when the client's HTTP behavior actually changed. Random UUIDs and
 * wall-clock timestamps get replaced with stable placeholders assigned
 * in order of first appearance.
 *
 * Rules (keep in sync with clients/conformance/README.md):
 *   1. UUIDs (RFC 4122 v4)         → {{UUID_N}}   (1-indexed)
 *   2. ISO-8601 timestamps         → {{TS_N}}
 *   3. Authorization header value  → {{TOKEN}}
 *   4. User-Agent header           → removed
 *   5. Header names lowercased, keys sorted alphabetically.
 *
 * The normalizer is deliberately stupid — it walks the captured
 * request array once and replaces strings. If a value could be a UUID
 * but also legitimate input, that's fine: placeholders are stable
 * across runs as long as first-appearance order is deterministic.
 *
 * Usage (Node):
 *   import { normalize } from "./normalize.mjs";
 *   const out = normalize(capturedRequestsArray);
 *
 * Usage (other languages): port this file. Keep the ordering and
 * placeholder shapes identical.
 */

const UUID_RE =
	/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
const TS_RE = /\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z\b/g;
const STRIP_HEADERS = new Set(["user-agent", "host", "content-length"]);

/**
 * Replace occurrences of a regex pattern in a string with indexed
 * placeholders. Returns the new string plus the updated mapping.
 */
function substitutePattern(input, pattern, placeholderPrefix, mapping) {
	return input.replaceAll(pattern, (match) => {
		if (!(match in mapping)) {
			mapping[match] =
				`{{${placeholderPrefix}_${Object.keys(mapping).length + 1}}}`;
		}
		return mapping[match];
	});
}

function normalizeValue(value, state) {
	if (typeof value === "string") {
		let out = value;
		out = substitutePattern(out, UUID_RE, "UUID", state.uuids);
		out = substitutePattern(out, TS_RE, "TS", state.timestamps);
		return out;
	}
	if (Array.isArray(value)) {
		return value.map((v) => normalizeValue(v, state));
	}
	if (value && typeof value === "object") {
		const sorted = {};
		for (const key of Object.keys(value).sort()) {
			sorted[key] = normalizeValue(value[key], state);
		}
		return sorted;
	}
	return value;
}

function normalizeHeaders(headers) {
	const out = {};
	for (const rawKey of Object.keys(headers).sort()) {
		const key = rawKey.toLowerCase();
		if (STRIP_HEADERS.has(key)) continue;
		if (key === "authorization" || key === "token" || key === "x-api-key") {
			out[key] = "{{TOKEN}}";
			continue;
		}
		out[key] = headers[rawKey];
	}
	return out;
}

/**
 * Normalize the captured requests array into a deterministic shape
 * suitable for fixture comparison.
 *
 * @param {Array<{method:string, path:string, headers:object, body:unknown}>} captured
 * @returns {Array<object>}
 */
export function normalize(captured) {
	const state = { uuids: {}, timestamps: {} };
	return captured.map((req) => ({
		method: req.method.toUpperCase(),
		path: normalizeValue(req.path, state),
		headers: normalizeHeaders(req.headers),
		body: normalizeValue(req.body, state),
	}));
}
