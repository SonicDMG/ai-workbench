/**
 * Recursive-descent parser for the RLAC policy DSL.
 *
 * Grammar (informal):
 *
 *   predicate   := or_expr
 *   or_expr     := and_expr ("OR" and_expr)*
 *   and_expr    := not_expr ("AND" not_expr)*
 *   not_expr    := "NOT" not_expr | atom
 *   atom        := "(" predicate ")"
 *                | scalar op scalar
 *                | scalar "IN" "(" literal ("," literal)* ")"
 *                | scalar "=" "ANY" "(" row_ref ")"
 *                | row_ref "@>" "ARRAY" "[" literal ("," literal)* "]"
 *   scalar      := row_ref | principal_ref | func | literal
 *   row_ref     := "row" "." identifier  |  bare_identifier
 *   principal_ref := "$principal" "." identifier
 *   func        := "current_principal_id" "(" ")"
 *   literal     := string | integer | "true" | "false"
 *
 * Identifiers are case-sensitive. Keywords (`AND`, `OR`, `NOT`, `IN`,
 * `ANY`, `ARRAY`, `true`, `false`) are case-insensitive. Bare
 * identifiers that aren't keywords are treated as row column refs —
 * this matches Postgres-style RLS where you'd write `owner_id = 'x'`
 * without the `row.` qualifier.
 *
 * The parser yields a {@link ../ast.PredicateNode}. Errors throw
 * {@link PolicyParseError} with a 1-based column number so the UI can
 * underline the offending token.
 */

import type {
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

export class PolicyParseError extends Error {
	readonly column: number;
	constructor(message: string, column: number) {
		super(`policy parse error at col ${column}: ${message}`);
		this.column = column;
		this.name = "PolicyParseError";
	}
}

type TokenKind =
	| "ident"
	| "string"
	| "number"
	| "lparen"
	| "rparen"
	| "lbracket"
	| "rbracket"
	| "dot"
	| "comma"
	| "op"
	| "contains"
	| "kw_and"
	| "kw_or"
	| "kw_not"
	| "kw_in"
	| "kw_any"
	| "kw_array"
	| "kw_true"
	| "kw_false"
	| "principal_token";

interface Token {
	readonly kind: TokenKind;
	readonly value: string;
	readonly column: number;
}

const SINGLE_CHAR: Record<string, TokenKind> = {
	"(": "lparen",
	")": "rparen",
	"[": "lbracket",
	"]": "rbracket",
	".": "dot",
	",": "comma",
};

const KEYWORDS: Record<string, TokenKind> = {
	and: "kw_and",
	or: "kw_or",
	not: "kw_not",
	in: "kw_in",
	any: "kw_any",
	array: "kw_array",
	true: "kw_true",
	false: "kw_false",
};

function tokenize(input: string): readonly Token[] {
	const out: Token[] = [];
	let i = 0;
	while (i < input.length) {
		const ch = input[i] as string;
		if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r") {
			i += 1;
			continue;
		}
		const col = i + 1;
		// Operators
		if (ch === "<" || ch === ">") {
			const two = input.slice(i, i + 2);
			if (two === "<=" || two === ">=" || two === "<>") {
				out.push({ kind: "op", value: two, column: col });
				i += 2;
				continue;
			}
			out.push({ kind: "op", value: ch, column: col });
			i += 1;
			continue;
		}
		if (ch === "=") {
			out.push({ kind: "op", value: "=", column: col });
			i += 1;
			continue;
		}
		if (ch === "!") {
			if (input[i + 1] === "=") {
				out.push({ kind: "op", value: "<>", column: col });
				i += 2;
				continue;
			}
			throw new PolicyParseError("unexpected '!'", col);
		}
		// @> contains
		if (ch === "@" && input[i + 1] === ">") {
			out.push({ kind: "contains", value: "@>", column: col });
			i += 2;
			continue;
		}
		// Punctuation
		const single = SINGLE_CHAR[ch];
		if (single) {
			out.push({ kind: single, value: ch, column: col });
			i += 1;
			continue;
		}
		// $principal.xxx — handled as ident-with-prefix downstream
		if (ch === "$") {
			let j = i + 1;
			while (j < input.length && /[A-Za-z0-9_]/.test(input[j] as string)) {
				j += 1;
			}
			const v = input.slice(i, j);
			if (v !== "$principal") {
				throw new PolicyParseError(`unknown identifier '${v}'`, col);
			}
			out.push({ kind: "principal_token", value: v, column: col });
			i = j;
			continue;
		}
		// String literal — single-quoted, Postgres style. Doubled
		// single quotes escape: 'it''s fine'.
		if (ch === "'") {
			let j = i + 1;
			let buf = "";
			let closed = false;
			while (j < input.length) {
				const c = input[j] as string;
				if (c === "'") {
					if (input[j + 1] === "'") {
						buf += "'";
						j += 2;
						continue;
					}
					closed = true;
					j += 1;
					break;
				}
				buf += c;
				j += 1;
			}
			if (!closed) throw new PolicyParseError("unterminated string", col);
			out.push({ kind: "string", value: buf, column: col });
			i = j;
			continue;
		}
		// Number literal — integers only for the prototype.
		if (/[0-9]/.test(ch)) {
			let j = i + 1;
			while (j < input.length && /[0-9]/.test(input[j] as string)) j += 1;
			out.push({
				kind: "number",
				value: input.slice(i, j),
				column: col,
			});
			i = j;
			continue;
		}
		// Identifier or keyword.
		if (/[A-Za-z_]/.test(ch)) {
			let j = i + 1;
			while (j < input.length && /[A-Za-z0-9_]/.test(input[j] as string)) {
				j += 1;
			}
			const v = input.slice(i, j);
			const lower = v.toLowerCase();
			const kw = KEYWORDS[lower];
			if (kw) out.push({ kind: kw, value: lower, column: col });
			else out.push({ kind: "ident", value: v, column: col });
			i = j;
			continue;
		}
		throw new PolicyParseError(`unexpected character '${ch}'`, col);
	}
	return out;
}

