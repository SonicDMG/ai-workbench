import { describe, expect, it } from "vitest";
import {
	extOf,
	fileTypeMeta,
	formatFileSize,
	isIngestableFile,
	isReadableTextFile,
	READABLE_TEXT_EXTENSIONS,
} from "./files";

describe("extOf", () => {
	it("returns the lowercase extension without the leading dot", () => {
		expect(extOf("notes.md")).toBe("md");
		expect(extOf("Foo.JSON")).toBe("json");
	});

	it("handles paths and multi-dot names", () => {
		expect(extOf("a/b/c/foo.bar.csv")).toBe("csv");
	});

	it("returns empty string when there is no extension", () => {
		expect(extOf("Makefile")).toBe("");
		expect(extOf("trailing.")).toBe("");
		expect(extOf(null)).toBe("");
		expect(extOf(undefined)).toBe("");
	});
});

describe("fileTypeMeta", () => {
	it("colors known extensions consistently", () => {
		expect(fileTypeMeta("md").label).toBe("MD");
		expect(fileTypeMeta("markdown").badgeClass).toBe(
			fileTypeMeta("md").badgeClass,
		);
		expect(fileTypeMeta("yml").badgeClass).toBe(
			fileTypeMeta("yaml").badgeClass,
		);
		expect(fileTypeMeta("ini").label).toBe("INI");
		expect(fileTypeMeta("sql").label).toBe("SQL");
	});

	it("falls back to a neutral badge with the upper-cased ext for unknowns", () => {
		const meta = fileTypeMeta("zzz");
		expect(meta.label).toBe("ZZZ");
		// Slate is the unknown sentinel; assert the badge is in that family.
		expect(meta.badgeClass).toContain("slate");
	});

	it("uses a generic FILE label when there is no extension", () => {
		expect(fileTypeMeta("").label).toBe("FILE");
	});
});

describe("isReadableTextFile", () => {
	it("accepts common plain-text document and config extensions without MIME hints", () => {
		expect(isReadableTextFile({ name: "guide.md", type: "" })).toBe(true);
		expect(isReadableTextFile({ name: "config.yaml", type: "" })).toBe(true);
		expect(isReadableTextFile({ name: "service.toml", type: "" })).toBe(true);
		expect(isReadableTextFile({ name: "settings.ini", type: "" })).toBe(true);
	});

	it("accepts source files and well-known extensionless text filenames", () => {
		expect(isReadableTextFile({ name: "main.ts", type: "" })).toBe(true);
		expect(isReadableTextFile({ name: "query.sql", type: "" })).toBe(true);
		expect(isReadableTextFile({ name: "Dockerfile", type: "" })).toBe(true);
		expect(isReadableTextFile({ name: "Makefile", type: "" })).toBe(true);
		expect(isReadableTextFile({ name: "README", type: "" })).toBe(true);
		expect(isReadableTextFile({ name: ".env.local", type: "" })).toBe(true);
	});

	it("accepts unknown extensions when the browser reports text MIME", () => {
		expect(
			isReadableTextFile({ name: "notes.custom", type: "text/plain" }),
		).toBe(true);
	});

	it("rejects likely binary files", () => {
		expect(isReadableTextFile({ name: "photo.png", type: "image/png" })).toBe(
			false,
		);
		expect(isReadableTextFile({ name: "archive.zip", type: "" })).toBe(false);
	});
});

describe("isIngestableFile", () => {
	it("accepts everything isReadableTextFile accepts", () => {
		expect(isIngestableFile({ name: "guide.md", type: "" })).toBe(true);
		expect(isIngestableFile({ name: "Makefile", type: "" })).toBe(true);
		expect(isIngestableFile({ name: "main.ts", type: "" })).toBe(true);
	});

	it("accepts PDF, DOCX, and XLSX uploads (server extracts text)", () => {
		expect(
			isIngestableFile({ name: "report.pdf", type: "application/pdf" }),
		).toBe(true);
		expect(isIngestableFile({ name: "REPORT.PDF", type: "" })).toBe(true);
		expect(
			isIngestableFile({
				name: "memo.docx",
				type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
			}),
		).toBe(true);
		expect(isIngestableFile({ name: "memo.docx", type: "" })).toBe(true);
		expect(
			isIngestableFile({
				name: "book.xlsx",
				type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
			}),
		).toBe(true);
		expect(isIngestableFile({ name: "BOOK.XLSX", type: "" })).toBe(true);
	});

	it("still rejects binaries the extractor can't handle", () => {
		expect(isIngestableFile({ name: "photo.png", type: "image/png" })).toBe(
			false,
		);
		expect(isIngestableFile({ name: "archive.zip", type: "" })).toBe(false);
		// Legacy `.doc` is intentionally rejected — see the docx extractor.
		expect(
			isIngestableFile({ name: "old.doc", type: "application/msword" }),
		).toBe(false);
	});
});

describe("READABLE_TEXT_EXTENSIONS", () => {
	it("includes document, config, data, and source extensions for the file picker", () => {
		expect(READABLE_TEXT_EXTENSIONS).toEqual(
			expect.arrayContaining([".md", ".yaml", ".toml", ".ini", ".sql", ".ts"]),
		);
	});
});

describe("formatFileSize", () => {
	it("renders bytes raw under 1 KB", () => {
		expect(formatFileSize(0)).toBe("0 B");
		expect(formatFileSize(512)).toBe("512 B");
	});

	it("steps up units at 1024-byte boundaries", () => {
		expect(formatFileSize(1500)).toBe("1.5 KB");
		expect(formatFileSize(1024 * 1024 * 3)).toBe("3.0 MB");
		expect(formatFileSize(1024 * 1024 * 1024 * 2)).toBe("2.0 GB");
	});

	it("renders an em-dash for null / undefined", () => {
		expect(formatFileSize(null)).toBe("—");
		expect(formatFileSize(undefined)).toBe("—");
	});
});
