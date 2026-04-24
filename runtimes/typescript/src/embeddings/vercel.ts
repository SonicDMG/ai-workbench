/**
 * Vercel AI SDK-backed Embedder.
 *
 * Uses `ai.embed` / `ai.embedMany` dispatched through a provider
 * module (`@ai-sdk/openai`, `@ai-sdk/cohere`, etc.). Adding a new
 * provider = import its package + one case in `resolveModel()`.
 *
 * Kept provider-selection behind a string instead of exposing the
 * SDK's model types directly: yaml config carries a string anyway,
 * and the indirection means operators can swap models without
 * re-typing the `EmbeddingConfig` interface.
 */

import { createOpenAI } from "@ai-sdk/openai";
import { type EmbeddingModel, embed, embedMany } from "ai";
import type { EmbeddingConfig } from "../control-plane/types.js";
import { type Embedder, EmbedderUnavailableError } from "./types.js";

export interface VercelEmbedderDeps {
	readonly config: EmbeddingConfig;
	readonly apiKey: string;
}

export function buildVercelEmbedder(deps: VercelEmbedderDeps): Embedder {
	const model = resolveModel(deps);
	const id = `${deps.config.provider}:${deps.config.model}`;
	const dimension = deps.config.dimension;
	return {
		id,
		dimension,
		async embed(text) {
			const { embedding } = await embed({ model, value: text });
			checkDimension(embedding, dimension);
			return embedding;
		},
		async embedMany(texts) {
			if (texts.length === 0) return [];
			const { embeddings } = await embedMany({ model, values: [...texts] });
			for (const v of embeddings) checkDimension(v, dimension);
			return embeddings;
		},
	};
}

function resolveModel(deps: VercelEmbedderDeps): EmbeddingModel {
	const { provider, model, endpoint } = deps.config;
	switch (provider) {
		case "openai": {
			// `createOpenAI` supports a custom `baseURL` for OpenAI-compatible
			// gateways (Azure OpenAI, local ollama with the OpenAI-shim,
			// internal proxies). When `endpoint` is null we use the default.
			const client = createOpenAI({
				apiKey: deps.apiKey,
				...(endpoint ? { baseURL: endpoint } : {}),
			});
			return client.embedding(model);
		}
		default:
			throw new EmbedderUnavailableError(
				provider,
				`provider '${provider}' is not wired into the runtime yet (only 'openai' is today — add @ai-sdk/${provider} and one case in embeddings/vercel.ts)`,
			);
	}
}

function checkDimension(vector: readonly number[], expected: number): void {
	if (vector.length !== expected) {
		throw new EmbedderUnavailableError(
			"vercel",
			`returned ${vector.length}-dim vector but config declared ${expected}`,
		);
	}
}
