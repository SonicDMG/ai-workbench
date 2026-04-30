import { describe, expect, test } from "vitest";
import type { EmbeddingConfig } from "../../../src/control-plane/types.js";
import {
	isVectorizeNotConfigured,
	resolveVectorizeService,
} from "../../../src/drivers/astra/vectorize.js";

function cfg(overrides?: Partial<EmbeddingConfig>): EmbeddingConfig {
	return {
		provider: "openai",
		model: "text-embedding-3-small",
		endpoint: null,
		dimension: 1536,
		secretRef: "env:OPENAI_API_KEY",
		...overrides,
	};
}

describe("resolveVectorizeService", () => {
	test("returns provider + modelName for a supported provider with a secretRef", () => {
		const svc = resolveVectorizeService(cfg());
		expect(svc).toEqual({
			provider: "openai",
			modelName: "text-embedding-3-small",
		});
	});

	test("returns null when the provider isn't on the allowlist", () => {
		expect(resolveVectorizeService(cfg({ provider: "homegrown" }))).toBe(null);
	});

	test("returns the service block even when no secretRef is configured", () => {
		// Astra ships KMS-managed credentials for bundled NIM providers,
		// so a missing secretRef is the correct shape — the runtime omits
		// the `x-embedding-api-key` header and Astra resolves auth from
		// its KMS. If KMS isn't configured Astra returns 401, which the
		// driver surfaces as a clear error.
		expect(resolveVectorizeService(cfg({ secretRef: null }))).toEqual({
			provider: "openai",
			modelName: "text-embedding-3-small",
		});
	});

	test("supports the multi-provider allowlist", () => {
		const providers = [
			"openai",
			"cohere",
			"jinaAI",
			"mistral",
			"nvidia",
			"voyageAI",
			"azureOpenAI",
		];
		for (const provider of providers) {
			expect(resolveVectorizeService(cfg({ provider, model: "any" }))).toEqual({
				provider,
				modelName: "any",
			});
		}
	});
});

describe("isVectorizeNotConfigured", () => {
	test("matches an Astra error code containing VECTORIZE", () => {
		expect(
			isVectorizeNotConfigured({
				errorCode: "COLLECTION_VECTORIZE_NOT_CONFIGURED",
			}),
		).toBe(true);
		expect(isVectorizeNotConfigured({ code: "vectorize_disabled" })).toBe(true);
	});

	test("matches an Astra error message about $vectorize being unavailable", () => {
		expect(
			isVectorizeNotConfigured({
				message: "Field $vectorize is not supported on this collection",
			}),
		).toBe(true);
		expect(
			isVectorizeNotConfigured({
				message: "vectorize service is not configured for this collection",
			}),
		).toBe(true);
	});

	test("does not match unrelated errors", () => {
		expect(isVectorizeNotConfigured(new Error("network reset"))).toBe(false);
		expect(isVectorizeNotConfigured({ message: "bad token" })).toBe(false);
		expect(isVectorizeNotConfigured(null)).toBe(false);
		expect(isVectorizeNotConfigured("string")).toBe(false);
	});
});
