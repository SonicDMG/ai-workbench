/**
 * Chunker contract — turns a source document's text into a sequence of
 * overlapping chunks suitable for embedding and upsert into a vector
 * store.
 *
 * The seam is deliberately narrow: one input, one output. All tuning
 * (target size, overlap, minimum) lives in a per-run {@link
 * ChunkerOptions} shape so routes and callers can override per catalog
 * later without widening the interface.
 *
 * Two properties every concrete impl MUST preserve, checked by the
 * shared contract suite in `tests/ingest/chunker-contract.ts`:
 *
 *   1. **Stable indices.** `chunk(input).map(c => c.index)` is
 *      `[0, 1, 2, …]` — callers rely on it for deterministic record
 *      ids (`${documentUid}:${index}`).
 *   2. **Span correctness.** For every chunk,
 *      `input.text.slice(startChar, endChar) === chunk.text`. Overlap
 *      is baked into `startChar`, not appended to `text` out of band.
 *
 * Callers shouldn't depend on the specific splitting strategy — that
 * can change between versions of a single chunker and certainly
 * between chunker impls.
 */

/** One unit of text to be chunked. */
export interface ChunkerInput {
	readonly text: string;
	/** Metadata copied onto every resulting chunk. Chunker impls may
	 * add their own keys (e.g. `chunker.id`) but MUST NOT remove
	 * caller-supplied keys. */
	readonly metadata?: Readonly<Record<string, string>>;
}

/** One slice of a document, ready to be embedded. */
export interface Chunk {
	/** 0-based position within the input. */
	readonly index: number;
	readonly text: string;
	/** Inclusive char offset in the original input.text. */
	readonly startChar: number;
	/** Exclusive char offset in the original input.text. */
	readonly endChar: number;
	/** Caller metadata + chunker-added keys. Always present — empty
	 * object if the caller passed no metadata. */
	readonly metadata: Readonly<Record<string, string>>;
}

/** Tuning knobs. Units are characters; token-based chunkers can ship
 * their own options type alongside their impl. */
export interface ChunkerOptions {
	/** Target maximum chars per chunk. Hard-split may still produce
	 * a chunk at this exact size. Default 1000. */
	readonly maxChars?: number;
	/** Minimum chars for a chunk — shorter chunks at the tail are
	 * merged into the previous chunk. Default 100. */
	readonly minChars?: number;
	/** Overlap prepended from the previous chunk's tail. 0 disables.
	 * Default 150. Must be < maxChars. */
	readonly overlapChars?: number;
}

export interface Chunker {
	/** Identifier for logs / provenance. Shape is
	 * `<strategy>:<version>` — e.g. `recursive-char:1`. */
	readonly id: string;

	/** Produce a deterministic sequence of chunks for `input`. Must
	 * be pure with respect to `input` and the options passed at
	 * construction time — no I/O, no randomness. */
	chunk(input: ChunkerInput): readonly Chunk[];
}

/**
 * Normalize / validate options at construction time so callers fail
 * fast on nonsense (overlap ≥ max, negative min, etc.) rather than
 * mid-chunk.
 */
export interface ResolvedChunkerOptions {
	readonly maxChars: number;
	readonly minChars: number;
	readonly overlapChars: number;
}

export function resolveChunkerOptions(
	opts: ChunkerOptions | undefined,
): ResolvedChunkerOptions {
	const maxChars = opts?.maxChars ?? 1000;
	if (maxChars <= 0) {
		throw new ChunkerConfigError(`maxChars must be > 0 (got ${maxChars})`);
	}

	// Scale `minChars` and `overlapChars` relative to `maxChars` when
	// left at defaults — caller passes a tiny maxChars for tests or
	// short-form content and expects the other knobs to follow.
	const minChars = opts?.minChars ?? Math.min(100, Math.floor(maxChars / 4));
	const overlapChars =
		opts?.overlapChars ?? Math.min(150, Math.floor(maxChars / 6));

	if (minChars < 0) {
		throw new ChunkerConfigError(`minChars must be >= 0 (got ${minChars})`);
	}
	if (overlapChars < 0) {
		throw new ChunkerConfigError(
			`overlapChars must be >= 0 (got ${overlapChars})`,
		);
	}
	if (overlapChars >= maxChars) {
		throw new ChunkerConfigError(
			`overlapChars (${overlapChars}) must be < maxChars (${maxChars})`,
		);
	}
	if (minChars >= maxChars) {
		throw new ChunkerConfigError(
			`minChars (${minChars}) must be < maxChars (${maxChars})`,
		);
	}
	return { maxChars, minChars, overlapChars };
}

/** Thrown by chunker constructors when {@link ChunkerOptions} are
 * internally inconsistent. Surfaces as a startup / config error, not a
 * per-request 400. */
export class ChunkerConfigError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "ChunkerConfigError";
	}
}
