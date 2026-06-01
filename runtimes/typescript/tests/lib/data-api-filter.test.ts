import { describe, expect, it } from "vitest";
import {
	applyDataApiFilterInMemory,
	matchesDataApiFilter,
} from "../../src/lib/data-api-filter.js";

/**
 * The interpreter must agree with what `src/policy/compiler.ts` emits and
 * what the Astra Data API evaluates server-side, so that the mock vector
 * driver and the document-list path filter identically to production.
 * Cases below mirror every compiler output shape.
 */
describe("matchesDataApiFilter", () => {
	const doc = {
		knowledgeBaseId: "kb1",
		visible_to: ["alice", "bob"],
		owner_principal_id: "alice",
		rank: 3,
	};

	it("treats null/undefined/empty filter as MATCH_ALL", () => {
		expect(matchesDataApiFilter(doc, undefined)).toBe(true);
		expect(matchesDataApiFilter(doc, null as never)).toBe(true);
		expect(matchesDataApiFilter(doc, {})).toBe(true);
	});

	it("treats the compiler MATCH_NONE sentinel as matching nothing", () => {
		// `{ _aiw_no_match: true }` carries a field no document has.
		expect(matchesDataApiFilter(doc, { _aiw_no_match: true })).toBe(false);
	});

	it("matches scalar equality", () => {
		expect(matchesDataApiFilter(doc, { knowledgeBaseId: "kb1" })).toBe(true);
		expect(matchesDataApiFilter(doc, { knowledgeBaseId: "kb2" })).toBe(false);
	});

	it("treats equality against an array field as set membership", () => {
		// `{ visible_to: "alice" }` == "array contains alice" on the Data API.
		expect(matchesDataApiFilter(doc, { visible_to: "alice" })).toBe(true);
		expect(matchesDataApiFilter(doc, { visible_to: "carol" })).toBe(false);
	});

	it("evaluates the canonical RLAC $or predicate", () => {
		const filter = {
			$or: [{ visible_to: "bob" }, { visible_to: "*" }],
		};
		expect(matchesDataApiFilter(doc, filter)).toBe(true);
		// A doc visible only to '*' still matches via the second disjunct.
		expect(matchesDataApiFilter({ visible_to: ["*"] }, filter)).toBe(true);
		// A doc visible to neither matches nothing.
		expect(matchesDataApiFilter({ visible_to: ["carol"] }, filter)).toBe(false);
		// Empty visibility (null → []) is invisible to non-admins.
		expect(matchesDataApiFilter({ visible_to: [] }, filter)).toBe(false);
	});

	it("evaluates $and (every branch) and $not (negation)", () => {
		expect(
			matchesDataApiFilter(doc, {
				$and: [{ knowledgeBaseId: "kb1" }, { visible_to: "alice" }],
			}),
		).toBe(true);
		expect(
			matchesDataApiFilter(doc, {
				$and: [{ knowledgeBaseId: "kb1" }, { visible_to: "carol" }],
			}),
		).toBe(false);
		expect(matchesDataApiFilter(doc, { $not: { visible_to: "carol" } })).toBe(
			true,
		);
		expect(matchesDataApiFilter(doc, { $not: { visible_to: "alice" } })).toBe(
			false,
		);
	});

	it("evaluates field operators $ne/$in/$all", () => {
		expect(matchesDataApiFilter(doc, { knowledgeBaseId: { $ne: "kb2" } })).toBe(
			true,
		);
		expect(matchesDataApiFilter(doc, { knowledgeBaseId: { $ne: "kb1" } })).toBe(
			false,
		);
		// $in: scalar field within the list.
		expect(
			matchesDataApiFilter(doc, { knowledgeBaseId: { $in: ["kb1", "kb9"] } }),
		).toBe(true);
		// $in: array field intersects the list.
		expect(
			matchesDataApiFilter(doc, { visible_to: { $in: ["carol", "bob"] } }),
		).toBe(true);
		expect(matchesDataApiFilter(doc, { visible_to: { $in: ["carol"] } })).toBe(
			false,
		);
		// $all: array field contains every listed value.
		expect(
			matchesDataApiFilter(doc, { visible_to: { $all: ["alice", "bob"] } }),
		).toBe(true);
		expect(
			matchesDataApiFilter(doc, { visible_to: { $all: ["alice", "carol"] } }),
		).toBe(false);
	});

	it("evaluates numeric comparison operators", () => {
		expect(matchesDataApiFilter(doc, { rank: { $gte: 3 } })).toBe(true);
		expect(matchesDataApiFilter(doc, { rank: { $gt: 3 } })).toBe(false);
		expect(matchesDataApiFilter(doc, { rank: { $lt: 5 } })).toBe(true);
	});

	it("does not match when the referenced field is absent", () => {
		expect(
			matchesDataApiFilter({ visible_to: ["alice"] }, { other: "x" }),
		).toBe(false);
		expect(matchesDataApiFilter(undefined, { visible_to: "alice" })).toBe(
			false,
		);
		// ...but an absent doc still matches the empty (MATCH_ALL) filter.
		expect(matchesDataApiFilter(undefined, {})).toBe(true);
	});
});

describe("applyDataApiFilterInMemory", () => {
	interface DocRow {
		readonly id: string;
		readonly visibleTo: readonly string[] | null;
	}
	const rows: readonly DocRow[] = [
		{ id: "d1", visibleTo: ["alice"] },
		{ id: "d2", visibleTo: ["*"] },
		{ id: "d3", visibleTo: ["bob"] },
		{ id: "d4", visibleTo: null },
	];
	const project = (d: DocRow) => ({ visible_to: d.visibleTo ?? [] });
	const rlacFor = (caller: string) => ({
		$or: [{ visible_to: caller }, { visible_to: "*" }],
	});

	it("returns all rows when filter is null", () => {
		expect(applyDataApiFilterInMemory(rows, null)).toEqual(rows);
	});

	it("projects rows then applies the compiled filter", () => {
		const visible = applyDataApiFilterInMemory(rows, rlacFor("alice"), project);
		expect(visible.map((r) => r.id)).toEqual(["d1", "d2"]);
		const bobView = applyDataApiFilterInMemory(rows, rlacFor("bob"), project);
		expect(bobView.map((r) => r.id)).toEqual(["d2", "d3"]);
	});

	it("excludes null-visibility rows from non-admin views", () => {
		const visible = applyDataApiFilterInMemory(rows, rlacFor("carol"), project);
		expect(visible.map((r) => r.id)).toEqual(["d2"]); // only the public doc
	});
});
