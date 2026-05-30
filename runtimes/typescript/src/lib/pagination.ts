import { ApiError } from "./errors.js";

export const DEFAULT_PAGE_LIMIT = 50;
export const MAX_PAGE_LIMIT = 200;

/**
 * Maximum accepted cursor length (base64url characters). A keyset
 * cursor encodes a small `{k, id}` object and an offset cursor a single
 * integer — neither approaches this bound, so anything larger is a
 * malformed or hostile cursor and is rejected before we spend work
 * base64-decoding + JSON-parsing it.
 */
const MAX_CURSOR_LENGTH = 512;

export interface PaginationQuery {
	readonly limit?: number;
	readonly cursor?: string;
}

export interface Page<T> {
	readonly items: T[];
	readonly nextCursor: string | null;
}

/**
 * Offset-based pagination over an already-materialized row set.
 * Retained for the bounded control-plane list surfaces (workspaces,
 * services, knowledge bases, API keys, …) whose row counts are small
 * and whose wire order is the store's natural order.
 *
 * The chat surface (messages + conversations) can grow without bound,
 * so it uses keyset pagination instead — see {@link encodeKeysetCursor}
 * and the store-level `*Page` methods.
 */
export function paginate<T>(
	rows: readonly T[],
	query: PaginationQuery,
): Page<T> {
	const limit = query.limit ?? DEFAULT_PAGE_LIMIT;
	const offset = decodeCursor(query.cursor);
	const items = rows.slice(offset, offset + limit);
	const nextOffset = offset + items.length;
	return {
		items,
		nextCursor: nextOffset < rows.length ? encodeCursor(nextOffset) : null,
	};
}

function encodeCursor(offset: number): string {
	return Buffer.from(JSON.stringify({ offset }), "utf8").toString("base64url");
}

function decodeCursor(cursor: string | undefined): number {
	if (cursor === undefined) return 0;
	if (cursor.length > MAX_CURSOR_LENGTH) throw invalidCursor();
	try {
		const raw = Buffer.from(cursor, "base64url").toString("utf8");
		const parsed: unknown = JSON.parse(raw);
		if (typeof parsed === "object" && parsed !== null && "offset" in parsed) {
			const offset = parsed.offset;
			if (
				typeof offset === "number" &&
				Number.isInteger(offset) &&
				offset >= 0
			) {
				return offset;
			}
		}
	} catch {
		// fall through to canonical API error
	}
	throw invalidCursor();
}

// ── Keyset pagination (chat surface) ─────────────────────────────────
//
// Messages and conversations can grow without bound, so they page with
// an opaque keyset cursor instead of an offset. A keyset cursor encodes
// the sort position `{k, id}` of the last row on the page:
//   - `k`  primary sort value (e.g. `messageTs`, `createdAt`)
//   - `id` stable tiebreaker (e.g. `messageId`, `conversationId`) so
//          same-millisecond rows still page deterministically.
//
// Unlike an offset, a row inserted or deleted *above* the cursor does
// not shift the caller's position. Cursors are opaque and are NOT
// stable across deploys — a client mid-pagination that sees
// `invalid_cursor` should restart from the first page.

export interface KeysetKey {
	readonly k: string;
	readonly id: string;
}

export type KeysetDirection = "asc" | "desc";

/**
 * Store-level page request. The opaque wire cursor is decoded into a
 * structured `after` key at the route layer (so `invalid_cursor` stays
 * a route concern); the store receives only the decoded key + limit and
 * returns the next structured key for the route to re-encode.
 */
export interface ListPageOptions {
	readonly after: KeysetKey | null;
	readonly limit: number;
}

/** A single keyset page returned by a store `*Page` method. */
export interface KeysetPage<T> {
	readonly items: readonly T[];
	readonly nextKey: KeysetKey | null;
}

/** Clamp a requested page limit into `[1, MAX_PAGE_LIMIT]`, defaulting. */
export function clampLimit(requested: number | undefined): number {
	if (requested === undefined) return DEFAULT_PAGE_LIMIT;
	if (!Number.isFinite(requested) || requested <= 0) return DEFAULT_PAGE_LIMIT;
	return Math.min(Math.floor(requested), MAX_PAGE_LIMIT);
}

/**
 * Total order over keyset keys for a given direction. `k` follows the
 * direction; the `id` tiebreaker is ALWAYS ascending so the cursor
 * advances deterministically regardless of the primary direction.
 * Without the stable tiebreaker, same-`k` rows could re-emit a cursor
 * and stall pagination (the web client treats a repeated cursor as a
 * hard error).
 */
export function compareKeyset(
	a: KeysetKey,
	b: KeysetKey,
	direction: KeysetDirection,
): number {
	if (a.k !== b.k) {
		const cmp = a.k < b.k ? -1 : 1;
		return direction === "asc" ? cmp : -cmp;
	}
	if (a.id !== b.id) return a.id < b.id ? -1 : 1;
	return 0;
}

/** True when `row` sorts strictly after `cursor` (belongs on a later page). */
export function isAfterKeysetCursor(
	row: KeysetKey,
	cursor: KeysetKey,
	direction: KeysetDirection,
): boolean {
	return compareKeyset(row, cursor, direction) > 0;
}

export function encodeKeysetCursor(key: KeysetKey): string {
	return Buffer.from(JSON.stringify({ k: key.k, id: key.id }), "utf8").toString(
		"base64url",
	);
}

/**
 * Decode an opaque keyset cursor. Returns `null` for an absent cursor
 * (first page). Throws `ApiError("invalid_cursor", 400)` for a cursor
 * that is oversized, not base64url/JSON, the wrong shape, or a legacy
 * `{offset}` cursor — the caller should restart from the first page.
 */
export function decodeKeysetCursor(
	cursor: string | undefined,
): KeysetKey | null {
	if (cursor === undefined || cursor === "") return null;
	if (cursor.length > MAX_CURSOR_LENGTH) throw invalidCursor();
	let parsed: unknown;
	try {
		parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
	} catch {
		throw invalidCursor();
	}
	if (
		parsed !== null &&
		typeof parsed === "object" &&
		"k" in parsed &&
		"id" in parsed
	) {
		const { k, id } = parsed as { k: unknown; id: unknown };
		if (typeof k === "string" && typeof id === "string") {
			return { k, id };
		}
	}
	throw invalidCursor();
}

/**
 * Keyset-paginate an already-materialized row set. Used where the full
 * set is in memory (the memory/file backends, and the route-layer
 * visible-fill helper). Backends that can push the cursor down to the
 * engine (sqlite, astra) do the equivalent server-side and skip this.
 */
export function paginateKeyset<T>(
	rows: readonly T[],
	opts: {
		readonly after: KeysetKey | null;
		readonly limit: number;
		readonly direction: KeysetDirection;
		readonly keyOf: (row: T) => KeysetKey;
	},
): { items: T[]; nextKey: KeysetKey | null } {
	const { after, limit, direction, keyOf } = opts;
	const ordered = [...rows].sort((a, b) =>
		compareKeyset(keyOf(a), keyOf(b), direction),
	);
	const remaining =
		after === null
			? ordered
			: ordered.filter((row) =>
					isAfterKeysetCursor(keyOf(row), after, direction),
				);
	const items = remaining.slice(0, limit);
	const last = items.at(-1);
	const hasMore = remaining.length > items.length;
	return { items, nextKey: hasMore && last !== undefined ? keyOf(last) : null };
}

function invalidCursor(): ApiError {
	return new ApiError("invalid_cursor", "cursor is invalid or expired", 400);
}
