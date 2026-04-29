/**
 * Build an {@link Embedder} for a given embedding-service config.
 *
 * Resolves the configured secret via the existing `SecretResolver`
 * chain (so operators keep the same `env:` / `file:` / future
 * provider-prefixed shapes), then hands off to {@link
 * buildLangchainEmbedder}. The factory is the seam tests mock.
 */

import type { EmbeddingConfig } from "../control-plane/types.js";
import { mockEmbed } from "../drivers/mock/store.js";
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

/**
 * Sentinel provider name that yields a deterministic, network-free
 * embedder built around {@link mockEmbed}. Mirrors the mock vector
 * store driver: not for production data, but the same opt-in shape
 * an operator already uses for the rest of the mock stack. The E2E
 * suite (`apps/web/e2e/golden-path.spec.ts`) drives the
 * embed-then-search dispatch through this provider so text + hybrid
 * lanes are exercised end-to-end without provisioning real
 * credentials.
 */
const MOCK_EMBEDDING_PROVIDER = "mock";

function buildMockEmbedder(config: EmbeddingConfig): Embedder {
	return {
		id: `mock:${config.model}`,
		dimension: config.dimension,
		async embed(text) {
			return mockEmbed(text, config.dimension);
		},
		async embedMany(texts) {
			return texts.map((t) => mockEmbed(t, config.dimension));
		},
	};
}

export function makeEmbedderFactory(
	deps: EmbedderFactoryDeps,
): EmbedderFactory {
	return {
		async forConfig(config) {
			if (config.provider === MOCK_EMBEDDING_PROVIDER) {
				// No secret resolution: the mock provider explicitly
				// declines to call any backend. Operators who set this in
				// production are opting out of real retrieval.
				return buildMockEmbedder(config);
			}
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
