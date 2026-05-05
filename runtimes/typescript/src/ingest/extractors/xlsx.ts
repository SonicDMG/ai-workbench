/**
 * Native `.xlsx` text extraction via `exceljs`.
 *
 * Walks every worksheet in the workbook and renders it as a markdown
 * table — sheet name as a level-2 heading, header row separated from
 * the data with the standard markdown alignment row. The chunker
 * treats markdown reasonably well, so the extracted text stays useful
 * for retrieval (sheet names + cell values, with row + column locality
 * preserved). Empty sheets are skipped.
 *
 * Cell values are coerced to strings:
 *   - numbers / booleans / dates → `String(value)` / ISO-8601 for dates
 *   - hyperlinks → display text (the URL is dropped — the markdown
 *     table cell would otherwise carry the full link target into every
 *     row, which doesn't help retrieval)
 *   - formulas → the cached result when the workbook has one,
 *     otherwise the formula source
 *   - rich text → concatenated runs
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

interface RichTextRun {
	readonly text?: string;
}

interface ExcelHyperlinkValue {
	readonly text?: string;
	readonly hyperlink?: string;
}

interface ExcelFormulaValue {
	readonly result?: unknown;
	readonly formula?: string;
}

interface ExcelRichTextValue {
	readonly richText?: ReadonlyArray<RichTextRun>;
}

interface ExcelRow {
	getCell(col: number): { readonly value: unknown };
	readonly cellCount: number;
	readonly actualCellCount: number;
}

interface ExcelWorksheet {
	readonly name: string;
	readonly rowCount: number;
	readonly columnCount: number;
	readonly actualColumnCount: number;
	readonly actualRowCount: number;
	getRow(row: number): ExcelRow;
}

interface ExcelWorkbook {
	readonly worksheets: ReadonlyArray<ExcelWorksheet>;
}

interface ExcelJsModule {
	Workbook: new () => {
		xlsx: { load(buffer: Buffer): Promise<ExcelWorkbook> };
	};
}

let exceljsPromise: Promise<ExcelJsModule> | null = null;

async function loadExcelJs(): Promise<ExcelJsModule> {
	if (!exceljsPromise) {
		exceljsPromise = import("exceljs").then(
			(mod) =>
				(mod as unknown as { default?: ExcelJsModule }).default ??
				(mod as unknown as ExcelJsModule),
		);
	}
	return exceljsPromise;
}

/** Coerce a single cell value to its display string. Tolerant of the
 * mixed-shape `value` union exceljs exposes — formulas, hyperlinks,
 * rich text, numbers, dates, booleans, and null all flow through here. */
function cellToString(value: unknown): string {
	if (value === null || value === undefined) return "";
	if (typeof value === "string") return value;
	if (typeof value === "number" || typeof value === "boolean") {
		return String(value);
	}
	if (value instanceof Date) return value.toISOString();
	if (typeof value === "object") {
		const obj = value as ExcelHyperlinkValue &
			ExcelFormulaValue &
			ExcelRichTextValue;
		if (Array.isArray(obj.richText)) {
			return obj.richText.map((r) => r.text ?? "").join("");
		}
		if (typeof obj.text === "string") return obj.text;
		if (obj.result !== undefined) return cellToString(obj.result);
		if (typeof obj.formula === "string") return `=${obj.formula}`;
		// Fallback: stringify so we don't drop unknown shapes silently.
		try {
			return JSON.stringify(value);
		} catch {
			return String(value);
		}
	}
	return String(value);
}

/** Markdown table cells must escape `|` and newlines — otherwise the
 * pipe terminates the column and the table becomes ragged. */
function escapeCell(s: string): string {
	return s.replace(/\\/g, "\\\\").replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

function renderSheet(sheet: ExcelWorksheet): string {
	if (sheet.actualRowCount === 0 || sheet.actualColumnCount === 0) {
		return "";
	}
	const rowCount = Math.max(sheet.rowCount, 0);
	const colCount = Math.max(sheet.columnCount, 0);
	if (rowCount === 0 || colCount === 0) return "";

	const lines: string[] = [`## ${sheet.name}`, ""];

	for (let r = 1; r <= rowCount; r++) {
		const row = sheet.getRow(r);
		const cells: string[] = [];
		for (let c = 1; c <= colCount; c++) {
			cells.push(escapeCell(cellToString(row.getCell(c).value)));
		}
		// Skip rows that came back entirely empty — XLSX files often
		// have phantom rows past the last filled row, and they bloat
		// the output without adding anything for retrieval.
		if (cells.every((c) => c.length === 0)) continue;
		lines.push(`| ${cells.join(" | ")} |`);
		if (r === 1) {
			lines.push(`| ${cells.map(() => "---").join(" | ")} |`);
		}
	}

	lines.push("");
	return lines.join("\n");
}

export async function extractXlsx(
	input: ExtractInput,
): Promise<ExtractedDocument> {
	const ExcelJS = await loadExcelJs();
	let workbook: ExcelWorkbook;
	try {
		const wb = new ExcelJS.Workbook();
		// `Buffer.from(view)` copies into a fresh standalone Buffer so the
		// underlying ArrayBuffer the multipart layer handed us isn't held
		// past this call.
		workbook = await wb.xlsx.load(Buffer.from(input.bytes));
	} catch (err) {
		throw new ExtractError(
			"extraction_failed",
			`could not parse "${input.filename}" as an XLSX workbook: ${
				err instanceof Error ? err.message : String(err)
			}`,
			{ cause: err },
		);
	}

	const rendered = workbook.worksheets
		.map((sheet) => renderSheet(sheet))
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
		parserVersion: "exceljs",
	};
}
