/**
 * Plain-text fallback extractor. Used when the upload is already
 * text/* (or a known text extension) and the caller asked the
 * native pipeline for it — the docling path skips this and goes
 * straight to docling-serve so the user still gets layout-aware
 * markdown if they want it.
 *
 * UTF-8 only by design. If a caller needs other encodings (latin-1,
 * cp1252, etc.) they should transcode upstream — the rest of the
 * pipeline (chunker, embedder, vector store) is built around UTF-8
 * and treating bytes as anything else here would just push the
 * mojibake further down the line.
 */

import {
	ExtractError,
	type ExtractedDocument,
	type ExtractInput,
} from "./types.js";

const FATAL_DECODER = new TextDecoder("utf-8", { fatal: true });

export function extractText(input: ExtractInput): ExtractedDocument {
	let text: string;
	try {
		text = FATAL_DECODER.decode(input.bytes);
	} catch (err) {
		throw new ExtractError(
			"extraction_failed",
			`could not decode "${input.filename}" as UTF-8`,
			{ cause: err },
		);
	}
	if (text.length === 0) {
		throw new ExtractError(
			"empty_document",
			`"${input.filename}" decoded to empty text`,
		);
	}
	return { text, parser: "native" };
}
