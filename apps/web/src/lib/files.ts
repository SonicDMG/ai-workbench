/**
 * File-type metadata used by the catalog explorer + ingest queue UI.
 *
 * `extOf(name)` extracts the lowercase extension from a filename
 * (without the leading dot) — `"foo.MD"` → `"md"`.
 *
 * `fileTypeMeta(ext)` returns the colored-badge config for an
 * extension. Unknown extensions get a neutral slate fallback.
 *
 * `formatFileSize(bytes)` renders a byte count with an appropriate
 * SI-ish unit (KB/MB/GB) and one decimal place beyond bytes —
 * `1500` → `"1.5 KB"`, `null` → `"—"`.
 */

export interface FileTypeMeta {
	/** Display label, ALL CAPS for badge density. */
	readonly label: string;
	/** Tailwind classes applied to the badge — paired bg + text + border. */
	readonly badgeClass: string;
}

const TEXT = "bg-slate-100 text-slate-700 border-slate-200";
const MARKDOWN = "bg-violet-50 text-violet-700 border-violet-200";
const CODE = "bg-blue-50 text-blue-700 border-blue-200";
const DATA = "bg-amber-50 text-amber-700 border-amber-200";
const STRUCTURED = "bg-emerald-50 text-emerald-700 border-emerald-200";
const WEB = "bg-rose-50 text-rose-700 border-rose-200";
const BINARY = "bg-fuchsia-50 text-fuchsia-700 border-fuchsia-200";
const UNKNOWN = "bg-slate-50 text-slate-500 border-slate-200";

const META: Record<string, FileTypeMeta> = {
	md: { label: "MD", badgeClass: MARKDOWN },
	markdown: { label: "MD", badgeClass: MARKDOWN },
	mdx: { label: "MDX", badgeClass: MARKDOWN },
	rst: { label: "RST", badgeClass: MARKDOWN },

	txt: { label: "TXT", badgeClass: TEXT },
	log: { label: "LOG", badgeClass: TEXT },

	json: { label: "JSON", badgeClass: STRUCTURED },
	yaml: { label: "YAML", badgeClass: STRUCTURED },
	yml: { label: "YAML", badgeClass: STRUCTURED },
	toml: { label: "TOML", badgeClass: STRUCTURED },
	xml: { label: "XML", badgeClass: STRUCTURED },

	csv: { label: "CSV", badgeClass: DATA },
	tsv: { label: "TSV", badgeClass: DATA },
	jsonl: { label: "JSONL", badgeClass: DATA },
	ndjson: { label: "NDJSON", badgeClass: DATA },

	html: { label: "HTML", badgeClass: WEB },
	htm: { label: "HTML", badgeClass: WEB },
	css: { label: "CSS", badgeClass: WEB },

	js: { label: "JS", badgeClass: CODE },
	jsx: { label: "JSX", badgeClass: CODE },
	ts: { label: "TS", badgeClass: CODE },
	tsx: { label: "TSX", badgeClass: CODE },
	py: { label: "PY", badgeClass: CODE },
	go: { label: "GO", badgeClass: CODE },
	rs: { label: "RS", badgeClass: CODE },
	java: { label: "JAVA", badgeClass: CODE },
	kt: { label: "KT", badgeClass: CODE },
	rb: { label: "RB", badgeClass: CODE },
	sh: { label: "SH", badgeClass: CODE },

	pdf: { label: "PDF", badgeClass: BINARY },
	docx: { label: "DOCX", badgeClass: BINARY },
	doc: { label: "DOC", badgeClass: BINARY },
};

export function extOf(name: string | null | undefined): string {
	if (!name) return "";
	const dot = name.lastIndexOf(".");
	if (dot < 0 || dot === name.length - 1) return "";
	return name.slice(dot + 1).toLowerCase();
}

export function fileTypeMeta(ext: string): FileTypeMeta {
	if (!ext) return { label: "FILE", badgeClass: UNKNOWN };
	return (
		META[ext] ?? { label: ext.slice(0, 6).toUpperCase(), badgeClass: UNKNOWN }
	);
}

const KB = 1024;
const MB = 1024 * 1024;
const GB = 1024 * 1024 * 1024;

export function formatFileSize(bytes: number | null | undefined): string {
	if (bytes === null || bytes === undefined) return "—";
	if (bytes < KB) return `${bytes} B`;
	if (bytes < MB) return `${(bytes / KB).toFixed(1)} KB`;
	if (bytes < GB) return `${(bytes / MB).toFixed(1)} MB`;
	return `${(bytes / GB).toFixed(1)} GB`;
}
