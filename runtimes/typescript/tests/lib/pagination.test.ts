import { describe, expect, test } from "vitest";
import { ApiError } from "../../src/lib/errors.js";
import {
	clampLimit,
	compareKeyset,
	DEFAULT_PAGE_LIMIT,
	decodeKeysetCursor,
	encodeKeysetCursor,
	isAfterKeysetCursor,
	type KeysetKey,
	MAX_PAGE_LIMIT,
	paginate,
	paginateKeyset,
} from "../../src/lib/pagination.js";

interface Row {
	readonly k: string;
	readonly id: string;
}

const keyOf = (row: Row): KeysetKey => ({ k: row.k, id: row.id });

/** Drain every page of a keyset list, collecting the ids in order. */
function drainKeyset(
	rows: readonly Row[],
	direction: "asc" | "desc",
	limit: number,
): string[] {
	const seenCursors = new Set<string>();
	const out: string[] = [];
	let after: KeysetKey | null = null;
	// Bound the loop defensively so a cursor-stall bug fails loudly.
	for (let guard = 0; guard < 1000; guard++) {
		const page: { items: Row[]; nextKey: KeysetKey | null } = paginateKeyset(
			rows,
			{ after, limit, direction, keyOf },
		);
		out.push(...page.items.map((r) => r.id));
		if (page.nextKey === null) return out;
		const cursor = encodeKeysetCursor(page.nextKey);
		if (seenCursors.has(cursor)) {
			throw new Error(`cursor repeated — pagination stalled at ${cursor}`);
		}
		seenCursors.add(cursor);
		after = page.nextKey;
	}
	throw new Error("drainKeyset did not terminate");
}

describe("clampLimit", () => {
	test("defaults when undefined", () => {
		expect(clampLimit(undefined)).toBe(DEFAULT_PAGE_LIMIT);
	});

	test("caps at MAX_PAGE_LIMIT and floors fractions", () => {
		expect(clampLimit(10_000)).toBe(MAX_PAGE_LIMIT);
		expect(clampLimit(12.9)).toBe(12);
	});

	test("falls back to default for non-positive / non-finite", () => {
		expect(clampLimit(0)).toBe(DEFAULT_PAGE_LIMIT);
		expect(clampLimit(-5)).toBe(DEFAULT_PAGE_LIMIT);
		expect(clampLimit(Number.NaN)).toBe(DEFAULT_PAGE_LIMIT);
		expect(clampLimit(Number.POSITIVE_INFINITY)).toBe(DEFAULT_PAGE_LIMIT);
	});
});

describe("keyset cursor codec", () => {
	test("round-trips a key", () => {
		const key: KeysetKey = { k: "2026-05-30T00:00:00.000Z", id: "abc" };
		expect(decodeKeysetCursor(encodeKeysetCursor(key))).toEqual(key);
	});

	test("absent cursor decodes to null (first page)", () => {
		expect(decodeKeysetCursor(undefined)).toBeNull();
		expect(decodeKeysetCursor("")).toBeNull();
	});

	test("rejects malformed base64 / JSON with invalid_cursor", () => {
		const bad = decodeKeysetCursor.bind(null, "!!!not-base64!!!");
		expect(bad).toThrow(ApiError);
		expect(bad).toThrow(/invalid_cursor|invalid or expired/);
	});

	test("rejects a legacy {offset} cursor", () => {
		const legacy = Buffer.from(JSON.stringify({ offset: 50 }), "utf8").toString(
			"base64url",
		);
		expect(() => decodeKeysetCursor(legacy)).toThrow(ApiError);
	});

	test("rejects wrong-shape and non-string k/id", () => {
		const objCursor = (o: unknown) =>
			Buffer.from(JSON.stringify(o), "utf8").toString("base64url");
		expect(() => decodeKeysetCursor(objCursor({ k: 1, id: "x" }))).toThrow(
			ApiError,
		);
		expect(() => decodeKeysetCursor(objCursor({ k: "x" }))).toThrow(ApiError);
		expect(() => decodeKeysetCursor(objCursor(["k", "id"]))).toThrow(ApiError);
	});

	test("rejects an oversized cursor before decoding", () => {
		expect(() => decodeKeysetCursor("a".repeat(2000))).toThrow(ApiError);
	});
});

