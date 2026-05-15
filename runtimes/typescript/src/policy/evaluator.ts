/**
 * In-process AST evaluator.
 *
 * Used on the write path (update / delete: fetch the row, then check
 * if the principal is allowed to mutate it) and as a reference oracle
 * for property-based tests against the compiler. The route layer never
 * uses the evaluator for reads — that's what the compiler is for, so
 * the filter ships to the Data API and recall stays correct.
 *
 * Missing principal attributes evaluate to `undefined`; comparisons
 * against `undefined` always yield `false`. Missing row columns
 * likewise yield `false` for membership checks — i.e. a row with no
 * `visible_to` is invisible to non-admin callers. Match the compiler's
 * "missing attributes do not match" convention.
 */

import type {
	AndNode,
	AnyNode,
	CompareNode,
	ContainsNode,
	InNode,
	Literal,
	NotNode,
	OrNode,
	PredicateNode,
	PrincipalRefNode,
	RowRefNode,
	ScalarNode,
} from "./ast.js";
import type { PrincipalContext } from "./compiler.js";

export type RowContext = Readonly<Record<string, unknown>>;

function resolveScalar(
	node: ScalarNode,
	row: RowContext,
	principal: PrincipalContext,
): unknown {
	switch (node.kind) {
		case "literal":
			return node.value;
		case "func":
			return principal.id;
		case "principal":
			return resolvePrincipalAttr(node, principal);
		case "row":
			return resolveRowColumn(node, row);
	}
}

function resolvePrincipalAttr(
	node: PrincipalRefNode,
	principal: PrincipalContext,
): string | undefined {
	if (node.attribute === "id") return principal.id;
	return principal.attributes[node.attribute];
}

function resolveRowColumn(node: RowRefNode, row: RowContext): unknown {
	return row[node.column];
}

function compare(a: unknown, op: CompareNode["op"], b: unknown): boolean {
	if (a === undefined || b === undefined) return false;
	if (a === null || b === null) {
		// Postgres semantics: NULL compare is null/unknown, treat as false.
		return op === "<>" ? a !== b : a === b && op === "=";
	}
	if (typeof a !== typeof b) {
		// Defensive: a string vs a number is `false` rather than NaN-y.
		return false;
	}
	switch (op) {
		case "=":
			return a === b;
		case "<>":
			return a !== b;
		case "<":
			return (a as number | string) < (b as number | string);
		case "<=":
			return (a as number | string) <= (b as number | string);
		case ">":
			return (a as number | string) > (b as number | string);
		case ">=":
			return (a as number | string) >= (b as number | string);
	}
}

function toArray(v: unknown): readonly unknown[] | null {
	if (v == null) return null;
	if (Array.isArray(v)) return v;
	if (v instanceof Set) return [...v];
	return null;
}

function evaluateCompare(
	node: CompareNode,
	row: RowContext,
	p: PrincipalContext,
): boolean {
	const l = resolveScalar(node.left, row, p);
	const r = resolveScalar(node.right, row, p);
	return compare(l, node.op, r);
}

function evaluateIn(
	node: InNode,
	row: RowContext,
	p: PrincipalContext,
): boolean {
	const subject = resolveScalar(node.subject, row, p);
	if (subject === undefined || subject === null) return false;
	return node.values.includes(subject as Literal);
}

function evaluateAny(
	node: AnyNode,
	row: RowContext,
	p: PrincipalContext,
): boolean {
	const subject = resolveScalar(node.subject, row, p);
	if (subject === undefined || subject === null) return false;
	const arr = toArray(row[node.array.column]);
	if (!arr) return false;
	return arr.includes(subject);
}

function evaluateContains(node: ContainsNode, row: RowContext): boolean {
	const arr = toArray(row[node.array.column]);
	if (!arr) return false;
	return node.values.every((v) => arr.includes(v));
}

function evaluateNode(
	node: PredicateNode,
	row: RowContext,
	p: PrincipalContext,
): boolean {
	switch (node.kind) {
		case "compare":
			return evaluateCompare(node, row, p);
		case "in":
			return evaluateIn(node, row, p);
		case "any":
			return evaluateAny(node, row, p);
		case "contains":
			return evaluateContains(node, row);
		case "and":
			return (node as AndNode).args.every((a) => evaluateNode(a, row, p));
		case "or":
			return (node as OrNode).args.some((a) => evaluateNode(a, row, p));
		case "not":
			return !evaluateNode((node as NotNode).arg, row, p);
	}
}

/** Evaluate a parsed predicate against an in-memory row. */
export function evaluatePolicy(
	node: PredicateNode,
	row: RowContext,
	principal: PrincipalContext,
): boolean {
	return evaluateNode(node, row, principal);
}
