/**
 * LangChain JS-backed Embedder.
 *
 * Wraps `@langchain/openai` and `@langchain/cohere` (and any future
 * provider package that follows the same `Embeddings` base class)
 * behind the runtime's narrow {@link Embedder} interface.
 *
 * Why LangChain rather than the Vercel AI SDK: chunking already lives
 * in `@langchain/textsplitters`, the embedding services have the same
 * `provider` / `engine` field shape across the schema, and a single
 * vendor cuts the dep matrix in half. The Embedder interface is the
 * seam — callers don't see this choice.
 *
 * Adding a new provider = install `@langchain/<provider>` + one case
 * in {@link buildEmbeddings}.
 */

import { CohereEmbeddings } from "@langchain/cohere";
import type { Embeddings } from "@langchain/core/embeddings";
import { OpenAIEmbeddings } from "@langchain/openai";
import type { EmbeddingConfig } from "../control-plane/types.js";
import { type Embedder, EmbedderUnavailableError } from "./types.js";

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
	switch (provider) {
		case "openai": {
			// OpenAI's `text-embedding-3-*` family supports a `dimensions`
			// param to truncate the native vector — pass it so the
			// runtime's declared dimension is honored end-to-end.
			return new OpenAIEmbeddings({
				apiKey: deps.apiKey,
				model,
				dimensions: dimension,
				...(endpoint ? { configuration: { baseURL: endpoint } } : {}),
			});
		}
		case "cohere": {
			return new CohereEmbeddings({
				apiKey: deps.apiKey,
				model,
				...(endpoint ? { baseUrl: endpoint } : {}),
			});
		}
		default:
			throw new EmbedderUnavailableError(
				provider,
				`provider '${provider}' is not wired into the runtime yet (only 'openai' and 'cohere' are today — add @langchain/${provider} and one case in embeddings/langchain.ts)`,
			);
	}
}

function checkDimension(vector: readonly number[], expected: number): void {
	if (vector.length !== expected) {
		throw new EmbedderUnavailableError(
			"langchain",
			`returned ${vector.length}-dim vector but config declared ${expected}`,
		);
	}
}
