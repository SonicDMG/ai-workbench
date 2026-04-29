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

	describe("provider: 'mock'", () => {
		test("returns a deterministic, network-free embedder with no secret resolution", async () => {
			// Empty resolver — there is nothing to resolve, and we must
			// not even try. The mock provider is the seam Playwright
			// uses to drive embed-then-search end-to-end.
			const factory = makeEmbedderFactory({ secrets: resolverWith() });
			const e = await factory.forConfig(
				cfg({
					provider: "mock",
					model: "fake-embedder",
					dimension: 4,
					secretRef: null,
				}),
			);
			expect(e.id).toBe("mock:fake-embedder");
			expect(e.dimension).toBe(4);
		});

		test("embeds the same text to the same vector every call (determinism)", async () => {
			const factory = makeEmbedderFactory({ secrets: resolverWith() });
			const e = await factory.forConfig(
				cfg({
					provider: "mock",
					model: "fake-embedder",
					dimension: 4,
					secretRef: null,
				}),
			);
			const a = await e.embed("the quick brown fox");
			const b = await e.embed("the quick brown fox");
			expect(a).toEqual(b);
			// Different input → different vector (collision is technically
			// possible with FNV+xorshift but vanishingly so for plain
			// English at this dimension).
			const c = await e.embed("a completely different sentence");
			expect(a).not.toEqual(c);
		});

		test("embedMany matches embed() per element so batched and per-row dispatch agree", async () => {
			const factory = makeEmbedderFactory({ secrets: resolverWith() });
			const e = await factory.forConfig(
				cfg({
					provider: "mock",
					model: "fake-embedder",
					dimension: 4,
					secretRef: null,
				}),
			);
			const texts = ["alpha document", "bravo document"];
			const batched = await e.embedMany(texts);
			const oneByOne = [
				await e.embed(texts[0] as string),
				await e.embed(texts[1] as string),
			];
			expect(batched).toEqual(oneByOne);
		});
	});
});
