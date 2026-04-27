/**
 * Build an {@link Embedder} for a given {@link VectorStoreRecord}.
 *
 * Resolves the configured secret via the existing `SecretResolver`
 * chain (so operators keep the same `env:` / `file:` / future
 * provider-prefixed shapes), then hands off to the Vercel SDK
 * impl. The factory is the seam tests mock.
 */

import type { EmbeddingConfig } from "../control-plane/types.js";
import type { SecretResolver } from "../secrets/provider.js";
import { buildLangchainEmbedder } from "./langchain.js";
import { type Embedder, EmbedderUnavailableError } from "./types.js";

export interface EmbedderFactoryDeps {
	readonly secrets: SecretResolver;
}

export interface EmbedderFactory {
	/**
	 * Build an embedder for the vector store's embedding config, or
	 * throw {@link EmbedderUnavailableError} if the config can't be
	 * turned into a working instance (missing secret, unknown
	 * provider, ...).
	 */
	forConfig(config: EmbeddingConfig): Promise<Embedder>;
}

export function makeEmbedderFactory(
	deps: EmbedderFactoryDeps,
): EmbedderFactory {
	return {
		async forConfig(config) {
			if (!config.secretRef) {
				throw new EmbedderUnavailableError(
					config.provider,
					"embedding.secretRef is null — cannot call the provider without credentials",
				);
			}
			let apiKey: string;
			try {
				apiKey = await deps.secrets.resolve(config.secretRef);
			} catch (err) {
				throw new EmbedderUnavailableError(
					config.provider,
					`secret resolution failed: ${
						err instanceof Error ? err.message : "unknown error"
					}`,
				);
			}
			return buildLangchainEmbedder({ config, apiKey });
		},
	};
}
