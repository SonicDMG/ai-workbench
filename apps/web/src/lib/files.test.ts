import { describe, expect, it } from "vitest";
import { extOf, fileTypeMeta, formatFileSize } from "./files";

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
