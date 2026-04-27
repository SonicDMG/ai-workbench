/**
 * Mutable-array serialization helpers for execution-service records
 * (issue #98).
 *
 * Records expose `supportedLanguages` / `supportedContent` / `tags` as
 * `readonly string[]`. Hono's OpenAPI response typing — derived from
 * the Zod schemas — wants mutable `string[]`. Cloning at the boundary
 * is cheaper than relaxing the in-memory record types.
 */

import type {
	EmbeddingServiceRecord,
	LlmServiceRecord,
	McpToolRecord,
	RerankingServiceRecord,
} from "../../control-plane/types.js";

export function toWireEmbedding(r: EmbeddingServiceRecord) {
	return {
		...r,
		supportedLanguages: [...r.supportedLanguages],
		supportedContent: [...r.supportedContent],
	};
}

export function toWireReranking(r: RerankingServiceRecord) {
	return {
		...r,
		supportedLanguages: [...r.supportedLanguages],
		supportedContent: [...r.supportedContent],
	};
}

export function toWireLlm(r: LlmServiceRecord) {
	return {
		...r,
		supportedLanguages: [...r.supportedLanguages],
		supportedContent: [...r.supportedContent],
	};
}

export function toWireMcpTool(r: McpToolRecord) {
	return { ...r, tags: [...r.tags] };
}

export function toWirePage<T, U>(
	page: { readonly items: readonly T[]; readonly nextCursor: string | null },
	convert: (item: T) => U,
): { items: U[]; nextCursor: string | null } {
	return { items: page.items.map(convert), nextCursor: page.nextCursor };
}
