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
