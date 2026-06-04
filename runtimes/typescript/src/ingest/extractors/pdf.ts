/**
 * Native PDF text extraction via `pdfjs-dist` (Mozilla's PDF.js).
 *
 * Pure text extraction — no canvas, no fonts loaded for rendering.
 * Layout, tables, and images are flattened to a stream of words
 * separated by line breaks at item boundaries. Good enough for RAG
 * chunking on text-first documents (specs, manuals, articles).
 * Operators who need table reconstruction or OCR should configure
 * docling-serve via `DOCLING_URL`; the dispatcher routes to it
 * automatically when set.
 *
 * Worker is disabled — the pure-JS fallback is fine for server-side
 * extraction, and bringing up a worker thread per request is more
 * cost than win for files that fit in the 50 MB ingest cap. PDF.js
 * complains in stderr when the worker is missing; we mute that with
 * the `verbosity: 0` flag.
 */

import {
	ExtractError,
	type ExtractedDocument,
	type ExtractInput,
} from "./types.js";

interface PdfTextItem {
	readonly str?: string;
	readonly hasEOL?: boolean;
}

interface PdfPage {
	getTextContent(): Promise<{ readonly items: ReadonlyArray<PdfTextItem> }>;
}

interface PdfDocument {
	readonly numPages: number;
	getPage(n: number): Promise<PdfPage>;
}

interface GetDocumentTask {
	readonly promise: Promise<PdfDocument>;
	/**
	 * Teardown for the document and its worker. pdf.js v6 removed
	 * `PDFDocumentProxy.destroy()` (the doc only exposes `cleanup()`
	 * now), so teardown lives on the loading task. The loading task has
	 * carried `destroy()` since v5, so calling it here is both forward-
	 * and backward-compatible.
	 */
	destroy(): Promise<void>;
}

interface PdfJsModule {
	getDocument(args: {
		data: Uint8Array;
		isEvalSupported?: boolean;
		useSystemFonts?: boolean;
		disableFontFace?: boolean;
		verbosity?: number;
	}): GetDocumentTask;
	readonly version?: string;
}

let pdfjsModulePromise: Promise<PdfJsModule> | null = null;

/**
 * Lazy load — pdfjs-dist's startup costs (font tables, character
 * maps) are non-trivial and we don't want to pay them when the
 * runtime never sees a PDF. Cached on first hit, shared across
 * concurrent requests.
 */
async function loadPdfJs(): Promise<PdfJsModule> {
	if (!pdfjsModulePromise) {
		pdfjsModulePromise = import("pdfjs-dist/legacy/build/pdf.mjs").then(
			(mod) => mod as unknown as PdfJsModule,
		);
	}
	return pdfjsModulePromise;
}

export async function extractPdf(
	input: ExtractInput,
): Promise<ExtractedDocument> {
	const pdfjs = await loadPdfJs();
	let task: GetDocumentTask | null = null;
	try {
		// Copy into a fresh Uint8Array because pdf.js takes ownership of
		// the buffer (zeroes it during parse) and the multipart layer
		// may reuse the underlying ArrayBuffer for other form fields.
		const data = new Uint8Array(input.bytes);
		task = pdfjs.getDocument({
			data,
			isEvalSupported: false,
			useSystemFonts: false,
			disableFontFace: true,
			verbosity: 0,
		});
		const doc = await task.promise;

		const pageTexts: string[] = [];
		for (let pageNum = 1; pageNum <= doc.numPages; pageNum++) {
			const page = await doc.getPage(pageNum);
			const content = await page.getTextContent();
			const parts: string[] = [];
			for (const item of content.items) {
				if (typeof item.str === "string" && item.str.length > 0) {
					parts.push(item.str);
				}
				if (item.hasEOL) parts.push("\n");
			}
			pageTexts.push(
				parts
					.join(" ")
					.replace(/[ \t]+\n/g, "\n")
					.trim(),
			);
		}

		const text = pageTexts.filter((p) => p.length > 0).join("\n\n");
		if (text.length === 0) {
			throw new ExtractError(
				"empty_document",
				`"${input.filename}" yielded no extractable text — the PDF may be image-only (scanned). Configure DOCLING_URL for OCR.`,
			);
		}
		return {
			text,
			parser: "native",
			parserVersion: pdfjs.version
				? `pdfjs-dist@${pdfjs.version}`
				: "pdfjs-dist",
		};
	} catch (err) {
		if (err instanceof ExtractError) throw err;
		throw new ExtractError(
			"extraction_failed",
			`could not extract text from "${input.filename}": ${
				err instanceof Error ? err.message : String(err)
			}`,
			{ cause: err },
		);
	} finally {
		if (task) {
			await task.destroy().catch(() => {
				/* destroy is idempotent; swallow secondary errors */
			});
		}
	}
}
