/**
 * Reference {@link Chunker} implementation — a greedy splitter that
 * honors natural text boundaries where it can and hard-splits where
 * it can't.
 *
 * Algorithm (char-based, single pass):
 *
 *   1. Walk the input left to right from a cursor `pos`.
 *   2. Look ahead up to `maxChars` and find the latest separator in
 *      the window `[pos + minChars, pos + maxChars]` in priority
 *      order: `\n\n` > `\n` > `. ` > `? ` > `! ` > ` `. Split
 *      immediately after it. If none, hard-split at `pos + maxChars`.
 *   3. Emit the chunk spanning `[pos, end)`.
 *   4. Rewind: `pos = end - overlapChars` (but at least `pos + 1` to
 *      guarantee progress). That makes the next chunk's `startChar`
 *      land `overlapChars` before the previous chunk's end — the
 *      overlap is achieved without ever violating maxChars.
 *   5. If the final chunk is shorter than `minChars` AND the previous
 *      chunk has room to absorb it within `maxChars`, merge. Otherwise
 *      keep the short tail as its own chunk.
 *
 * Every design choice is a seam, not a promise — callers should not
 * depend on the exact split points. Token-based chunkers and model-
 * aware splitters will ship as additional {@link Chunker} impls.
 */

import {
	type Chunk,
	type Chunker,
	type ChunkerInput,
	type ChunkerOptions,
	type ResolvedChunkerOptions,
	resolveChunkerOptions,
} from "./chunker.js";

/** Priority-ordered list of separator strings. Earlier entries are
 * preferred split points. The empty-string fallback is implicit — no
 * separator found means hard-split at maxChars. */
const SEPARATORS: readonly string[] = ["\n\n", "\n", ". ", "? ", "! ", " "];

interface Span {
	readonly start: number;
	readonly end: number;
}

export class RecursiveCharacterChunker implements Chunker {
	readonly id = "recursive-char:1";
	private readonly opts: ResolvedChunkerOptions;

	constructor(opts?: ChunkerOptions) {
		this.opts = resolveChunkerOptions(opts);
	}

	chunk(input: ChunkerInput): readonly Chunk[] {
		const text = input.text;
		if (text.length === 0) return [];

		const spans = this.computeSpans(text);
		return this.emitChunks(text, spans, input.metadata ?? {});
	}

	private computeSpans(text: string): readonly Span[] {
		const { maxChars, minChars, overlapChars } = this.opts;
		const spans: Span[] = [];
		let pos = 0;
		// The previous chunk's endChar + 1 — any new chunk must end
		// strictly past this to make progress. Starts at 1 so the first
		// chunk's end is at least 1.
		let minEnd = 1;
		while (pos < text.length) {
			const maxEnd = Math.min(pos + maxChars, text.length);
			const end =
				maxEnd === text.length
					? text.length
					: findSplitPoint(
							text,
							Math.max(pos + minChars, pos + 1, minEnd),
							maxEnd,
						);
			spans.push({ start: pos, end });
			if (end === text.length) break;
			minEnd = end + 1;
			// Rewind for overlap; guarantee strict positional progress
			// too (pos must still advance even when overlap would pull
			// it back over the previous start).
			pos = Math.max(end - overlapChars, pos + 1);
		}

		// Tail-merge: if the last chunk is too short, try to absorb it
		// into its predecessor — but only if the merged span still fits
		// in maxChars. Otherwise keep the short tail so maxChars stays
		// honored on every chunk.
		const prev = spans[spans.length - 2];
		const last = spans[spans.length - 1];
		if (
			prev !== undefined &&
			last !== undefined &&
			last.end - last.start < minChars &&
			last.end - prev.start <= maxChars
		) {
			spans.splice(spans.length - 2, 2, {
				start: prev.start,
				end: last.end,
			});
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
 * Find the end index (exclusive) of the next segment.
 *
 * Scans the substring `text[windowStart..maxEnd]` for separators in
 * priority order. Returns the index immediately after the highest-
 * priority separator found. Falls back to `maxEnd` (hard split) when
 * no separator exists in the window.
 */
function findSplitPoint(
	text: string,
	windowStart: number,
	maxEnd: number,
): number {
	for (const sep of SEPARATORS) {
		// lastIndexOf stops searching at the given index, and the
		// range is inclusive — constrain with the explicit upper
		// bound.
		const hit = text.lastIndexOf(sep, maxEnd - sep.length);
		if (hit >= windowStart) {
			return hit + sep.length;
		}
	}
	return maxEnd;
}
