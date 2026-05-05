/**
 * Adapter for [docling-serve](https://github.com/docling-project/docling-serve),
 * the HTTP front-end for IBM's Docling document parser.
 *
 * Docling does layout-aware extraction: tables, headings, figures,
 * OCR'd scans. Markdown is the most chunker-friendly target so we
 * ask for that and feed the result straight into the existing ingest
 * pipeline.
 *
 * The adapter is opt-in: callers pass an explicit `baseUrl`, which
 * the dispatcher reads from `DOCLING_URL` at startup. When the env
 * var is unset the dispatcher never reaches this module — native
 * extractors handle the upload instead.
 *
 * Endpoint: `POST {baseUrl}/v1/convert/file` accepts a multipart
 * file plus form fields and returns a JSON envelope with the
 * Markdown rendering of the document. The shape we depend on is
 * minimal (`document.md_content`); other fields are ignored so this
 * keeps working as docling-serve evolves.
 *
 * Network failures and non-2xx responses surface as `docling_unavailable`
 * so the route can return 503 rather than 500 — the upload itself was
 * fine, the parser just isn't reachable.
 */

import {
	ExtractError,
	type ExtractedDocument,
	type ExtractInput,
} from "./types.js";

export interface DoclingConfig {
	readonly baseUrl: string;
	/** Per-request budget. Docling defaults to a few seconds for text PDFs;
	 * scanned/OCR'd documents can take 30s+. The default keeps the route
	 * responsive while leaving headroom; override via `DOCLING_TIMEOUT_MS`. */
	readonly timeoutMs: number;
}

const DEFAULT_TIMEOUT_MS = 60_000;

export function readDoclingConfigFromEnv(
	env: NodeJS.ProcessEnv = process.env,
): DoclingConfig | null {
	const raw = env.DOCLING_URL?.trim();
	if (!raw) return null;
	let url: URL;
	try {
		url = new URL(raw);
	} catch {
		throw new Error(`DOCLING_URL must be a valid URL, got "${raw}"`);
	}
	if (url.protocol !== "http:" && url.protocol !== "https:") {
		throw new Error(`DOCLING_URL must be http(s), got "${url.protocol}"`);
	}
	const timeoutRaw = env.DOCLING_TIMEOUT_MS?.trim();
	const timeoutMs =
		timeoutRaw && /^\d+$/.test(timeoutRaw)
			? Number.parseInt(timeoutRaw, 10)
			: DEFAULT_TIMEOUT_MS;
	// Strip trailing slash so the joined URL never doubles up.
	return { baseUrl: raw.replace(/\/+$/, ""), timeoutMs };
}

interface DoclingResponse {
	readonly document?: {
		readonly md_content?: string;
		readonly text_content?: string;
	};
}

export async function extractViaDocling(
	input: ExtractInput,
	config: DoclingConfig,
): Promise<ExtractedDocument> {
	const form = new FormData();
	const blob = new Blob([new Uint8Array(input.bytes)], {
		type: input.mimeType || "application/octet-stream",
	});
	form.append("files", blob, input.filename || "upload");
	// Markdown is the most chunker-friendly output; other formats
	// (json, html, doctags) are available but lossier downstream.
	form.append("to_formats", "md");
	// One synchronous call per upload — no result polling needed.
	form.append("return_as_file", "false");

	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), config.timeoutMs);
	let res: Response;
	try {
		res = await fetch(`${config.baseUrl}/v1/convert/file`, {
			method: "POST",
			body: form,
			signal: controller.signal,
		});
	} catch (err) {
		const reason =
			err instanceof Error && err.name === "AbortError"
				? `timed out after ${config.timeoutMs}ms`
				: err instanceof Error
					? err.message
					: String(err);
		throw new ExtractError(
			"docling_unavailable",
			`docling-serve at ${config.baseUrl} could not be reached: ${reason}`,
			{ cause: err },
		);
	} finally {
		clearTimeout(timer);
	}

	if (!res.ok) {
		const body = await res.text().catch(() => "");
		throw new ExtractError(
			"docling_unavailable",
			`docling-serve at ${config.baseUrl} returned ${res.status}${
				body ? `: ${body.slice(0, 200)}` : ""
			}`,
		);
	}

	let payload: DoclingResponse;
	try {
		payload = (await res.json()) as DoclingResponse;
	} catch (err) {
		throw new ExtractError(
			"docling_unavailable",
			`docling-serve returned a non-JSON body`,
			{ cause: err },
		);
	}

	const text =
		payload.document?.md_content?.trim() ??
		payload.document?.text_content?.trim() ??
		"";
	if (text.length === 0) {
		throw new ExtractError(
			"empty_document",
			`docling-serve returned no markdown for "${input.filename}"`,
		);
	}
	return {
		text,
		parser: "docling",
		parserVersion: "docling-serve",
	};
}
