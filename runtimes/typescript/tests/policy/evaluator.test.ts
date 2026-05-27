/**
 * Branch-focused evaluator tests.
 *
 * `policy.test.ts` already covers the canonical Stefano predicate and a
 * compiler/evaluator agreement corpus. This file fills the gaps the
 * coverage report exposed — every AST node kind, every comparison
 * operator, NULL/undefined handling, type-mismatch defenses, Set vs
 * Array row columns, principal attribute resolution, `IN` membership,
 * `ANY()` membership, `@>` containment, and boolean composition.
 *
 * RLAC's audit shape is a stability commitment as of 0.2.0, so the
 * evaluator is one of the highest-risk files in the runtime — under-
 * coverage here can silently change who can mutate what.
 */

import { describe, expect, it } from "vitest";
import type {
	CompareNode,
	ContainsNode,
	InNode,
	PredicateNode,
	RowRefNode,
} from "../../src/policy/ast.js";
import {
	evaluatePolicy,
	type PrincipalContext,
	parsePolicy,
	type RowContext,
} from "../../src/policy/index.js";

function p(
	id: string,
	attributes: Record<string, string> = {},
): PrincipalContext {
	return { id, attributes };
}

function row(rec: Record<string, unknown>): RowContext {
	return rec;
}

const ROW_COL = (column: string): RowRefNode => ({ kind: "row", column });

describe("evaluator — scalar resolution", () => {
	it("resolves literal scalars on both sides", () => {
		// "'a' = 'a'" is a parser-tolerated form, even though the
		// validator flags it. The evaluator should still answer truthfully.
		expect(evaluatePolicy(parsePolicy("'a' = 'a'"), {}, p("alice"))).toBe(true);
		expect(evaluatePolicy(parsePolicy("'a' = 'b'"), {}, p("alice"))).toBe(
			false,
		);
	});

	it("resolves $principal.id", () => {
		const ast = parsePolicy("owner_id = $principal.id");
		expect(evaluatePolicy(ast, row({ owner_id: "alice" }), p("alice"))).toBe(
			true,
		);
		expect(evaluatePolicy(ast, row({ owner_id: "bob" }), p("alice"))).toBe(
			false,
		);
	});

	it("resolves $principal.<attr> from the attributes map", () => {
		const ast = parsePolicy("dept = $principal.dept");
		expect(
			evaluatePolicy(
				ast,
				row({ dept: "platform" }),
				p("alice", { dept: "platform" }),
			),
		).toBe(true);
		expect(evaluatePolicy(ast, row({ dept: "platform" }), p("alice", {}))).toBe(
			false,
		);
	});

	it("resolves current_principal_id() to the principal id", () => {
		const ast = parsePolicy("owner_id = current_principal_id()");
		expect(evaluatePolicy(ast, row({ owner_id: "alice" }), p("alice"))).toBe(
			true,
		);
		expect(evaluatePolicy(ast, row({ owner_id: "bob" }), p("alice"))).toBe(
			false,
		);
	});

	it("resolves a row column reference and a bare identifier equivalently", () => {
		const a = parsePolicy("row.owner_id = 'alice'");
		const b = parsePolicy("owner_id = 'alice'");
		expect(evaluatePolicy(a, row({ owner_id: "alice" }), p("x"))).toBe(true);
		expect(evaluatePolicy(b, row({ owner_id: "alice" }), p("x"))).toBe(true);
	});
});

