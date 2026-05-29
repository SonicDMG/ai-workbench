/**
 * Wire converters for execution-service records (issue #98).
 *
 * Records expose `supportedLanguages` / `supportedContent` / `tags` as
 * `readonly string[]`. Hono's OpenAPI response typing — derived from
 * the Zod schemas — wants mutable `string[]`. Cloning at the boundary
 * is cheaper than relaxing the in-memory record types.
 */

import type {
	EmbeddingServiceRecord,
	LlmServiceRecord,
	McpServerRecord,
	McpToolRecord,
	RerankingServiceRecord,
} from "../../../control-plane/types.js";

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

/**
 * Registered external MCP server (0.4.0 A2). `allowedTools` is a
 * `readonly string[] | null` on the record; clone the array (preserving
 * the `null` = expose-all sentinel) for the mutable wire shape.
 */
export function toWireMcpServer(r: McpServerRecord) {
	return {
		...r,
		allowedTools: r.allowedTools === null ? null : [...r.allowedTools],
	};
}

export function toWirePage<T, U>(
	page: { readonly items: readonly T[]; readonly nextCursor: string | null },
	convert: (item: T) => U,
): { items: U[]; nextCursor: string | null } {
	return { items: page.items.map(convert), nextCursor: page.nextCursor };
}
