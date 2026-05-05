/**
 * Native `.docx` text extraction via `mammoth`.
 *
 * `extractRawText` walks the document body and returns plain text —
 * paragraph breaks preserved, runs/styles flattened. Tables become
 * tab-separated lines, lists become indented bullets. Good enough for
 * RAG chunking on most prose documents (briefs, reports, articles).
 *
 * Legacy `.doc` (binary OLE) is intentionally not supported here —
 * the open-source toolchain for it is fragile and the modern `.docx`
 * format has been the default in Word for fifteen years. Operators
 * with old `.doc` content should convert it to `.docx` upstream or
 * route through docling-serve, which handles both.
 */

import {
	ExtractError,
	type ExtractedDocument,
	type ExtractInput,
} from "./types.js";

interface MammothMessage {
	readonly type: string;
	readonly message: string;
}
interface MammothResult {
	readonly value: string;
	readonly messages: ReadonlyArray<MammothMessage>;
}
interface MammothModule {
	extractRawText(input: { arrayBuffer: ArrayBuffer }): Promise<MammothResult>;
}

let mammothPromise: Promise<MammothModule> | null = null;

async function loadMammoth(): Promise<MammothModule> {
	if (!mammothPromise) {
		// `mammoth` ships CommonJS-only — interop via `default`.
		mammothPromise = import("mammoth").then(
			(mod) =>
				(mod as unknown as { default?: MammothModule }).default ??
				(mod as unknown as MammothModule),
		);
	}
	return mammothPromise;
}

export async function extractDocx(
	input: ExtractInput,
): Promise<ExtractedDocument> {
	const mammoth = await loadMammoth();
	let result: MammothResult;
	try {
		// Slice the underlying buffer to the exact byte range — the
		// multipart parser hands us a Uint8Array view that may share a
		// larger ArrayBuffer with other form fields.
		const ab = input.bytes.buffer.slice(
			input.bytes.byteOffset,
			input.bytes.byteOffset + input.bytes.byteLength,
		);
		result = await mammoth.extractRawText({ arrayBuffer: ab as ArrayBuffer });
	} catch (err) {
		throw new ExtractError(
			"extraction_failed",
			`could not extract text from "${input.filename}": ${
				err instanceof Error ? err.message : String(err)
			}`,
			{ cause: err },
		);
	}
	const text = result.value.trim();
	if (text.length === 0) {
		throw new ExtractError(
			"empty_document",
			`"${input.filename}" yielded no extractable text`,
		);
	}
	return {
		text,
		parser: "native",
		parserVersion: "mammoth",
	};
}
