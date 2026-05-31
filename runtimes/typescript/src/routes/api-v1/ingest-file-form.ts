/**
 * Multipart parsing for `POST .../knowledge-bases/{kb}/ingest/file`.
 *
 * The validator stack doesn't model browser `File` fields well enough
 * to preserve our specific multipart error codes, so the file-ingest
 * route parses the form by hand. That parsing — field validation, text
 * extraction, and the metadata/chunker/RLAC field decoding — is pulled
 * out here so the route handler stays in the validate→delegate→serialize
 * band and the parsing is unit-testable without an HTTP harness.
 *
 * Every failure throws an {@link ApiError} with the same code/status the
 * route advertised before the extraction:
 *   - `missing_file` / `empty_file` / `invalid_parser` → 400
 *   - `invalid_metadata` / `invalid_chunker` / `invalid_visible_to` → 400
 *   - extractor failures map through {@link ExtractError} → 415 / 503 / 422
 */

import {
	ExtractError,
	type ExtractorRegistry,
} from "../../ingest/extractors/index.js";
import { ApiError } from "../../lib/errors.js";

/**
 * Decoded ingest-file form, ready to feed into `IngestService.ingest`.
 * `metadata` always carries the parser-provenance keys the pipeline
 * stamps (`ingestParser`, optionally `ingestParserVersion`).
 * `callerVisibleTo` / `ownerPrincipalId` are the *raw* caller-supplied
 * RLAC fields — the route applies workspace-level defaulting on top.
 */
export interface ParsedIngestFileForm {
	readonly text: string;
	readonly sourceFilename: string;
	readonly fileType: string | null;
	readonly fileSize: number;
	readonly documentId?: string;
	readonly sourceDocId?: string;
	readonly metadata: Record<string, string>;
	readonly chunker?: Record<string, unknown>;
	readonly overwriteOnNameConflict: boolean;
	readonly callerVisibleTo?: readonly string[];
	readonly ownerPrincipalId?: string;
}

/**
 * Parse + validate the `ingest/file` multipart form and run text
 * extraction. The caller owns the `c.req.formData()` call (and its
 * `invalid_multipart` framing error) so this stays free of the Hono
 * context and trivially testable.
 */
export async function parseIngestFileForm(
	form: FormData,
	extractors: ExtractorRegistry,
): Promise<ParsedIngestFileForm> {
	const fileEntry = form.get("file");
	if (!(fileEntry instanceof File)) {
		throw new ApiError(
			"missing_file",
			"multipart request must include a `file` field with the document bytes",
			400,
		);
	}
	if (fileEntry.size === 0) {
		throw new ApiError("empty_file", "uploaded file is empty", 400);
	}

	const parserField = (form.get("parser") as string | null) ?? "auto";
	if (
		parserField !== "auto" &&
		parserField !== "native" &&
		parserField !== "docling"
	) {
		throw new ApiError(
			"invalid_parser",
			`parser must be "auto", "native", or "docling"; got "${parserField}"`,
			400,
		);
	}

	const bytes = new Uint8Array(await fileEntry.arrayBuffer());

	let extracted: Awaited<ReturnType<ExtractorRegistry["extract"]>>;
	try {
		extracted = await extractors.extract(
			{
				bytes,
				filename: fileEntry.name,
				mimeType: (fileEntry.type ?? "").toLowerCase(),
			},
			{ parser: parserField },
		);
	} catch (err) {
		if (err instanceof ExtractError) {
			const status =
				err.code === "unsupported_file_type"
					? 415
					: err.code === "docling_unavailable"
						? 503
						: 422;
			throw new ApiError(err.code, err.message, status);
		}
		throw err;
	}

	const metadataField = form.get("metadata") as string | null;
	let metadata: Record<string, string> | undefined;
	if (metadataField) {
		try {
			const parsed = JSON.parse(metadataField);
			if (
				parsed === null ||
				typeof parsed !== "object" ||
				Array.isArray(parsed)
			) {
				throw new Error("metadata must be a JSON object of strings");
			}
			metadata = {} as Record<string, string>;
			for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
				if (typeof v !== "string") {
					throw new Error(`metadata field "${k}" must be a string`);
				}
				metadata[k] = v;
			}
		} catch (err) {
			throw new ApiError(
				"invalid_metadata",
				`metadata field is not valid JSON: ${
					err instanceof Error ? err.message : String(err)
				}`,
				400,
			);
		}
	}
	// Stamp the parser provenance into metadata so the UI / audit
	// trail can tell native uploads from docling ones without
	// re-running the dispatcher. Caller-supplied metadata wins
	// only when they didn't reuse the reserved keys.
	const stampedMetadata: Record<string, string> = {
		...(metadata ?? {}),
		ingestParser: extracted.parser,
		...(extracted.parserVersion
			? { ingestParserVersion: extracted.parserVersion }
			: {}),
	};

	const chunkerField = form.get("chunker") as string | null;
	let chunker: Record<string, unknown> | undefined;
	if (chunkerField) {
		try {
			const parsed = JSON.parse(chunkerField);
			if (
				parsed === null ||
				typeof parsed !== "object" ||
				Array.isArray(parsed)
			) {
				throw new Error("chunker must be a JSON object");
			}
			chunker = parsed as Record<string, unknown>;
		} catch (err) {
			throw new ApiError(
				"invalid_chunker",
				`chunker field is not valid JSON: ${
					err instanceof Error ? err.message : String(err)
				}`,
				400,
			);
		}
	}

	const overwriteOnNameConflict =
		(form.get("overwriteOnNameConflict") as string | null) === "true";
	const documentId = (form.get("documentId") as string | null) ?? undefined;
	const sourceDocId = (form.get("sourceDocId") as string | null) ?? undefined;

	// RLAC: caller may supply `visibleTo` as a JSON-encoded string
	// array, and `ownerPrincipalId` as a plain string. Parse here;
	// workspace-level defaulting happens in the route, in the same shape
	// the text-ingest route uses.
	const visibleToField = form.get("visibleTo") as string | null;
	let callerVisibleTo: readonly string[] | undefined;
	if (visibleToField) {
		try {
			const parsed = JSON.parse(visibleToField);
			if (!Array.isArray(parsed) || parsed.some((v) => typeof v !== "string")) {
				throw new Error("visibleTo must be a JSON array of strings");
			}
			callerVisibleTo = parsed as string[];
		} catch (err) {
			throw new ApiError(
				"invalid_visible_to",
				`visibleTo field is not a valid JSON string-array: ${
					err instanceof Error ? err.message : String(err)
				}`,
				400,
			);
		}
	}
	const ownerPrincipalId =
		(form.get("ownerPrincipalId") as string | null) ?? undefined;

	return {
		text: extracted.text,
		sourceFilename: fileEntry.name,
		fileType: fileEntry.type || null,
		fileSize: fileEntry.size,
		...(documentId !== undefined && { documentId }),
		...(sourceDocId !== undefined && { sourceDocId }),
		metadata: stampedMetadata,
		...(chunker !== undefined && { chunker }),
		overwriteOnNameConflict,
		...(callerVisibleTo !== undefined && { callerVisibleTo }),
		...(ownerPrincipalId !== undefined && { ownerPrincipalId }),
	};
}
