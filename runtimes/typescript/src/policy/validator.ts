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
				issues.push({
					code: "constant_only_comparison",
					message:
						"comparison has no row column reference — a Data API filter " +
						"must constrain at least one row column",
				});
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
 * no custom DSL. This is the canonical Stefano pattern: a document is
 * visible if `current_principal_id()` is in `visible_to`, OR
 * `visible_to` contains the wildcard `'*'`.
 */
export const DEFAULT_POLICY_DSL: string =
	"current_principal_id() = ANY(visible_to) OR '*' = ANY(visible_to)";
