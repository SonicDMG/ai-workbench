/**
 * Extractor dispatcher — picks an implementation by file type and the
 * caller's preference (`native` vs `docling`), runs it, and returns
 * the plain text the rest of the ingest pipeline expects.
 *
 * Routing rules:
 *   - `parser: "docling"` (or default-to-docling when `DOCLING_URL`
 *     is set and the caller omitted `parser`): call docling-serve.
 *     If docling is unreachable, fall back to the native extractor
 *     for the file type when one exists. The fallback keeps an
 *     ingest from failing solely because the operator's docling
 *     instance is rebooting.
 *   - `parser: "native"` (or default when `DOCLING_URL` is unset):
 *     dispatch by extension/MIME to the in-process extractors.
 *
 * `text/*` uploads always take the UTF-8 fast path on the native
 * branch — there's no value in routing a 4 KB markdown file through
 * docling. The docling branch will still send text to docling when
 * explicitly selected (some operators want every document to go
 * through one parser for consistency).
 */

import type { DoclingConfig } from "./docling.js";
import { extractViaDocling, readDoclingConfigFromEnv } from "./docling.js";
import { extractDocx } from "./docx.js";
import { extractPdf } from "./pdf.js";
import { extractText } from "./text.js";
import {
	ExtractError,
	type ExtractedDocument,
	type ExtractInput,
	type ExtractParser,
} from "./types.js";

export type { DoclingConfig } from "./docling.js";
export type {
	ExtractedDocument,
	ExtractInput,
	ExtractParser,
} from "./types.js";
export { ExtractError } from "./types.js";

export interface ExtractorRegistry {
	/** docling-serve config; `null` when `DOCLING_URL` is unset. */
	readonly docling: DoclingConfig | null;
	extract(
		input: ExtractInput,
		opts?: { readonly parser?: ExtractParser | "auto" },
	): Promise<ExtractedDocument>;
}

const PDF_EXTENSIONS = new Set(["pdf"]);
const DOCX_EXTENSIONS = new Set(["docx"]);
const TEXT_EXTENSIONS = new Set([
	"txt",
	"text",
	"md",
	"markdown",
	"mdx",
	"rst",
	"adoc",
	"asciidoc",
	"json",
	"jsonc",
	"jsonl",
	"ndjson",
	"csv",
	"tsv",
	"log",
	"xml",
	"html",
	"htm",
	"yaml",
	"yml",
	"toml",
	"ini",
	"cfg",
	"conf",
	"properties",
	"graphql",
	"gql",
	"sql",
	"css",
	"scss",
	"sass",
	"less",
	"js",
	"jsx",
	"ts",
	"tsx",
	"py",
	"go",
	"rs",
	"java",
	"kt",
	"rb",
	"sh",
	"bash",
	"zsh",
	"ps1",
]);

function lowerExt(filename: string): string {
	const dot = filename.lastIndexOf(".");
	return dot < 0 ? "" : filename.slice(dot + 1).toLowerCase();
}

function isTextLike(input: ExtractInput): boolean {
	if (input.mimeType.startsWith("text/")) return true;
	const ext = lowerExt(input.filename);
	return TEXT_EXTENSIONS.has(ext);
}

function isPdfLike(input: ExtractInput): boolean {
	if (input.mimeType === "application/pdf") return true;
	return PDF_EXTENSIONS.has(lowerExt(input.filename));
}

function isDocxLike(input: ExtractInput): boolean {
	if (
		input.mimeType ===
		"application/vnd.openxmlformats-officedocument.wordprocessingml.document"
	) {
		return true;
	}
	return DOCX_EXTENSIONS.has(lowerExt(input.filename));
}

async function extractNative(input: ExtractInput): Promise<ExtractedDocument> {
	if (isPdfLike(input)) return extractPdf(input);
	if (isDocxLike(input)) return extractDocx(input);
	if (isTextLike(input)) return extractText(input);
	throw new ExtractError(
		"unsupported_file_type",
		`no native extractor for "${input.filename}" (mime "${input.mimeType || "unknown"}")`,
	);
}

export interface CreateExtractorRegistryOptions {
	readonly docling?: DoclingConfig | null;
	/** Override for tests — defaults to `process.env`. */
	readonly env?: NodeJS.ProcessEnv;
}

export function createExtractorRegistry(
	opts: CreateExtractorRegistryOptions = {},
): ExtractorRegistry {
	const docling =
		opts.docling !== undefined
			? opts.docling
			: readDoclingConfigFromEnv(opts.env);

	async function tryDocling(input: ExtractInput): Promise<ExtractedDocument> {
		if (!docling) {
			throw new ExtractError(
				"docling_unavailable",
				"docling parser was requested but DOCLING_URL is not configured",
			);
		}
		return extractViaDocling(input, docling);
	}

	return {
		docling,
		async extract(input, options) {
			const parser = options?.parser ?? "auto";

			if (parser === "docling") {
				try {
					return await tryDocling(input);
				} catch (err) {
					// If the operator explicitly asked for docling and it
					// failed for a network reason, fall back to native so a
					// rebooting docling-serve doesn't take ingest with it.
					// `unsupported_file_type` and `empty_document` propagate
					// as-is — those are real refusals, not infrastructure
					// hiccups.
					if (
						err instanceof ExtractError &&
						err.code === "docling_unavailable"
					) {
						return extractNative(input);
					}
					throw err;
				}
			}

			if (parser === "native") {
				return extractNative(input);
			}

			// Auto: prefer docling when configured (it strictly beats
			// native on PDFs with tables/scans), but skip it for plain
			// text — round-tripping a markdown file through a parser is
			// just latency for no benefit.
			if (docling && !isTextLike(input)) {
				try {
					return await extractViaDocling(input, docling);
				} catch (err) {
					if (
						err instanceof ExtractError &&
						err.code === "docling_unavailable"
					) {
						return extractNative(input);
					}
					throw err;
				}
			}
			return extractNative(input);
		},
	};
}

/**
 * The set of file extensions the extractor surface can ingest. The
 * web UI uses this list to filter the file picker — keep it in sync
 * with the dispatcher's routing rules.
 */
export const SUPPORTED_INGEST_EXTENSIONS: ReadonlySet<string> = new Set([
	...TEXT_EXTENSIONS,
	...PDF_EXTENSIONS,
	...DOCX_EXTENSIONS,
]);
