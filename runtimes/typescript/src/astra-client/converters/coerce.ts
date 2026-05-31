/**
 * Shared coercion + encoding helpers used by the per-entity converters
 * in this directory. Pure functions — no I/O, no randomness.
 *
 * The default Tables serdes in `@datastax/astra-db-ts` v2.x returns
 * column values typed as the underlying datatype's runtime class:
 *   - `uuid` columns come back as `UUID` instances (`{ version, _raw }`)
 *   - `map<text, text>` columns come back as `Map<string, string>`
 *   - `int` / `bigint` columns come back as `BigInt`
 *   - `timestamp` columns come back as `Date`
 * Our row types declare these as `string`, `Record<string, string>`,
 * `number`, and ISO `string` respectively, so reading rows verbatim into
 * the application records surfaces the wrong shape downstream:
 *   - `JSON.stringify(record.uid)` produces `{"version":4,"_raw":"…"}`
 *     instead of the canonical UUID string.
 *   - `{ ...record.credentials }` spreads a `Map` into an empty object
 *     (Maps have no enumerable own string-keyed properties), silently
 *     dropping all credentials — which makes the workspace's
 *     test-connection fail with "missing credentials.token" even
 *     though the row was stored correctly.
 *   - `JSON.stringify(record)` throws `TypeError: Do not know how to
 *     serialize a BigInt` for any `int`/`bigint` column.
 *   - Sorting/comparing a `Date`-typed `Iso` field crashes
 *     (`Date.localeCompare` is not a function).
 *
 * Rather than register custom Astra serdes codecs (which would change
 * library behavior globally and surprise future readers), the
 * converters coerce on the way out. `*ToRow` writes the
 * application-shape value directly — astra-db-ts accepts both `string`
 * (becomes a `uuid`) and `Record<string, string>` (becomes a `map`)
 * for write, so the write path doesn't need this workaround.
 */

export function asUuidString(v: unknown): string {
	if (typeof v === "string") return v;
	if (v && typeof v === "object") {
		const raw = (v as { _raw?: unknown })._raw;
		if (typeof raw === "string") return raw;
		// `UUID.toString()` returns the canonical lowercase form.
		const candidate = (v as { toString?: () => string }).toString?.();
		if (typeof candidate === "string" && /^[0-9a-f-]{36}$/i.test(candidate)) {
			return candidate;
		}
	}
	return String(v ?? "");
}

export function asNullableUuidString(v: unknown): string | null {
	if (v === null || v === undefined) return null;
	return asUuidString(v);
}

export function asPlainStringMap(v: unknown): Record<string, string> {
	if (v instanceof Map) {
		const out: Record<string, string> = {};
		for (const [k, val] of v as Map<unknown, unknown>) {
			if (typeof k === "string" && typeof val === "string") out[k] = val;
		}
		return out;
	}
	if (v && typeof v === "object") {
		return { ...(v as Record<string, string>) };
	}
	return {};
}

/**
 * Coerce a numeric column value back to a plain `number`. The Tables
 * serdes in `@datastax/astra-db-ts` v2.x decodes `int` and `bigint`
 * columns as JS `BigInt` (so values larger than `Number.MAX_SAFE_INTEGER`
 * survive the round-trip), but our row-type interfaces declare these
 * as `number`. Without coercion, anything that flows through
 * `JSON.stringify(record)` — every API response — throws
 * `TypeError: Do not know how to serialize a BigInt`. The values we
 * actually store (file sizes up to ~5MB, chunk counts in the
 * thousands, request timeouts in ms, token counts) all fit in
 * `Number.MAX_SAFE_INTEGER`, so the precision loss is benign.
 *
 * `double` columns also come back as plain `number` and pass through
 * untouched.
 */
export function asNumber(v: unknown): number {
	if (typeof v === "number") return v;
	if (typeof v === "bigint") return Number(v);
	if (typeof v === "string") return Number.parseFloat(v);
	return Number(v);
}

export function asNumberOrNull(v: unknown): number | null {
	if (v === null || v === undefined) return null;
	return asNumber(v);
}

/**
 * Coerce a Data API timestamp column value back to an ISO-8601 string.
 *
 * astra-db-ts decodes `timestamp` columns as JS `Date` instances —
 * fine for most callsites because JSON serialization runs
 * `Date.toJSON()` and produces the same wire format the application
 * expects. But anything that touches the value before serialization
 * (sorting, comparing, computing day partitions) sees the underlying
 * class and breaks: `Date.localeCompare` is not a function, `Date <
 * Date` only works through `valueOf` coercion, etc. Coerce on the way
 * out so every `Iso`-typed field in the record is genuinely a string.
 */
export function asIsoString(v: unknown): string {
	if (typeof v === "string") return v;
	if (v instanceof Date) return v.toISOString();
	if (v && typeof v === "object") {
		const fn = (v as { toISOString?: () => string }).toISOString;
		if (typeof fn === "function") return fn.call(v);
	}
	return String(v ?? "");
}

export function asIsoStringOrNull(v: unknown): string | null {
	if (v === null || v === undefined) return null;
	return asIsoString(v);
}

/**
 * Astra row → record: SET<T> arrives as a `Set<T>`; the application
 * record exposes it as a sorted `readonly string[]` so JSON
 * serialization roundtrips cleanly across every backend. Elements are
 * coerced through {@link asUuidString} on the way out so SET<UUID>
 * columns (which the Tables serdes hands back as UUID instances) end
 * up as canonical UUID strings — the rest of the codebase assumes
 * `string` for `toolIds`, `knowledgeBaseIds`, etc.
 */
export function setToSortedArray(
	value: Iterable<unknown> | null | undefined,
): string[] {
	const out: string[] = [];
	for (const v of value ?? []) {
		out.push(typeof v === "string" ? v : asUuidString(v));
	}
	return out.sort();
}

/** Record → Astra row: arrays go in as `Set<string>` so astra-db-ts
 * encodes them as the underlying `SET<TEXT>` / `SET<UUID>` column. */
export function arrayToSet(value: readonly string[]): Set<string> {
	return new Set(value);
}

export function parseJsonObject(
	raw: string | null,
): Record<string, unknown> | null {
	if (raw == null) return null;
	const parsed = JSON.parse(raw) as unknown;
	if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
		throw new Error("expected JSON object");
	}
	return parsed as Record<string, unknown>;
}

export function stringifyJsonObject(
	value: Readonly<Record<string, unknown>>,
): string {
	return JSON.stringify(value);
}
