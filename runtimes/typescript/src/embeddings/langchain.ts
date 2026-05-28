/**
 * LangChain JS-backed Embedder.
 *
 * Wraps `@langchain/openai` and `@langchain/cohere` behind the
 * runtime's narrow {@link Embedder} interface. OpenRouter and a local
 * Ollama server both expose an OpenAI-compatible `/embeddings`
 * endpoint, so they reuse `OpenAIEmbeddings` with a `baseURL` override —
 * the same way the chat side reuses one OpenAI-compatible adapter.
 *
 * Why LangChain rather than the Vercel AI SDK: chunking already lives
 * in `@langchain/textsplitters`, the embedding services have the same
 * `provider` / `engine` field shape across the schema, and a single
 * vendor cuts the dep matrix in half. The Embedder interface is the
 * seam — callers don't see this choice.
 *
 * Adding a new OpenAI-compatible provider = one case in {@link
 * buildEmbeddings} pointing `baseURL` at it.
 */

import { CohereEmbeddings } from "@langchain/cohere";
import type { Embeddings } from "@langchain/core/embeddings";
import { OpenAIEmbeddings } from "@langchain/openai";
import {
	OLLAMA_DEFAULT_BASE_URL,
	OPENROUTER_BASE_URL,
} from "../chat/providers.js";
import type { EmbeddingConfig } from "../control-plane/types.js";
import { safeFetch } from "../lib/safe-fetch.js";
import { type Embedder, EmbedderUnavailableError } from "./types.js";

/**
 * Whether the `dimensions` truncation param is safe to send. Only
 * OpenAI's `text-embedding-3-*` family supports it (natively or proxied
 * through OpenRouter). Ollama models and most others return a
 * fixed-size vector and ignore — or reject — the param, so sending it
 * would either be a no-op or an error, and the declared dimension must
 * instead match the model's native size.
 */
function supportsDimensionsParam(provider: string, model: string): boolean {
	if (provider !== "openai" && provider !== "openrouter") return false;
	return /text-embedding-3/i.test(model);
}

export interface LangchainEmbedderDeps {
	readonly config: EmbeddingConfig;
	readonly apiKey: string;
}

export function buildLangchainEmbedder(deps: LangchainEmbedderDeps): Embedder {
	const embeddings = buildEmbeddings(deps);
	const id = `${deps.config.provider}:${deps.config.model}`;
	const dimension = deps.config.dimension;
	return {
		id,
		dimension,
		async embed(text) {
			const vector = await embeddings.embedQuery(text);
			checkDimension(vector, dimension);
			return vector;
		},
		async embedMany(texts) {
			if (texts.length === 0) return [];
			const vectors = await embeddings.embedDocuments([...texts]);
			for (const v of vectors) checkDimension(v, dimension);
			return vectors;
		},
	};
}

function buildEmbeddings(deps: LangchainEmbedderDeps): Embeddings {
	const { provider, model, endpoint, dimension } = deps.config;

	// `configuration.fetch` injects `safeFetch` so a redirect from an
	// operator-configured `endpoint` can't chase a Location header into
	// IMDS — defense in depth on top of the URL validator. `dimensions`
	// is only sent to models that honor it (see `supportsDimensionsParam`).
	const openAiCompatible = (baseURL: string | undefined): OpenAIEmbeddings =>
		new OpenAIEmbeddings({
			apiKey: deps.apiKey,
			model,
			...(supportsDimensionsParam(provider, model)
				? { dimensions: dimension }
				: {}),
			configuration: { fetch: safeFetch, ...(baseURL ? { baseURL } : {}) },
		});

	switch (provider) {
		case "openai":
			return openAiCompatible(endpoint ?? undefined);
		case "openrouter":
			return openAiCompatible(endpoint ?? OPENROUTER_BASE_URL);
		case "ollama":
			// Local Ollama is unauthenticated, but the OpenAI client still
			// requires a non-empty key string — pass a placeholder.
			return new OpenAIEmbeddings({
				apiKey: deps.apiKey || "ollama",
				model,
				configuration: {
					fetch: safeFetch,
					baseURL: endpoint ?? OLLAMA_DEFAULT_BASE_URL,
				},
			});
		case "cohere":
			return new CohereEmbeddings({
				apiKey: deps.apiKey,
				model,
				...(endpoint ? { baseUrl: endpoint } : {}),
			});
		default:
			throw new EmbedderUnavailableError(
				provider,
				`provider '${provider}' is not wired into the runtime (openrouter, ollama, openai, and cohere are supported — add a case in embeddings/langchain.ts)`,
			);
	}
}

function checkDimension(vector: readonly number[], expected: number): void {
	if (vector.length !== expected) {
		throw new EmbedderUnavailableError(
			"langchain",
			`embedding model returned a ${vector.length}-dim vector but the service declares ${expected}-dim. Set the embedding service's embeddingDimension to ${vector.length} (and create the KB's vector collection at that size) — most local models (e.g. Ollama nomic-embed-text → 768) have a fixed native dimension that can't be truncated.`,
		);
	}
}
