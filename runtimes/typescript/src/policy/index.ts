/**
 * Public surface of the RLAC policy engine.
 *
 * See:
 *  - `parser.ts` — DSL → AST
 *  - `compiler.ts` — AST → Data API filter JSON (per-principal)
 *  - `evaluator.ts` — AST → boolean (in-memory, write-path)
 *  - `validator.ts` — AST → list of Data-API-translatability gaps
 *
 * The design intent of this module is the **design artifact** that
 * goes to the Data API team. The exported types and the canonical
 * `DEFAULT_POLICY_DSL` are exactly the surface the Data API would
 * have to support to host this policy model server-side. The
 * `validatePolicy` function enumerates the gap.
 */

export type {
	AndNode,
	AnyNode,
	CompareNode,
	ContainsNode,
	FuncCallNode,
	InNode,
	Literal,
	NotNode,
	Operator,
	OrNode,
	PredicateNode,
	PrincipalRefNode,
	RowRefNode,
	ScalarNode,
	StringLiteralNode,
} from "./ast.js";
export {
	compilePolicy,
	type DataApiFilter,
	PolicyCompileError,
	type PrincipalContext,
} from "./compiler.js";
export {
	evaluatePolicy,
	type RowContext,
} from "./evaluator.js";
export { PolicyParseError, parsePolicy } from "./parser.js";
export {
	DEFAULT_POLICY_DSL,
	type PolicyValidationIssue,
	validatePolicy,
} from "./validator.js";
