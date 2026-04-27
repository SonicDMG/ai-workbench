import { describe, expect, test } from "vitest";
import { LineChunker } from "../../src/ingest/line-chunker.js";
import { runChunkerContractSuite } from "./chunker-contract.js";

runChunkerContractSuite({
	label: "LineChunker",
	build: (opts) => new LineChunker(opts),
});

describe("LineChunker — strategy-specific", () => {
	test("never splits mid-line for lines that fit within maxChars", () => {
		const chunker = new LineChunker({
			maxChars: 50,
			minChars: 0,
			overlapChars: 0,
		});
		const text = "alpha,1\nbravo,2\ncharlie,3\ndelta,4\n";
		const chunks = chunker.chunk({ text });
		for (const chunk of chunks) {
			// Every chunk must end on a `\n` (no mid-line splits).
			expect(chunk.text.endsWith("\n")).toBe(true);
		}
	});

	test("groups multiple short lines into one chunk up to maxChars", () => {
		const chunker = new LineChunker({
			maxChars: 30,
			minChars: 0,
			overlapChars: 0,
		});
		const text = "one\ntwo\nthree\nfour\nfive\nsix\n";
		const chunks = chunker.chunk({ text });
		expect(chunks.length).toBeGreaterThan(0);
		// First chunk should pack as many whole lines as fit; with 30 chars
		// available and ~4-char lines we expect several lines bundled.
		const first = chunks[0];
		expect(first).toBeDefined();
		if (!first) return;
		expect(first.text.split("\n").filter(Boolean).length).toBeGreaterThan(1);
	});

	test("hard-splits a single line longer than maxChars", () => {
		const chunker = new LineChunker({
			maxChars: 10,
			minChars: 0,
			overlapChars: 0,
		});
		const text = "abcdefghijklmnopqrstuvwxyz";
		const chunks = chunker.chunk({ text });
		for (const chunk of chunks) {
			expect(chunk.text.length).toBeLessThanOrEqual(10);
		}
		// Concatenating non-overlapping pieces reproduces the input.
		expect(chunks.map((c) => c.text).join("")).toBe(text);
	});

	test("CSV: each chunk contains whole rows only", () => {
		const chunker = new LineChunker({
			maxChars: 100,
			minChars: 0,
			overlapChars: 0,
		});
		const csv = ["id,name,score", "1,alice,90", "2,bob,87", "3,carol,93"].join(
			"\n",
		);
		const chunks = chunker.chunk({ text: csv });
		for (const chunk of chunks) {
			for (const row of chunk.text.split("\n")) {
				if (row.length === 0) continue;
				// Every non-empty row should have the expected column count.
				expect(row.split(",").length).toBe(3);
			}
		}
	});
});
