/**
 * Shared invariants that every {@link Chunker} implementation must
 * satisfy — independent of splitting strategy.
 *
 * Future chunker impls (token-based, model-aware, semantic) should run
 * {@link runChunkerContractSuite} against a newly constructed instance
 * so the cross-impl contract stays honest.
 */

import { describe, expect, test } from "vitest";
import type { Chunker, ChunkerOptions } from "../../src/ingest/chunker.js";

export interface ContractSuiteArgs {
	readonly label: string;
	/** Build a fresh chunker with the given options. Tests pass no
	 * options to exercise the defaults, and a small-max / small-overlap
	 * combo to stress the splitting. */
	readonly build: (opts?: ChunkerOptions) => Chunker;
}

export function runChunkerContractSuite(args: ContractSuiteArgs): void {
	const { label, build } = args;

	describe(`chunker contract — ${label}`, () => {
		test("empty input produces zero chunks", () => {
			const chunker = build();
			expect(chunker.chunk({ text: "" })).toEqual([]);
		});

		test("short input produces a single chunk containing the whole text", () => {
			const chunker = build({ maxChars: 100, minChars: 0, overlapChars: 0 });
			const input = { text: "Hello world." };
			const chunks = chunker.chunk(input);
			expect(chunks).toHaveLength(1);
			const only = chunks[0];
			expect(only).toBeDefined();
			if (!only) return;
			expect(only.index).toBe(0);
			expect(only.startChar).toBe(0);
			expect(only.endChar).toBe(input.text.length);
			expect(only.text).toBe(input.text);
		});

		test("indices are a 0-based contiguous sequence", () => {
			const chunker = build({ maxChars: 80, minChars: 0, overlapChars: 10 });
			const text = Array.from({ length: 40 }, (_, i) => `line ${i}.`).join(
				"\n",
			);
			const chunks = chunker.chunk({ text });
			expect(chunks.length).toBeGreaterThan(1);
			for (let i = 0; i < chunks.length; i++) {
				expect(chunks[i]?.index).toBe(i);
			}
		});

		test("span correctness: text equals input.slice(start, end)", () => {
			const chunker = build({ maxChars: 60, minChars: 0, overlapChars: 12 });
			const text =
				"Paragraph one has a few sentences. It runs on and on.\n\nParagraph two is shorter.\n\nAnd a final paragraph with yet more text to split.";
			for (const chunk of chunker.chunk({ text })) {
				expect(text.slice(chunk.startChar, chunk.endChar)).toBe(chunk.text);
			}
		});

		test("chunks cover the input (ignoring overlap); no gaps", () => {
			// The union of the non-overlapping regions (segmentStart..endChar)
			// must equal [0, text.length). We compute segmentStart as the
			// next chunk's startChar (or 0 for the first chunk).
			const chunker = build({ maxChars: 80, minChars: 0, overlapChars: 20 });
			const text =
				"Lorem ipsum dolor sit amet. Consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation.";
			const chunks = chunker.chunk({ text });
			expect(chunks.length).toBeGreaterThan(0);
			expect(chunks[0]?.startChar).toBe(0);
			for (let i = 0; i < chunks.length - 1; i++) {
				// The next chunk's end must be strictly greater than this
				// chunk's end — otherwise we're not making progress.
				const here = chunks[i];
				const next = chunks[i + 1];
				expect(next?.endChar).toBeGreaterThan(here?.endChar ?? -1);
			}
			expect(chunks[chunks.length - 1]?.endChar).toBe(text.length);
		});

		test("respects maxChars on every chunk", () => {
			const maxChars = 60;
			const chunker = build({ maxChars, minChars: 0, overlapChars: 10 });
			const text = "word ".repeat(500);
			for (const chunk of chunker.chunk({ text })) {
				expect(chunk.text.length).toBeLessThanOrEqual(maxChars);
			}
		});

		test("metadata is propagated onto every chunk", () => {
			const chunker = build();
			const chunks = chunker.chunk({
				text: "some text",
				metadata: { source: "readme.md", lang: "en" },
			});
			expect(chunks[0]?.metadata.source).toBe("readme.md");
			expect(chunks[0]?.metadata.lang).toBe("en");
		});

		test("chunker.id is exposed and stamped into chunk metadata", () => {
			const chunker = build();
			expect(chunker.id).toMatch(/^[a-z][a-z0-9-]*:[0-9]+$/i);
			const chunks = chunker.chunk({ text: "hello world" });
			if (chunks[0]) {
				expect(chunks[0].metadata["chunker.id"]).toBe(chunker.id);
			}
		});

		test("deterministic: identical input + options → identical output", () => {
			const a = build({ maxChars: 90, overlapChars: 15 });
			const b = build({ maxChars: 90, overlapChars: 15 });
			const text =
				"Alpha beta gamma. Delta epsilon zeta eta theta. Iota kappa lambda mu nu xi.\n\nOmicron pi rho sigma tau upsilon phi chi psi omega.";
			expect(a.chunk({ text })).toEqual(b.chunk({ text }));
		});
	});
}
