/**
 * Client-side embedding abstraction.
 *
 * The playground (and, later, an ingest pipeline) needs to turn
 * text into vectors when the backing collection can't do it
 * server-side. `Embedder` is the seam: a single-text call, a
 * batched call, and a dimension accessor so callers can sanity-
 * check against a vector store's configured dimension before
 * dispatching.
 *
 * Concrete impls wrap LangChain JS embedding packages
 * (`embeddings/langchain.ts`) so swapping providers is a
 * provider-key change, not an integration rewrite.
 */

export interface Embedder {
	/**
	 * Producer id — e.g. `openai:text-embedding-3-small`. Mostly
	 * useful in logs and error messages so operators can tell
	 * which embedding backend served a given request.
	 */
	readonly id: string;

	/** Declared output dimension. Matched against the vector store's
	 * `vectorDimension` at request time. */
	readonly dimension: number;

	/** Embed a single string. Returns the raw vector. */
	embed(text: string): Promise<readonly number[]>;

	/** Embed many strings in one SDK call when the provider supports
	 * it (most do). Returns vectors in input order. */
	embedMany(texts: readonly string[]): Promise<readonly (readonly number[])[]>;
}

/**
 * Raised when the runtime can't build an embedder for a given
 * `EmbeddingConfig` — either the provider is unknown, or the
 * secret isn't resolvable, or the model/dimension pair is
 * rejected by the SDK.
 */
export class EmbedderUnavailableError extends Error {
	constructor(
		public readonly provider: string,
		public readonly reason: string,
	) {
		super(`cannot build embedder for provider '${provider}': ${reason}`);
		this.name = "EmbedderUnavailableError";
	}
}