describe("evaluator — compare() semantics", () => {
	it("treats `undefined` on either side as false (missing attr / column)", () => {
		// Missing principal attribute → undefined.
		const ast = parsePolicy("owner_id = $principal.dept");
		expect(evaluatePolicy(ast, row({ owner_id: "x" }), p("alice"))).toBe(false);

		// Missing row column → undefined.
		const ast2 = parsePolicy("owner_id = 'alice'");
		expect(evaluatePolicy(ast2, row({}), p("alice"))).toBe(false);
	});

	it("applies Postgres-flavored NULL semantics (= → false, <> → true)", () => {
		const eq: CompareNode = {
			kind: "compare",
			op: "=",
			left: ROW_COL("status"),
			right: { kind: "literal", value: "active" },
		};
		const ne: CompareNode = { ...eq, op: "<>" };

		expect(evaluatePolicy(eq, row({ status: null }), p("alice"))).toBe(false);
		expect(evaluatePolicy(ne, row({ status: null }), p("alice"))).toBe(true);
	});

	it("treats NULL <> NULL as false (both equal, `<>` is the negative case)", () => {
		const ne: CompareNode = {
			kind: "compare",
			op: "<>",
			left: ROW_COL("a"),
			right: ROW_COL("b"),
		};
		expect(evaluatePolicy(ne, row({ a: null, b: null }), p("alice"))).toBe(
			false,
		);
	});

	it("returns false for type-mismatched operands (string vs number)", () => {
		const mismatch: CompareNode = {
			kind: "compare",
			op: "=",
			left: ROW_COL("count"),
			right: { kind: "literal", value: "3" },
		};
		expect(evaluatePolicy(mismatch, row({ count: 3 }), p("alice"))).toBe(false);
	});

	it.each([
		["=", 1, 1, true],
		["=", 1, 2, false],
		["<>", 1, 2, true],
		["<>", 1, 1, false],
		["<", 1, 2, true],
		["<", 2, 1, false],
		["<=", 2, 2, true],
		["<=", 3, 2, false],
		[">", 3, 2, true],
		[">", 2, 3, false],
		[">=", 2, 2, true],
		[">=", 1, 2, false],
	] as const)("operator %s on %s vs %s → %s", (op, lhs, rhs, expected) => {
		const node: CompareNode = {
			kind: "compare",
			op,
			left: ROW_COL("count"),
			right: { kind: "literal", value: rhs },
		};
		expect(evaluatePolicy(node, row({ count: lhs }), p("alice"))).toBe(
			expected,
		);
	});

	it("orders strings lexicographically for <, <=, >, >=", () => {
		const lt: CompareNode = {
			kind: "compare",
			op: "<",
			left: ROW_COL("name"),
			right: { kind: "literal", value: "m" },
		};
		expect(evaluatePolicy(lt, row({ name: "alice" }), p("x"))).toBe(true);
		expect(evaluatePolicy(lt, row({ name: "zoe" }), p("x"))).toBe(false);
	});
});

describe("evaluator — IN", () => {
	it("returns true when subject is among the listed literals", () => {
		const ast = parsePolicy("status IN ('active', 'paused')");
		expect(evaluatePolicy(ast, row({ status: "active" }), p("x"))).toBe(true);
		expect(evaluatePolicy(ast, row({ status: "archived" }), p("x"))).toBe(
			false,
		);
	});

	it("returns false when subject resolves to undefined", () => {
		const ast = parsePolicy("status IN ('active')");
		expect(evaluatePolicy(ast, row({}), p("x"))).toBe(false);
	});

	it("returns false when subject is null", () => {
		const node: InNode = {
			kind: "in",
			subject: ROW_COL("status"),
			values: ["active"],
		};
		expect(evaluatePolicy(node, row({ status: null }), p("x"))).toBe(false);
	});
});

describe("evaluator — ANY()", () => {
	it("returns true when the principal id is in the array column", () => {
		const ast = parsePolicy("$principal.id = ANY(visible_to)");
		expect(
			evaluatePolicy(ast, row({ visible_to: ["alice", "bob"] }), p("bob")),
		).toBe(true);
	});

	it("returns false when subject resolves to undefined", () => {
		const ast = parsePolicy("$principal.dept = ANY(visible_to)");
		expect(
			evaluatePolicy(ast, row({ visible_to: ["alice"] }), p("alice", {})),
		).toBe(false);
	});

	it("returns false when the array column is null", () => {
		const ast = parsePolicy("$principal.id = ANY(visible_to)");
		expect(evaluatePolicy(ast, row({ visible_to: null }), p("alice"))).toBe(
			false,
		);
	});

	it("returns false when the array column is missing entirely", () => {
		const ast = parsePolicy("$principal.id = ANY(visible_to)");
		expect(evaluatePolicy(ast, row({}), p("alice"))).toBe(false);
	});

	it("returns false when the array column is a scalar (not array-like)", () => {
		const ast = parsePolicy("$principal.id = ANY(visible_to)");
		expect(evaluatePolicy(ast, row({ visible_to: "alice" }), p("alice"))).toBe(
			false,
		);
	});

	it("unwraps a Set-valued array column (memory store shape)", () => {
		const ast = parsePolicy("$principal.id = ANY(visible_to)");
		expect(
			evaluatePolicy(ast, row({ visible_to: new Set(["alice"]) }), p("alice")),
		).toBe(true);
	});
});

