/**
 * Test-only {@link EmbedderFactory} that never touches the network.
 * Produces deterministic unit-norm vectors from the input text so
 * tests can exercise the embed-then-search dispatch without Vercel
 * SDK mocking.
 */

import type { EmbeddingConfig } from "../../src/control-plane/types.js";
import { mockEmbed } from "../../src/drivers/mock/store.js";
import type { EmbedderFactory } from "../../src/embeddings/factory.js";
import {
	type Embedder,
	EmbedderUnavailableError,
} from "../../src/embeddings/types.js";

export interface FakeEmbedderFactoryOptions {
	readonly unavailable?: boolean;
	readonly wrongDimension?: number;
}

export function makeFakeEmbedderFactory(
	opts: FakeEmbedderFactoryOptions = {},
): EmbedderFactory {
	return {
		async forConfig(config: EmbeddingConfig): Promise<Embedder> {
			if (opts.unavailable) {
				throw new EmbedderUnavailableError(
					config.provider,
					"unavailable (test)",
				);
			}
			const dim = opts.wrongDimension ?? config.dimension;
			return {
				id: `fake:${config.provider}:${config.model}`,
				dimension: dim,
				async embed(text: string) {
					return mockEmbed(text, dim);
				},
				async embedMany(texts: readonly string[]) {
					return texts.map((t) => mockEmbed(t, dim));
				},
			};
		},
	};
}