class Cursor {
	private idx = 0;
	constructor(private readonly tokens: readonly Token[]) {}

	peek(offset = 0): Token | undefined {
		return this.tokens[this.idx + offset];
	}

	advance(): Token {
		const t = this.tokens[this.idx];
		if (!t) {
			throw new PolicyParseError(
				"unexpected end of input",
				(this.tokens[this.idx - 1]?.column ?? 0) + 1,
			);
		}
		this.idx += 1;
		return t;
	}

	match(kind: TokenKind): boolean {
		if (this.peek()?.kind === kind) {
			this.advance();
			return true;
		}
		return false;
	}

	expect(kind: TokenKind, label?: string): Token {
		const t = this.peek();
		if (!t || t.kind !== kind) {
			const where = t?.column ?? 0;
			throw new PolicyParseError(
				`expected ${label ?? kind}${t ? `, got '${t.value}'` : ""}`,
				where,
			);
		}
		return this.advance();
	}

	atEnd(): boolean {
		return this.idx >= this.tokens.length;
	}
}

function parsePredicate(c: Cursor): PredicateNode {
	return parseOr(c);
}

function parseOr(c: Cursor): PredicateNode {
	const first = parseAnd(c);
	const args: PredicateNode[] = [first];
	while (c.match("kw_or")) args.push(parseAnd(c));
	if (args.length === 1) return args[0] as PredicateNode;
	return { kind: "or", args } as OrNode;
}

function parseAnd(c: Cursor): PredicateNode {
	const first = parseNot(c);
	const args: PredicateNode[] = [first];
	while (c.match("kw_and")) args.push(parseNot(c));
	if (args.length === 1) return args[0] as PredicateNode;
	return { kind: "and", args } as AndNode;
}

function parseNot(c: Cursor): PredicateNode {
	if (c.match("kw_not")) {
		const inner = parseNot(c);
		return { kind: "not", arg: inner } as NotNode;
	}
	return parseAtom(c);
}

