import { describe, expect, test } from "vitest";
import type { EmbeddingConfig } from "../../src/control-plane/types.js";
import { makeEmbedderFactory } from "../../src/embeddings/factory.js";
import { EmbedderUnavailableError } from "../../src/embeddings/types.js";
import { SecretResolver } from "../../src/secrets/provider.js";

function cfg(overrides?: Partial<EmbeddingConfig>): EmbeddingConfig {
	return {
		provider: "openai",
		model: "text-embedding-3-small",
		endpoint: null,
		dimension: 1536,
		secretRef: "env:DOES_NOT_EXIST",
		...overrides,
	};
}

function resolverWith(map: Record<string, string> = {}): SecretResolver {
	return new SecretResolver({
		env: {
			resolve(path: string): Promise<string> {
				const v = map[path];
				if (v === undefined) {
					return Promise.reject(new Error(`missing env '${path}'`));
				}
				return Promise.resolve(v);
			},
		},
	});
}

describe("EmbedderFactory.forConfig", () => {
	test("throws when the descriptor has no secretRef", async () => {
		const factory = makeEmbedderFactory({ secrets: resolverWith() });
		await expect(
			factory.forConfig(cfg({ secretRef: null })),
		).rejects.toBeInstanceOf(EmbedderUnavailableError);
	});

	test("throws when the secret can't be resolved", async () => {
		const factory = makeEmbedderFactory({ secrets: resolverWith() });
		await expect(factory.forConfig(cfg())).rejects.toBeInstanceOf(
			EmbedderUnavailableError,
		);
	});

	test("throws for unknown provider", async () => {
		const factory = makeEmbedderFactory({
			secrets: resolverWith({ DOES_NOT_EXIST: "sk-test" }),
		});
		await expect(
			factory.forConfig(cfg({ provider: "voyageai" })),
		).rejects.toBeInstanceOf(EmbedderUnavailableError);
	});

	test("returns an Embedder with the configured id and dimension for openai", async () => {
		const factory = makeEmbedderFactory({
			secrets: resolverWith({ DOES_NOT_EXIST: "sk-test" }),
		});
		const e = await factory.forConfig(cfg());
		expect(e.id).toBe("openai:text-embedding-3-small");
		expect(e.dimension).toBe(1536);
		// We intentionally don't call e.embed() here — that would hit
		// the real OpenAI API. End-to-end coverage of the embed path
		// belongs in an integration test against a stub server.
	});

	test("returns an Embedder for cohere", async () => {
		const factory = makeEmbedderFactory({
			secrets: resolverWith({ DOES_NOT_EXIST: "co-test" }),
		});
		const e = await factory.forConfig(
			cfg({
				provider: "cohere",
				model: "embed-v4.0",
				dimension: 1024,
			}),
		);
		expect(e.id).toBe("cohere:embed-v4.0");
		expect(e.dimension).toBe(1024);
	});
});
