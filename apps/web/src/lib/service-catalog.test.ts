import { describe, expect, test } from "vitest";
import {
	CHUNKING_ENGINES,
	CHUNKING_PRESETS,
	CHUNKING_STRATEGIES,
	CUSTOM_OPTION,
	EMBEDDING_MODELS,
	EMBEDDING_PRESETS,
	EMBEDDING_PROVIDERS,
	RERANKING_PROVIDERS,
} from "./service-catalog";

describe("service catalog", () => {
	test("ships at least one preset per service kind", () => {
		expect(EMBEDDING_PRESETS.length).toBeGreaterThan(0);
		expect(CHUNKING_PRESETS.length).toBeGreaterThan(0);
	});

	test("preset names mirror runtime defaults (parity check)", () => {
		// The runtime's `DEFAULT_SERVICES` lives in
		// `runtimes/typescript/src/control-plane/default-services.ts`.
		// The UI doesn't import from the runtime workspace — keep the
		// names pinned here so a drift on either side fails CI.
		expect(EMBEDDING_PRESETS.map((p) => p.id).sort()).toEqual([
			"cohere-embed-v4-multilingual",
			"openai-text-embedding-3-large",
			"openai-text-embedding-3-small",
		]);
		expect(CHUNKING_PRESETS.map((p) => p.id).sort()).toEqual([
			"line-2000",
			"recursive-char-1000",
		]);
	});

	test("default embedding preset is openai 3-small", () => {
		const first = EMBEDDING_PRESETS[0];
		expect(first?.input.provider).toBe("openai");
		expect(first?.input.modelName).toBe("text-embedding-3-small");
		expect(first?.input.embeddingDimension).toBe(1536);
		expect(first?.input.credentialRef).toBe("env:OPENAI_API_KEY");
	});

	test("default chunking preset is recursive char (1000/150)", () => {
		const first = CHUNKING_PRESETS[0];
		expect(first?.input.engine).toBe("langchain_ts");
		expect(first?.input.strategy).toBe("recursive");
		expect(first?.input.maxChunkSize).toBe(1000);
		expect(first?.input.overlapSize).toBe(150);
	});

	test("every embedding preset's provider+model is in the picker catalog", () => {
		for (const preset of EMBEDDING_PRESETS) {
			expect(
				EMBEDDING_PROVIDERS.some((p) => p.value === preset.input.provider),
			).toBe(true);
			expect(
				EMBEDDING_MODELS[preset.input.provider]?.some(
					(m) => m.value === preset.input.modelName,
				),
			).toBe(true);
		}
	});

	test("every chunking preset's engine+strategy is in the picker catalog", () => {
		for (const preset of CHUNKING_PRESETS) {
			expect(
				CHUNKING_ENGINES.some((e) => e.value === preset.input.engine),
			).toBe(true);
			if (preset.input.strategy) {
				expect(
					CHUNKING_STRATEGIES[preset.input.engine]?.some(
						(s) => s.value === preset.input.strategy,
					),
				).toBe(true);
			}
		}
	});

	test("CUSTOM_OPTION sentinel does not collide with any real value", () => {
		const all = new Set<string>();
		for (const p of EMBEDDING_PROVIDERS) all.add(p.value);
		for (const list of Object.values(EMBEDDING_MODELS))
			for (const m of list) all.add(m.value);
		for (const e of CHUNKING_ENGINES) all.add(e.value);
		for (const list of Object.values(CHUNKING_STRATEGIES))
			for (const s of list) all.add(s.value);
		for (const p of RERANKING_PROVIDERS) all.add(p.value);
		expect(all.has(CUSTOM_OPTION)).toBe(false);
	});
});