function parseAtom(c: Cursor): PredicateNode {
	if (c.match("lparen")) {
		const inner = parsePredicate(c);
		c.expect("rparen", "')'");
		return inner;
	}
	// All remaining forms start with a scalar. Parse one, then decide
	// which production rule we're in based on what follows.
	const left = parseScalar(c);
	const nxt = c.peek();
	if (!nxt) {
		throw new PolicyParseError(
			"unexpected end of input after scalar",
			(c.peek(-1) as Token | undefined)?.column ?? 0,
		);
	}
	if (nxt.kind === "kw_in") {
		c.advance();
		c.expect("lparen", "'(' after IN");
		const values: Literal[] = [parseLiteral(c)];
		while (c.match("comma")) values.push(parseLiteral(c));
		c.expect("rparen", "')'");
		return { kind: "in", subject: left, values } as InNode;
	}
	if (nxt.kind === "contains") {
		// row.x @> ARRAY[...]
		if (left.kind !== "row") {
			throw new PolicyParseError(
				"left of @> must be a row column reference",
				nxt.column,
			);
		}
		c.advance();
		c.expect("kw_array", "'ARRAY' after @>");
		c.expect("lbracket", "'[' after ARRAY");
		const values: Literal[] = [parseLiteral(c)];
		while (c.match("comma")) values.push(parseLiteral(c));
		c.expect("rbracket", "']'");
		return { kind: "contains", array: left, values } as ContainsNode;
	}
	if (nxt.kind === "op") {
		const op = c.advance().value as Operator;
		// Special case: `lhs = ANY(row.col)` membership.
		if (op === "=" && c.peek()?.kind === "kw_any") {
			c.advance();
			c.expect("lparen", "'(' after ANY");
			const arr = parseScalar(c);
			c.expect("rparen", "')'");
			if (arr.kind !== "row") {
				throw new PolicyParseError(
					"ANY() argument must be a row column",
					nxt.column,
				);
			}
			return { kind: "any", subject: left, array: arr } as AnyNode;
		}
		const right = parseScalar(c);
		return { kind: "compare", op, left, right } as CompareNode;
	}
	throw new PolicyParseError(
		`expected comparison, IN, ANY, or @>, got '${nxt.value}'`,
		nxt.column,
	);
}

function parseScalar(c: Cursor): ScalarNode {
	const t = c.peek();
	if (!t) {
		throw new PolicyParseError(
			"unexpected end of input where scalar expected",
			0,
		);
	}
	if (t.kind === "string") {
		c.advance();
		return { kind: "literal", value: t.value } as StringLiteralNode;
	}
	if (t.kind === "number") {
		c.advance();
		return { kind: "literal", value: Number(t.value) } as StringLiteralNode;
	}
	if (t.kind === "kw_true") {
		c.advance();
		return { kind: "literal", value: true } as StringLiteralNode;
	}
	if (t.kind === "kw_false") {
		c.advance();
		return { kind: "literal", value: false } as StringLiteralNode;
	}
	if (t.kind === "principal_token") {
		c.advance();
		c.expect("dot", "'.' after $principal");
		const attr = c.expect("ident", "principal attribute name").value;
		return { kind: "principal", attribute: attr } as PrincipalRefNode;
	}
	if (t.kind === "ident") {
		const ident = c.advance().value;
		// `current_principal_id()` is the only recognised function.
		if (ident === "current_principal_id" && c.peek()?.kind === "lparen") {
			c.advance();
			c.expect("rparen", "')' after current_principal_id(");
			return { kind: "func", name: "current_principal_id" } as FuncCallNode;
		}
		// `row.col` qualified
		if (ident === "row" && c.peek()?.kind === "dot") {
			c.advance();
			const col = c.expect("ident", "column name after 'row.'").value;
			return { kind: "row", column: col } as RowRefNode;
		}
		// Bare identifier: row column.
		return { kind: "row", column: ident } as RowRefNode;
	}
	throw new PolicyParseError(`unexpected token '${t.value}'`, t.column);
}

function parseLiteral(c: Cursor): Literal {
	const t = c.advance();
	if (t.kind === "string") return t.value;
	if (t.kind === "number") return Number(t.value);
	if (t.kind === "kw_true") return true;
	if (t.kind === "kw_false") return false;
	throw new PolicyParseError(`expected literal, got '${t.value}'`, t.column);
}

/** Parse a policy DSL source string into an AST. */
export function parsePolicy(input: string): PredicateNode {
	const tokens = tokenize(input);
	if (tokens.length === 0) {
		throw new PolicyParseError("empty policy", 1);
	}
	const cursor = new Cursor(tokens);
	const node = parsePredicate(cursor);
	if (!cursor.atEnd()) {
		const t = cursor.peek() as Token;
		throw new PolicyParseError(`unexpected trailing '${t.value}'`, t.column);
	}
	return node;
}
