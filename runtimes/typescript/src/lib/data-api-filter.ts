/**
 * In-memory evaluator for the subset of Astra Data API `filter` JSON that
 * {@link ../policy/compiler.ts} emits.
 *
 * Why this exists: RLAC compiles a policy to a Data API filter that Astra
 * applies server-side (pre-ANN, so no recall loss). The mock vector driver
 * and the document-list route must reproduce that filtering in memory, or
 * tests and the mock backend silently diverge from production. Before this
 * module, the mock driver did flat `payload[k] === v` equality (blind to
 * `$or`/`$and`/membership) and the route had its own partial interpreter —
 * two places to drift. This is the single shared implementation.
 *
 * Supported shapes (everything the compiler can produce):
 *   - `{}`                              → MATCH_ALL (no constraint)
 *   - `{ _aiw_no_match: true }`         → MATCH_NONE (field no row has)
 *   - `{ field: value }`                → equality, or set membership when
 *                                          the row field is an array
 *   - `{ field: { $eq|$ne|$in|$nin|$all|$lt|$lte|$gt|$gte: x } }`
 *   - `{ $and: [...] }`, `{ $or: [...] }`, `{ $not: {...} }`
 */

export type DataApiFilter = Readonly<Record<string, unknown>>;

/** True when `fieldValue` equals `target`, treating an array field as a set
 * (membership) — the Data API semantics the compiler's `= ANY(col)` and the
 * canonical `visible_to` pattern rely on. */
function valueMatches(fieldValue: unknown, target: unknown): boolean {
	if (Array.isArray(fieldValue)) return fieldValue.includes(target);
	return fieldValue === target;
}

/** A `{ $op: operand, ... }` condition object — distinct from a bare value
 * (which compares directly) by having only `$`-prefixed keys. */
function isOperatorObject(v: unknown): v is Readonly<Record<string, unknown>> {
	if (typeof v !== "object" || v === null || Array.isArray(v)) return false;
	const keys = Object.keys(v);
	return keys.length > 0 && keys.every((k) => k.startsWith("$"));
}

/** Order two scalars: numerically when both are numbers, lexically otherwise.
 * Returns negative / 0 / positive like a comparator. */
function compareScalars(a: unknown, b: unknown): number {
	if (typeof a === "number" && typeof b === "number") return a - b;
	const as = String(a);
	const bs = String(b);
	if (as < bs) return -1;
	if (as > bs) return 1;
	return 0;
}

function asArray(operand: unknown): readonly unknown[] {
	return Array.isArray(operand) ? operand : [];
}

function evalOperator(
	fieldValue: unknown,
	op: string,
	operand: unknown,
): boolean {
	switch (op) {
		case "$eq":
			return valueMatches(fieldValue, operand);
		case "$ne":
			return !valueMatches(fieldValue, operand);
		case "$in": {
			const list = asArray(operand);
			if (Array.isArray(fieldValue)) {
				return fieldValue.some((x) => list.includes(x));
			}
			return list.includes(fieldValue);
		}
		case "$nin": {
			const list = asArray(operand);
			if (Array.isArray(fieldValue)) {
				return !fieldValue.some((x) => list.includes(x));
			}
			return !list.includes(fieldValue);
		}
		case "$all": {
			if (!Array.isArray(fieldValue)) return false;
			return asArray(operand).every((x) => fieldValue.includes(x));
		}
		case "$lt":
			return compareScalars(fieldValue, operand) < 0;
		case "$lte":
			return compareScalars(fieldValue, operand) <= 0;
		case "$gt":
			return compareScalars(fieldValue, operand) > 0;
		case "$gte":
			return compareScalars(fieldValue, operand) >= 0;
		default:
			// Unknown operator: refuse to match rather than silently allow,
			// so an unsupported compiler addition fails closed (safer for an
			// access-control filter).
			return false;
	}
}

function evalFieldCondition(fieldValue: unknown, condition: unknown): boolean {
	if (isOperatorObject(condition)) {
		return Object.entries(condition).every(([op, operand]) =>
			evalOperator(fieldValue, op, operand),
		);
	}
	return valueMatches(fieldValue, condition);
}

/**
 * Evaluate a Data API filter against a single document/payload object.
 * A null/undefined or empty (`{}`) filter matches everything.
 */
export function matchesDataApiFilter(
	doc: Readonly<Record<string, unknown>> | undefined,
	filter: DataApiFilter | null | undefined,
): boolean {
	if (!filter) return true;
	return Object.entries(filter).every(([key, value]) => {
		if (key === "$and") {
			return asArray(value).every((f) =>
				matchesDataApiFilter(doc, f as DataApiFilter),
			);
		}
		if (key === "$or") {
			return asArray(value).some((f) =>
				matchesDataApiFilter(doc, f as DataApiFilter),
			);
		}
		if (key === "$not") {
			return !matchesDataApiFilter(doc, value as DataApiFilter);
		}
		return evalFieldCondition(doc ? doc[key] : undefined, value);
	});
}

/**
 * Filter `rows` by a compiled Data API filter, projecting each row to the
 * field shape the filter references via `project` (defaults to identity).
 * Control-plane rows store camelCase (`visibleTo`); the compiler emits
 * snake_case (`visible_to`), so the route passes a projector that bridges
 * the two. A null/undefined filter returns every row unchanged.
 */
export function applyDataApiFilterInMemory<T>(
	rows: readonly T[],
	filter: DataApiFilter | null | undefined,
	project: (row: T) => Readonly<Record<string, unknown>> = (row) =>
		row as Readonly<Record<string, unknown>>,
): readonly T[] {
	if (!filter) return rows;
	return rows.filter((row) => matchesDataApiFilter(project(row), filter));
}
