import { describe, expect, test } from "vitest";
import {
	ChunkerConfigError,
	resolveChunkerOptions,
} from "../../src/ingest/chunker.js";
import { RecursiveCharacterChunker } from "../../src/ingest/recursive-chunker.js";
import { runChunkerContractSuite } from "./chunker-contract.js";

runChunkerContractSuite({
	label: "RecursiveCharacterChunker",
	build: (opts) => new RecursiveCharacterChunker(opts),
});

describe("RecursiveCharacterChunker — strategy-specific", () => {
	test("prefers paragraph boundaries when one fits the window", () => {
		const chunker = new RecursiveCharacterChunker({
			maxChars: 60,
			minChars: 0,
			overlapChars: 0,
		});
		// The text is longer than maxChars so a split is required. The
		// highest-priority separator within the window is "\n\n" at
		// index 24 — the first chunk should end there (endChar === 26).
		const text =
			"First paragraph here one.\n\nAnother much longer paragraph that keeps going well past sixty chars so we force a split.";
		const chunks = chunker.chunk({ text });
		expect(chunks[0]?.endChar).toBe(27);
		expect(chunks[0]?.text).toBe("First paragraph here one.\n\n");
	});

	test("falls back to sentence boundary when no paragraph break fits", () => {
		const chunker = new RecursiveCharacterChunker({
			maxChars: 40,
			minChars: 0,
			overlapChars: 0,
		});
		const text = "Sentence one is here. Sentence two follows. And three.";
		const chunks = chunker.chunk({ text });
		// Sentence break at ". " — the first chunk should end at one of
		// those, not at a hard char boundary.
		expect(chunks[0]?.text.endsWith(". ")).toBe(true);
	});

	test("hard-splits when no separator appears in the window", () => {
		const chunker = new RecursiveCharacterChunker({
			maxChars: 10,
			minChars: 0,
			overlapChars: 0,
		});
		const text = "abcdefghijklmnopqrstuvwxyz";
		const chunks = chunker.chunk({ text });
		expect(chunks.length).toBeGreaterThan(1);
		expect(chunks[0]?.text).toBe("abcdefghij");
	});

	test("applies overlap between adjacent chunks", () => {
		const chunker = new RecursiveCharacterChunker({
			maxChars: 20,
			minChars: 0,
			overlapChars: 5,
		});
		const text = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJ";
		const chunks = chunker.chunk({ text });
		expect(chunks.length).toBeGreaterThan(1);
		for (let i = 1; i < chunks.length; i++) {
			const prev = chunks[i - 1];
			const cur = chunks[i];
			if (!prev || !cur) continue;
			const prevTail = prev.text.slice(-5);
			expect(cur.text.startsWith(prevTail)).toBe(true);
		}
	});

	test("merges a too-small tail into the previous chunk", () => {
		const chunker = new RecursiveCharacterChunker({
			maxChars: 20,
			minChars: 10,
			overlapChars: 0,
		});
		// Build a text where the natural split would leave a 5-char
		// tail — should get absorbed into the previous chunk.
		const text = "aaaaaaaaaa bbbbbbbbbb ccc";
		const chunks = chunker.chunk({ text });
		const last = chunks[chunks.length - 1];
		expect(last?.endChar).toBe(text.length);
		expect(
			(last?.endChar ?? 0) - (last?.startChar ?? 0),
		).toBeGreaterThanOrEqual(10);
	});
});

describe("resolveChunkerOptions", () => {
	test("returns defaults when no options are supplied", () => {
		const resolved = resolveChunkerOptions(undefined);
		expect(resolved.maxChars).toBe(1000);
		expect(resolved.minChars).toBe(100);
		expect(resolved.overlapChars).toBe(150);
	});

	test("rejects nonsense configs", () => {
		expect(() => resolveChunkerOptions({ maxChars: 0 })).toThrow(
			ChunkerConfigError,
		);
		expect(() =>
			resolveChunkerOptions({ maxChars: 100, overlapChars: 100 }),
		).toThrow(ChunkerConfigError);
		expect(() =>
			resolveChunkerOptions({ maxChars: 100, minChars: 100 }),
		).toThrow(ChunkerConfigError);
		expect(() => resolveChunkerOptions({ minChars: -1 })).toThrow(
			ChunkerConfigError,
		);
	});
});
