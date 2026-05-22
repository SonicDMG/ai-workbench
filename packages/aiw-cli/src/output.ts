/**
 * Output formatting for CLI commands.
 *
 * Two modes today:
 *   - "human" (default): table-ish layout, color when stdout is a TTY.
 *   - "json": pretty-printed JSON for scripting and `jq` pipelines.
 *
 * Tables stay deliberately simple: no external table library, no
 * truncation magic, just space-padded columns. Long values wrap to
 * the cell rather than being elided — operators looking at a UID or
 * a URL need to see the whole thing.
 */
import pc from "picocolors";

export type OutputFormat = "human" | "json";

export function parseOutputFormat(value: string | undefined): OutputFormat {
	if (!value || value === "human") return "human";
	if (value === "json") return "json";
	throw new Error(
		`Unknown --output value "${value}". Expected one of: human, json.`,
	);
}

export interface TableColumn<T> {
	readonly header: string;
	readonly value: (row: T) => string;
}

export function renderTable<T>(
	rows: readonly T[],
	columns: readonly TableColumn<T>[],
): string {
	if (rows.length === 0) return "(no rows)";
	const headers = columns.map((c) => c.header);
	const body = rows.map((row) => columns.map((c) => c.value(row) ?? ""));

	const widths = headers.map((h, i) => {
		let max = h.length;
		for (const cells of body) {
			const cell = cells[i] ?? "";
			if (cell.length > max) max = cell.length;
		}
		return max;
	});

	const lines: string[] = [];
	lines.push(headers.map((h, i) => pad(h, widths[i] ?? 0)).join("  "));
	lines.push(widths.map((w) => "-".repeat(w)).join("  "));
	for (const cells of body) {
		lines.push(cells.map((c, i) => pad(c, widths[i] ?? 0)).join("  "));
	}
	return lines.join("\n");
}

export function emit<T>(
	format: OutputFormat,
	data: T,
	humanRenderer: (data: T) => string,
): void {
	if (format === "json") {
		process.stdout.write(`${JSON.stringify(data, null, 2)}\n`);
		return;
	}
	const out = humanRenderer(data);
	if (out.length > 0) {
		process.stdout.write(`${out}\n`);
	}
}

export function info(message: string): void {
	process.stderr.write(`${pc.dim("[aiw]")} ${message}\n`);
}

export function success(message: string): void {
	process.stderr.write(`${pc.green("✓")} ${message}\n`);
}

export function warn(message: string): void {
	process.stderr.write(`${pc.yellow("!")} ${message}\n`);
}

export interface FailDetails {
	readonly hint?: string;
	readonly docs?: string;
	readonly requestId?: string;
}

/**
 * Render an error to stderr. Top line is the bullet + message; if the
 * registry attached a hint and/or docs link to the envelope, those
 * land on indented follow-up lines so a `grep ✗` still surfaces the
 * primary message while a human sees the full remediation block.
 */
export function fail(message: string, details: FailDetails = {}): void {
	process.stderr.write(`${pc.red("✗")} ${message}\n`);
	if (details.hint) {
		process.stderr.write(`  ${pc.yellow("hint:")} ${details.hint}\n`);
	}
	if (details.docs) {
		process.stderr.write(`  ${pc.dim("docs:")} ${details.docs}\n`);
	}
	if (details.requestId) {
		process.stderr.write(`  ${pc.dim("request id:")} ${details.requestId}\n`);
	}
}

function pad(value: string, width: number): string {
	if (value.length >= width) return value;
	return value + " ".repeat(width - value.length);
}
