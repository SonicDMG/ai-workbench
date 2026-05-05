/**
 * Shared types for the document-text extractor surface.
 *
 * The extractor sits between the multipart upload route and the
 * existing JSON ingest service: bytes in, plain text out. The text
 * goes through the same chunk + embed + upsert pipeline regardless of
 * which extractor produced it, so callers downstream don't have to
 * know whether a PDF was rendered natively or by docling.
 *
 * `parser` is the routing decision the dispatcher made (`"native"`
 * for the in-process extractors, `"docling"` for docling-serve). It's
 * stamped onto the `RagDocument.metadata` so the UI / audit trail can
 * tell the two paths apart without re-running the dispatcher.
 */

export type ExtractParser = "native" | "docling";

export interface ExtractedDocument {
	/** UTF-8 text, ready to feed straight into the chunker. */
	readonly text: string;
	/** Which dispatcher branch produced the text. */
	readonly parser: ExtractParser;
	/**
	 * Free-form parser identifier (e.g. `"pdfjs-dist"`,
	 * `"mammoth"`, `"docling-serve@0.6.0"`). Logged + recorded as
	 * metadata; absent when the source is a native fallback that
	 * has no library version (plain UTF-8 decode).
	 */
	readonly parserVersion?: string;
}

/**
 * Why the dispatcher rejected a given upload. Mapped to a 4xx by the
 * route. Distinct error class so route-layer error handling stays
 * straightforward and the test surface is explicit about the failure
 * mode rather than relying on string matching.
 */
export class ExtractError extends Error {
	readonly code:
		| "unsupported_file_type"
		| "extraction_failed"
		| "docling_unavailable"
		| "empty_document";

	constructor(
		code:
			| "unsupported_file_type"
			| "extraction_failed"
			| "docling_unavailable"
			| "empty_document",
		message: string,
		options?: ErrorOptions,
	) {
		super(message, options);
		this.name = "ExtractError";
		this.code = code;
	}
}

/**
 * Input handed to every extractor implementation. Bytes are owned by
 * the caller (the route does the multipart parse); extractors must
 * not retain the buffer past the returned promise.
 */
export interface ExtractInput {
	readonly bytes: Uint8Array;
	readonly filename: string;
	/** MIME type from the multipart envelope, lowercase, may be empty. */
	readonly mimeType: string;
}
