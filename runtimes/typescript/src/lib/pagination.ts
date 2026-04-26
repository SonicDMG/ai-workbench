import { ApiError } from "./errors.js";

export const DEFAULT_PAGE_LIMIT = 50;
export const MAX_PAGE_LIMIT = 200;

export interface PaginationQuery {
	readonly limit?: number;
	readonly cursor?: string;
}

export interface Page<T> {
	readonly items: T[];
	readonly nextCursor: string | null;
}

export function paginate<T>(
	rows: readonly T[],
	query: PaginationQuery,
): Page<T> {
	const limit = query.limit ?? DEFAULT_PAGE_LIMIT;
	const offset = decodeCursor(query.cursor);
	const items = rows.slice(offset, offset + limit);
	const nextOffset = offset + items.length;
	return {
		items,
		nextCursor: nextOffset < rows.length ? encodeCursor(nextOffset) : null,
	};
}

function encodeCursor(offset: number): string {
	return Buffer.from(JSON.stringify({ offset }), "utf8").toString("base64url");
}

function decodeCursor(cursor: string | undefined): number {
	if (cursor === undefined) return 0;
	try {
		const raw = Buffer.from(cursor, "base64url").toString("utf8");
		const parsed: unknown = JSON.parse(raw);
		if (typeof parsed === "object" && parsed !== null && "offset" in parsed) {
			const offset = parsed.offset;
			if (
				typeof offset === "number" &&
				Number.isInteger(offset) &&
				offset >= 0
			) {
				return offset;
			}
		}
	} catch {
		// fall through to canonical API error
	}
	throw new ApiError("invalid_cursor", "cursor is invalid or expired", 400);
}
