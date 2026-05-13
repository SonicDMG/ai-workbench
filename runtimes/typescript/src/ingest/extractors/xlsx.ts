/**
 * Native `.xlsx` text extraction via `read-excel-file`.
 *
 * Walks every worksheet in the workbook and renders it as a markdown
 * table — sheet name as a level-2 heading, header row separated from
 * the data with the standard markdown alignment row. The chunker
 * treats markdown reasonably well, so the extracted text stays useful
 * for retrieval (sheet names + cell values, with row + column locality
 * preserved). Empty sheets are skipped.
 *
 * `read-excel-file` already coerces cell values:
 *   - numbers / booleans → primitives; dates → `Date` objects (ISO-8601 here)
 *   - formulas → the cached result the spreadsheet app last wrote
 *   - hyperlinks / rich text → flattened to display text
 *
 * Operators who need spreadsheet-aware extraction (per-sheet metadata,
 * named ranges, charts, formula evaluation) should route through
 * docling-serve via `DOCLING_URL`. The native path is the
 * "good-enough plain text" tier.
 */

import {
	ExtractError,
	type ExtractedDocument,
	type ExtractInput,
} from "./types.js";

type CellValue = string | number | boolean | Date | null;
type Row = ReadonlyArray<CellValue>;
type SheetEntry = { readonly sheet: string; readonly data: ReadonlyArray<Row> };

type ReadExcelFileFn = (input: Buffer) => Promise<ReadonlyArray<SheetEntry>>;

let readXlsxFilePromise: Promise<ReadExcelFileFn> | null = null;

async function loadReader(): Promise<ReadExcelFileFn> {
	if (!readXlsxFilePromise) {
		readXlsxFilePromise = import("read-excel-file/node").then(
			(mod) =>
				((mod as unknown as { default: ReadExcelFileFn }).default ??
					(mod as unknown as ReadExcelFileFn)) as ReadExcelFileFn,
		);
	}
	return readXlsxFilePromise;
}

/** Coerce a single cell value to its display string. `read-excel-file`
 * already flattens formulas / hyperlinks / rich text into primitives,
 * so this only has to handle the four cell-value types it produces. */
function cellToString(value: CellValue): string {
	if (value === null || value === undefined) return "";
	if (typeof value === "string") return value;
	if (typeof value === "number" || typeof value === "boolean") {
		return String(value);
	}
	if (value instanceof Date) return value.toISOString();
	return String(value);
}

/** Markdown table cells must escape `|` and newlines — otherwise the
 * pipe terminates the column and the table becomes ragged. */
function escapeCell(s: string): string {
	return s.replace(/\\/g, "\\\\").replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

function renderSheet(entry: SheetEntry): string {
	const rows = entry.data;
	if (rows.length === 0) return "";
	const colCount = rows.reduce((n, r) => Math.max(n, r.length), 0);
	if (colCount === 0) return "";

	const lines: string[] = [`## ${entry.sheet}`, ""];
	let dataRowsEmitted = 0;
	let headerEmitted = false;

	for (const row of rows) {
		const cells: string[] = [];
		for (let c = 0; c < colCount; c++) {
			cells.push(escapeCell(cellToString(row[c] ?? null)));
		}
		// Skip rows that came back entirely empty — XLSX files often
		// have phantom rows past the last filled row, and they bloat
		// the output without adding anything for retrieval.
		if (cells.every((c) => c.length === 0)) continue;
		lines.push(`| ${cells.join(" | ")} |`);
		if (!headerEmitted) {
			lines.push(`| ${cells.map(() => "---").join(" | ")} |`);
			headerEmitted = true;
		}
		dataRowsEmitted++;
	}

	if (dataRowsEmitted === 0) return "";
	lines.push("");
	return lines.join("\n");
}

export async function extractXlsx(
	input: ExtractInput,
): Promise<ExtractedDocument> {
	const readXlsxFile = await loadReader();
	let sheets: ReadonlyArray<SheetEntry>;
	try {
		// `Buffer.from(view)` copies into a fresh standalone Buffer so the
		// underlying ArrayBuffer the multipart layer handed us isn't held
		// past this call.
		sheets = await readXlsxFile(Buffer.from(input.bytes));
	} catch (err) {
		throw new ExtractError(
			"extraction_failed",
			`could not parse "${input.filename}" as an XLSX workbook: ${
				err instanceof Error ? err.message : String(err)
			}`,
			{ cause: err },
		);
	}

	const rendered = sheets
		.map((s) => renderSheet(s))
		.filter((s) => s.length > 0);

	if (rendered.length === 0) {
		throw new ExtractError(
			"empty_document",
			`"${input.filename}" yielded no extractable cells`,
		);
	}

	return {
		text: rendered.join("\n"),
		parser: "native",
		parserVersion: "read-excel-file",
	};
}
