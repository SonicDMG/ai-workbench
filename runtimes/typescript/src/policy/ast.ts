/**
 * AST shapes for the RLAC policy DSL.
 *
 * The DSL is a small Postgres-flavored predicate language. It compiles
 * down to a Data API `filter` JSON for read paths, and is also
 * evaluable in-process for write-path checks. Three production-rule
 * categories:
 *
 *   1. Boolean composition: `AND`, `OR`, `NOT`, parentheses.
 *   2. Comparison: `=`, `<>`, `<`, `<=`, `>`, `>=`, `IN`.
 *   3. Set-membership against array columns: `'x' = ANY(col)` and
 *      `col @> ARRAY['x','y']`. These translate cleanly into the
 *      Data API's `$in` / array-equality forms.
 *
 * Two operand classes:
 *
 *   - `RowRef`     — a column on the row being evaluated (e.g.
 *                    `visible_to`, `owner_id`, `status`).
 *   - `PrincipalRef` — a field on the calling principal (`$principal.id`,
 *                    `$principal.role`, `$principal.dept`).
 *   - `Func`       — currently just `current_principal_id()`, kept
 *                    open so additional builtins can land without
 *                    breaking the AST.
 *   - Literals     — string / number / boolean / array.
 *
 * The shape deliberately mirrors what a Data API "filter" expression
 * would have to look like server-side: this is the spec ask to the
 * Data API team, captured in code.
 */

export type Operator = "=" | "<>" | "<" | "<=" | ">" | ">=";

export type Literal = string | number | boolean;

export interface StringLiteralNode {
	readonly kind: "literal";
	readonly value: Literal;
}

export interface RowRefNode {
	readonly kind: "row";
	readonly column: string;
}

export interface PrincipalRefNode {
	readonly kind: "principal";
	readonly attribute: string; // "id" | "role" | <free-form attribute key>
}

export interface FuncCallNode {
	readonly kind: "func";
	readonly name: "current_principal_id";
}

export type ScalarNode =
	| StringLiteralNode
	| RowRefNode
	| PrincipalRefNode
	| FuncCallNode;

/** `<scalar> <op> <scalar>` (numbers/booleans permitted on either side). */
export interface CompareNode {
	readonly kind: "compare";
	readonly op: Operator;
	readonly left: ScalarNode;
	readonly right: ScalarNode;
}

/** `<scalar> IN (<literal>, <literal>, ...)` */
export interface InNode {
	readonly kind: "in";
	readonly subject: ScalarNode;
	readonly values: readonly Literal[];
}

/**
 * `<scalar> = ANY(<row.column>)` — membership against an array column.
 * The scalar is expected to be a single value (literal, principal ref,
 * or `current_principal_id()`).
 */
export interface AnyNode {
	readonly kind: "any";
	readonly subject: ScalarNode;
	readonly array: RowRefNode;
}

/**
 * `<row.column> @> ARRAY[<lit>, <lit>, ...]` — the row's array column
 * contains every value in the literal array. Useful for AND-of-labels.
 */
export interface ContainsNode {
	readonly kind: "contains";
	readonly array: RowRefNode;
	readonly values: readonly Literal[];
}

export interface AndNode {
	readonly kind: "and";
	readonly args: readonly PredicateNode[];
}

export interface OrNode {
	readonly kind: "or";
	readonly args: readonly PredicateNode[];
}

export interface NotNode {
	readonly kind: "not";
	readonly arg: PredicateNode;
}

export type PredicateNode =
	| CompareNode
	| InNode
	| AnyNode
	| ContainsNode
	| AndNode
	| OrNode
	| NotNode;