describe("evaluator — contains (@>)", () => {
	it("returns true when every literal is present in the row's array", () => {
		const node: ContainsNode = {
			kind: "contains",
			array: ROW_COL("labels"),
			values: ["red", "blue"],
		};
		expect(
			evaluatePolicy(node, row({ labels: ["red", "blue", "green"] }), p("x")),
		).toBe(true);
	});

	it("returns false when any literal is missing", () => {
		const node: ContainsNode = {
			kind: "contains",
			array: ROW_COL("labels"),
			values: ["red", "blue"],
		};
		expect(
			evaluatePolicy(node, row({ labels: ["red", "green"] }), p("x")),
		).toBe(false);
	});

	it("returns false when the array column is missing", () => {
		const node: ContainsNode = {
			kind: "contains",
			array: ROW_COL("labels"),
			values: ["red"],
		};
		expect(evaluatePolicy(node, row({}), p("x"))).toBe(false);
	});

	it("accepts an empty values list as trivially true", () => {
		const node: ContainsNode = {
			kind: "contains",
			array: ROW_COL("labels"),
			values: [],
		};
		expect(evaluatePolicy(node, row({ labels: [] }), p("x"))).toBe(true);
	});

	it("unwraps a Set for the row's array column", () => {
		const node: ContainsNode = {
			kind: "contains",
			array: ROW_COL("labels"),
			values: ["red"],
		};
		expect(
			evaluatePolicy(node, row({ labels: new Set(["red", "blue"]) }), p("x")),
		).toBe(true);
	});
});

describe("evaluator — boolean composition", () => {
	it("AND requires every conjunct to hold", () => {
		const ast = parsePolicy("owner_id = $principal.id AND status = 'active'");
		expect(
			evaluatePolicy(
				ast,
				row({ owner_id: "alice", status: "active" }),
				p("alice"),
			),
		).toBe(true);
		expect(
			evaluatePolicy(
				ast,
				row({ owner_id: "alice", status: "archived" }),
				p("alice"),
			),
		).toBe(false);
	});

	it("OR requires at least one disjunct to hold", () => {
		const ast = parsePolicy(
			"owner_id = $principal.id OR $principal.role = 'admin'",
		);
		expect(
			evaluatePolicy(
				ast,
				row({ owner_id: "bob" }),
				p("alice", { role: "admin" }),
			),
		).toBe(true);
		expect(evaluatePolicy(ast, row({ owner_id: "bob" }), p("alice", {}))).toBe(
			false,
		);
	});

	it("NOT inverts the inner predicate", () => {
		const ast = parsePolicy("NOT (status = 'archived')");
		expect(evaluatePolicy(ast, row({ status: "active" }), p("x"))).toBe(true);
		expect(evaluatePolicy(ast, row({ status: "archived" }), p("x"))).toBe(
			false,
		);
	});

	it("nested AND/OR/NOT compose correctly", () => {
		const ast = parsePolicy(
			"(owner_id = $principal.id) AND (NOT (status = 'archived') OR $principal.role = 'admin')",
		);
		// Owner, not archived → true via the first OR branch.
		expect(
			evaluatePolicy(
				ast,
				row({ owner_id: "alice", status: "active" }),
				p("alice"),
			),
		).toBe(true);
		// Owner, archived, not admin → false (NOT-branch false, admin
		// branch false, OR false, AND false).
		expect(
			evaluatePolicy(
				ast,
				row({ owner_id: "alice", status: "archived" }),
				p("alice"),
			),
		).toBe(false);
		// Owner, archived, admin → true (admin satisfies the second
		// disjunct).
		expect(
			evaluatePolicy(
				ast,
				row({ owner_id: "alice", status: "archived" }),
				p("alice", { role: "admin" }),
			),
		).toBe(true);
		// Non-owner, anything → false (AND short-circuits).
		expect(
			evaluatePolicy(
				ast,
				row({ owner_id: "bob", status: "active" }),
				p("alice", { role: "admin" }),
			),
		).toBe(false);
	});

	it("AND with zero args is vacuously true; OR with zero args is vacuously false", () => {
		// Construct directly — the parser never emits these, but the
		// evaluator's `every`/`some` semantics should hold the standard
		// identity.
		const trueAnd: PredicateNode = { kind: "and", args: [] };
		const falseOr: PredicateNode = { kind: "or", args: [] };
		expect(evaluatePolicy(trueAnd, {}, p("x"))).toBe(true);
		expect(evaluatePolicy(falseOr, {}, p("x"))).toBe(false);
	});
});
