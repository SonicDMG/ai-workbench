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

	test("CSV with \\r\\n (Windows / Excel) splits at the \\n boundary", () => {
		const chunker = new LineChunker({
			maxChars: 30,
			minChars: 0,
			overlapChars: 0,
		});
		const csv = "id,name,score\r\n1,alice,90\r\n2,bob,87\r\n3,carol,93\r\n";
		const chunks = chunker.chunk({ text: csv });
		expect(chunks.length).toBeGreaterThan(1);
		// Each chunk must end on a complete line terminator (`\r\n` here).
		for (const chunk of chunks) {
			expect(chunk.text.endsWith("\r\n")).toBe(true);
		}
		// Every non-empty row inside a chunk has the expected column count.
		for (const chunk of chunks) {
			for (const row of chunk.text.replace(/\r\n$/, "").split("\r\n")) {
				if (row.length === 0) continue;
				expect(row.split(",").length).toBe(3);
			}
		}
	});

	test("CSV with lone \\r (classic Mac) splits at the \\r boundary", () => {
		const chunker = new LineChunker({
			maxChars: 30,
			minChars: 0,
			overlapChars: 0,
		});
		// Old-Mac / some legacy exports use a bare `\r` as the row
		// terminator. The chunker MUST recognise it, otherwise the whole
		// file collapses into one mega-line and the chunker hard-splits
		// mid-row — surprising to users who chose "line-based" exactly to
		// keep rows intact.
		const csv = "id,name,score\r1,alice,90\r2,bob,87\r3,carol,93\r";
		const chunks = chunker.chunk({ text: csv });
		expect(chunks.length).toBeGreaterThan(1);
		for (const chunk of chunks) {
			expect(chunk.text.endsWith("\r")).toBe(true);
			for (const row of chunk.text.replace(/\r$/, "").split("\r")) {
				if (row.length === 0) continue;
				expect(row.split(",").length).toBe(3);
			}
		}
	});

	test("small CSV that fits inside maxChars is intentionally a single chunk", () => {
		// Documents the expected behaviour: the line chunker bundles
		// consecutive lines up to maxChars. A tiny CSV under the limit
		// produces one chunk — that is correct, not a bug. Pin it so a
		// future change can't quietly turn it into per-row chunks without
		// updating this test.
		const chunker = new LineChunker({
			maxChars: 1000,
			minChars: 0,
			overlapChars: 0,
		});
		const csv = "id,name,score\n1,alice,90\n2,bob,87\n3,carol,93\n";
		const chunks = chunker.chunk({ text: csv });
		expect(chunks).toHaveLength(1);
		expect(chunks[0]?.text).toBe(csv);
	});

	test("maxLines=1 produces exactly one chunk per logical line", () => {
		// This is the line-rows-1 preset's load-bearing invariant. A small
		// CSV with N rows must produce N chunks regardless of whether the
		// whole file fits inside maxChars — every row is its own
		// retrievable record.
		const chunker = new LineChunker({
			maxChars: 1000,
			minChars: 0,
			overlapChars: 0,
			maxLines: 1,
		});
		const csv = "id,name,score\n1,alice,90\n2,bob,87\n3,carol,93\n";
		const chunks = chunker.chunk({ text: csv });
		expect(chunks).toHaveLength(4);
		expect(chunks.map((c) => c.text)).toEqual([
			"id,name,score\n",
			"1,alice,90\n",
			"2,bob,87\n",
			"3,carol,93\n",
		]);
	});

	test("maxLines=1 also splits CRLF and lone-CR endings one row per chunk", () => {
		const chunker = new LineChunker({
			maxChars: 1000,
			minChars: 0,
			overlapChars: 0,
			maxLines: 1,
		});
		const crlf = "a\r\nb\r\nc\r\n";
		const cr = "a\rb\rc\r";
		expect(chunker.chunk({ text: crlf }).map((c) => c.text)).toEqual([
			"a\r\n",
			"b\r\n",
			"c\r\n",
		]);
		expect(chunker.chunk({ text: cr }).map((c) => c.text)).toEqual([
			"a\r",
			"b\r",
			"c\r",
		]);
	});

	test("maxLines>1 packs that many rows per chunk (still capped by maxChars)", () => {
		const chunker = new LineChunker({
			maxChars: 1000,
			minChars: 0,
			overlapChars: 0,
			maxLines: 2,
		});
		const csv = "a\nb\nc\nd\ne\n";
		const chunks = chunker.chunk({ text: csv });
		expect(chunks.map((c) => c.text)).toEqual(["a\nb\n", "c\nd\n", "e\n"]);
	});

	test("maxLines is rejected when <= 0", () => {
		expect(
			() =>
				new LineChunker({
					maxChars: 100,
					minChars: 0,
					overlapChars: 0,
					maxLines: 0,
				}),
		).toThrow(/maxLines/);
	});
});