describe("compareKeyset / isAfterKeysetCursor", () => {
	test("ascending orders by k then id", () => {
		expect(
			compareKeyset({ k: "a", id: "9" }, { k: "b", id: "0" }, "asc"),
		).toBeLessThan(0);
		expect(
			compareKeyset({ k: "b", id: "0" }, { k: "a", id: "9" }, "asc"),
		).toBeGreaterThan(0);
	});

	test("descending flips k but the id tiebreaker stays ascending", () => {
		expect(
			compareKeyset({ k: "a", id: "0" }, { k: "b", id: "0" }, "desc"),
		).toBeGreaterThan(0);
		// Same k → id ascending regardless of direction (keeps cursor advancing).
		expect(
			compareKeyset({ k: "a", id: "0" }, { k: "a", id: "1" }, "desc"),
		).toBeLessThan(0);
		expect(
			compareKeyset({ k: "a", id: "0" }, { k: "a", id: "1" }, "asc"),
		).toBeLessThan(0);
	});

	test("equal keys compare equal", () => {
		expect(compareKeyset({ k: "a", id: "1" }, { k: "a", id: "1" }, "asc")).toBe(
			0,
		);
	});

	test("isAfterKeysetCursor matches strict ordering", () => {
		const cur: KeysetKey = { k: "m", id: "5" };
		expect(isAfterKeysetCursor({ k: "n", id: "0" }, cur, "asc")).toBe(true);
		expect(isAfterKeysetCursor({ k: "m", id: "6" }, cur, "asc")).toBe(true);
		expect(isAfterKeysetCursor({ k: "m", id: "5" }, cur, "asc")).toBe(false);
		expect(isAfterKeysetCursor({ k: "l", id: "9" }, cur, "asc")).toBe(false);
	});
});

describe("paginateKeyset", () => {
	const rows: Row[] = Array.from({ length: 10 }, (_, i) => ({
		k: `2026-05-30T00:00:00.0${i.toString().padStart(2, "0")}Z`,
		id: `id-${i}`,
	}));

	test("ascending walk returns every row once, in order, no repeated cursor", () => {
		expect(drainKeyset(rows, "asc", 3)).toEqual(rows.map((r) => r.id));
	});

	test("descending walk returns every row once, newest-first", () => {
		const expected = [...rows].map((r) => r.id).reverse();
		expect(drainKeyset(rows, "desc", 4)).toEqual(expected);
	});

	test("nextKey is null once the set is exhausted", () => {
		const page = paginateKeyset(rows, {
			after: null,
			limit: 100,
			direction: "asc",
			keyOf,
		});
		expect(page.items).toHaveLength(10);
		expect(page.nextKey).toBeNull();
	});

	test("stable under deletion above the cursor (keyset invariant)", () => {
		// Page 1 of 3.
		const p1 = paginateKeyset(rows, {
			after: null,
			limit: 3,
			direction: "asc",
			keyOf,
		});
		expect(p1.items.map((r) => r.id)).toEqual(["id-0", "id-1", "id-2"]);
		// Delete a row ABOVE the cursor between page fetches.
		const afterDelete = rows.filter((r) => r.id !== "id-1");
		const p2 = paginateKeyset(afterDelete, {
			after: p1.nextKey,
			limit: 3,
			direction: "asc",
			keyOf,
		});
		// The deletion above the cursor does not shift the next page.
		expect(p2.items.map((r) => r.id)).toEqual(["id-3", "id-4", "id-5"]);
	});

	test("same-millisecond rows page without skipping or repeating a cursor", () => {
		// All rows share the same `k` (collision at ms resolution); the id
		// tiebreaker must carry the whole walk.
		const collided: Row[] = Array.from({ length: 7 }, (_, i) => ({
			k: "2026-05-30T00:00:00.000Z",
			id: `m-${i}`,
		}));
		const walked = drainKeyset(collided, "asc", 2);
		expect(walked).toEqual(collided.map((r) => r.id));
		expect(new Set(walked).size).toBe(collided.length); // no duplicates
	});
});

describe("offset paginate (unchanged, regression guard)", () => {
	test("still pages by offset and ignores keyset cursors gracefully", () => {
		const rows = Array.from({ length: 5 }, (_, i) => ({ id: i }));
		const first = paginate(rows, { limit: 2 });
		expect(first.items).toEqual([{ id: 0 }, { id: 1 }]);
		expect(first.nextCursor).not.toBeNull();
		const second = paginate(rows, {
			limit: 2,
			cursor: first.nextCursor ?? undefined,
		});
		expect(second.items).toEqual([{ id: 2 }, { id: 3 }]);
	});
});
