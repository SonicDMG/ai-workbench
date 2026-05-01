/**
 * Line-based {@link Chunker} — groups consecutive lines until adding
 * the next line would exceed `maxChars` (or, optionally, `maxLines`),
 * then emits a chunk and (optionally) overlaps the next chunk by
 * trailing N characters that snap back to the nearest line boundary.
 *
 * Default preset for newline-delimited content: CSV (1 row per line),
 * JSONL, log files. Recognises all three common line-ending styles —
 * `\n` (Unix / modern), `\r\n` (Windows, Excel), and lone `\r` (classic
 * Mac, some legacy exports) — so the chunker stays useful regardless
 * of where the file came from. A single line longer than `maxChars`
 * is hard-split mid-line so the per-chunk size bound holds; this keeps
 * the {@link Chunker} contract honest and matches what the recursive
 * char chunker would do.
 *
 * Setting `maxLines: 1` produces exactly one chunk per logical line —
 * the seeded `line-rows-1` preset uses this for "one row = one
 * retrievable record" CSV / JSONL ingest. Larger `maxLines` values
 * pack N rows per chunk while still honoring the `maxChars` safety
 * cap.
 *
 * Hand-rolled rather than wrapped around `@langchain/textsplitters`
 * to keep the {@link Chunker} contract synchronous. Semantic /
 * model-aware splitters that genuinely need I/O will require widening
 * the contract to async — out of scope here.
 */

import {
	type Chunk,
	type Chunker,
	type ChunkerInput,
	type ChunkerOptions,
	type ResolvedChunkerOptions,
	resolveChunkerOptions,
} from "./chunker.js";

interface Span {
	readonly start: number;
	readonly end: number;
}

export class LineChunker implements Chunker {
	readonly id = "line:1";
	private readonly opts: ResolvedChunkerOptions;

	constructor(opts?: ChunkerOptions) {
		this.opts = resolveChunkerOptions(opts);
	}

	chunk(input: ChunkerInput): readonly Chunk[] {
		const text = input.text;
		if (text.length === 0) return [];

		const lines = enumerateLines(text, this.opts.maxChars);
		const spans = this.groupLinesIntoSpans(lines);
		return this.emitChunks(text, spans, input.metadata ?? {});
	}

	private groupLinesIntoSpans(lines: readonly Span[]): readonly Span[] {
		const { maxChars, maxLines, overlapChars } = this.opts;
		const spans: Span[] = [];
		let i = 0;
		while (i < lines.length) {
			const first = lines[i];
			if (!first) break;
			let end = first.end;
			let j = i + 1;
			let lineCount = 1;
			while (j < lines.length) {
				if (maxLines !== null && lineCount >= maxLines) break;
				const next = lines[j];
				if (!next) break;
				if (next.end - first.start > maxChars) break;
				end = next.end;
				j++;
				lineCount++;
			}
			spans.push({ start: first.start, end });
			if (j === lines.length) break;
			// Snap overlap to the nearest line boundary at or after
			// `end - overlapChars`. If overlap is 0 (or smaller than the
			// next line), advance to `j` so we make progress.
			i = nextLineIndex(lines, j, end - overlapChars);
		}
		return spans;
	}

	private emitChunks(
		text: string,
		spans: readonly Span[],
		baseMetadata: Readonly<Record<string, string>>,
	): readonly Chunk[] {
		return spans.map((span, i) => ({
			index: i,
			text: text.slice(span.start, span.end),
			startChar: span.start,
			endChar: span.end,
			metadata: { ...baseMetadata, "chunker.id": this.id },
		}));
	}
}

/**
 * Walk the input once and return one span per line. Each span ends
 * just past its trailing line terminator (or at `text.length` for the
 * last line), so concatenating spans reproduces the original text
 * exactly.
 *
 * A line terminator is `\n`, `\r\n`, or a lone `\r` — the three styles
 * we see in the wild for CSV / JSONL / log uploads. The trailing
 * terminator stays inside the line span so chunk text round-trips the
 * source byte-for-byte.
 *
 * Lines longer than `maxChars` are hard-split into multiple spans of
 * up to `maxChars` each, so downstream grouping never has to emit a
 * chunk that exceeds the configured limit.
 */
function enumerateLines(text: string, maxChars: number): readonly Span[] {
	const lines: Span[] = [];
	let start = 0;
	const pushLine = (s: number, e: number): void => {
		let cursor = s;
		while (e - cursor > maxChars) {
			lines.push({ start: cursor, end: cursor + maxChars });
			cursor += maxChars;
		}
		if (e > cursor) lines.push({ start: cursor, end: e });
	};
	for (let i = 0; i < text.length; i++) {
		const ch = text[i];
		if (ch === "\n") {
			pushLine(start, i + 1);
			start = i + 1;
		} else if (ch === "\r") {
			// Treat `\r\n` as a single boundary (the `\n` branch above
			// will fire on the next iteration); a lone `\r` is its own
			// boundary.
			if (text[i + 1] === "\n") continue;
			pushLine(start, i + 1);
			start = i + 1;
		}
	}
	if (start < text.length) {
		pushLine(start, text.length);
	}
	return lines;
}

/**
 * Return the smallest index `k` such that `lines[k].start >= floor`,
 * but never less than `fallback` — we always advance at least to
 * `fallback` so the outer loop makes progress even when the overlap
 * window swallows a full line.
 */
function nextLineIndex(
	lines: readonly Span[],
	fallback: number,
	floor: number,
): number {
	for (let k = 0; k < lines.length; k++) {
		const line = lines[k];
		if (line && line.start >= floor) return Math.min(k, fallback);
	}
	return fallback;
}
