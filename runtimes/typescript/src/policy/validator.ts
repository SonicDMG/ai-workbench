/**
 * Policy validator.
 *
 * Walks the AST and reports constructs that cannot be lowered to a
 * Data API filter today. The list returned by {@link validatePolicy}
 * is surfaced via the `POST /api/v1/workspaces/{id}/policy/compile-preview`
 * endpoint (the canonical Data-API-team design ask, captured in code:
 * every item is a platform capability that, once supported, lets the
 * workbench remove an enforcement workaround).
 *
 * No UI today consumes the validator output — the SPA's picker only
 * ever produces the canonical visibility-list pattern. The endpoint
 * exists so the Data API team can probe the gap directly; a future
 * Custom-DSL UI re-introduction would render the issues inline.
 *
 * The validator is intentionally separate from the parser. A policy
 * can be syntactically valid (and even in-process-evaluable) while
 * still being untranslatable to a Data API filter.
 */

import type { PredicateNode, ScalarNode } from "./ast.js";

export interface PolicyValidationIssue {
	readonly code: string;
	readonly message: string;
	/** Free-form pointer for the UI to underline the offending node. */
	readonly hint?: string;
}

interface MutableIssues {
	push(issue: PolicyValidationIssue): void;
}

function isRow(node: ScalarNode): boolean {
	return node.kind === "row";
}

function walkScalar(
	node: ScalarNode,
	issues: MutableIssues,
	allowRow: boolean,
): void {
	if (!allowRow && node.kind === "row") {
		issues.push({
			code: "row_in_value_position",
			message:
				`row column '${node.column}' used in a value position; ` +
				"the Data API filter can only place row columns on the LHS",
			hint: node.column,
		});
	}
}

function walk(node: PredicateNode, issues: MutableIssues): void {
	switch (node.kind) {
		case "compare": {
			const leftIsRow = isRow(node.left);
			const rightIsRow = isRow(node.right);
			if (leftIsRow && rightIsRow) {
				issues.push({
					code: "row_to_row_comparison",
					message:
						"comparing two row columns is not expressible as a Data API filter; " +
						"the filter is matched against each row independently",
				});
			} else if (!leftIsRow && !rightIsRow) {
				// Principal-vs-literal (e.g. `$principal.admin = 'true'`) is
				// a valid idiom: the compiler evaluates it at compile time
				// against the current principal and short-circuits the
				// surrounding OR (collapse to MATCH_ALL when true, drop the
				// disjunct when false). It's the admin-bypass shape used by
				// DEFAULT_POLICY_DSL. Only flag the truly degenerate
				// literal-vs-literal case.
				const isPrincipalVsLiteral =
					(node.left.kind === "principal" &&
						(node.right.kind === "literal" || node.right.kind === "func")) ||
					(node.right.kind === "principal" &&
						(node.left.kind === "literal" || node.left.kind === "func"));
				const isFuncVsLiteral =
					(node.left.kind === "func" && node.right.kind === "literal") ||
					(node.right.kind === "func" && node.left.kind === "literal");
				if (!isPrincipalVsLiteral && !isFuncVsLiteral) {
					issues.push({
						code: "constant_only_comparison",
						message:
							"comparison has no row column reference — a Data API filter " +
							"must constrain at least one row column",
					});
				}
			}
			walkScalar(node.left, issues, leftIsRow);
			walkScalar(node.right, issues, rightIsRow);
			return;
		}
		case "in":
			if (node.subject.kind !== "row") {
				issues.push({
					code: "in_subject_not_row",
					message: "left of IN must be a row column",
				});
			}
			return;
		case "any":
			if (node.subject.kind === "row") {
				issues.push({
					code: "any_subject_is_row",
					message:
						"`row.x = ANY(row.y)` is not expressible; use `'literal' = ANY(row.y)` " +
						"or `current_principal_id() = ANY(row.y)`",
				});
			}
			return;
		case "contains":
			return;
		case "and":
		case "or":
			for (const a of node.args) walk(a, issues);
			return;
		case "not":
			walk(node.arg, issues);
			return;
	}
}

/**
 * Return the list of constructs in this policy that don't translate
 * to a Data API filter. An empty list means the policy can be enforced
 * end-to-end against the Data API today.
 */
export function validatePolicy(
	node: PredicateNode,
): readonly PolicyValidationIssue[] {
	const issues: PolicyValidationIssue[] = [];
	walk(node, { push: (i) => issues.push(i) });
	return issues;
}

/**
 * The default policy applied when a KB has `policyEnabled = true` and
 * no custom DSL. Three disjuncts:
 *
 *   1. **Admin bypass** — `$principal.admin = 'true'`. Principals
 *      with the `admin` attribute see every document regardless of
 *      its `visible_to`. The flip-on bootstrap sets this attribute
 *      on the auto-created `admin` principal so the workspace
 *      operator can see everything out of the box; operators can
 *      promote / demote any principal by toggling the attribute.
 *   2. **Per-principal grant** — the calling principal is listed in
 *      the document's `visible_to`.
 *   3. **Wildcard** — `'*'` is in `visible_to` (everyone).
 *
 * Adding the admin disjunct first lets the read-path short-circuit
 * without scanning the array column. Removing the bypass on a
 * specific KB is a per-KB custom DSL change; removing it
 * workspace-wide is a runtime change to this constant.
 */
export const DEFAULT_POLICY_DSL: string =
	"$principal.admin = 'true' OR current_principal_id() = ANY(visible_to) OR '*' = ANY(visible_to)";
