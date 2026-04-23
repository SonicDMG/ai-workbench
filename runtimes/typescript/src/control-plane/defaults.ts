/**
 * Shared defaults applied by every backend when constructing records from
 * `Create*Input`. Keeping them in one place guarantees memory/file/astra
 * all produce structurally identical records for identical input.
 */

import type {
	LexicalConfig,
	RerankingConfig,
	VectorSimilarity,
} from "./types.js";

export const DEFAULT_SIMILARITY: VectorSimilarity = "cosine";

export const DEFAULT_LEXICAL: LexicalConfig = Object.freeze({
	enabled: false,
	analyzer: null,
	options: Object.freeze({}) as Readonly<Record<string, string>>,
});

export const DEFAULT_RERANKING: RerankingConfig = Object.freeze({
	enabled: false,
	provider: null,
	model: null,
	endpoint: null,
	secretRef: null,
});

export function nowIso(): string {
	return new Date().toISOString();
}

/**
 * Comparator that sorts records by `createdAt` ascending, then by `uid`
 * ascending as a tie-breaker (ISO timestamps collide at millisecond
 * resolution when rows are created in the same tick). Produces a
 * total order, which is what callers and fixtures rely on.
 */
export function byCreatedAtThenUid<
	T extends { readonly createdAt: string; readonly uid: string },
>(a: T, b: T): number {
	if (a.createdAt < b.createdAt) return -1;
	if (a.createdAt > b.createdAt) return 1;
	if (a.uid < b.uid) return -1;
	if (a.uid > b.uid) return 1;
	return 0;
}
