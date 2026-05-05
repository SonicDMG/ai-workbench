import { describe, expect, it } from "vitest";
import { formatCurl, shellQuote } from "./curl";

describe("shellQuote", () => {
	it("wraps simple strings in single quotes", () => {
		expect(shellQuote("hello")).toBe("'hello'");
	});

	it("escapes embedded single quotes via the close/escape/open trick", () => {
		expect(shellQuote("it's fine")).toBe("'it'\\''s fine'");
	});

	it("preserves double quotes verbatim", () => {
		expect(shellQuote('say "hi"')).toBe(`'say "hi"'`);
	});

	it("preserves newlines verbatim (single quotes are literal)", () => {
		expect(shellQuote("line one\nline two")).toBe("'line one\nline two'");
	});

	it("handles empty strings", () => {
		expect(shellQuote("")).toBe("''");
	});
});

describe("formatCurl", () => {
	it("emits a method, URL, headers, and body in the expected layout", () => {
		const out = formatCurl({
			method: "POST",
			url: "https://example.com/api/v1/search",
			headers: {
				"Content-Type": "application/json",
				Authorization: "Bearer abc",
			},
			body: '{"text":"hello"}',
		});
		expect(out).toBe(
			[
				"curl -X POST 'https://example.com/api/v1/search' \\",
				"  -H 'Content-Type: application/json' \\",
				"  -H 'Authorization: Bearer abc' \\",
				`  --data '{"text":"hello"}'`,
			].join("\n"),
		);
	});

	it("omits the body line when no body is given", () => {
		const out = formatCurl({
			method: "GET",
			url: "https://example.com/health",
			headers: { Accept: "application/json" },
		});
		expect(out).toBe(
			"curl -X GET 'https://example.com/health' \\\n  -H 'Accept: application/json'",
		);
	});

	it("emits no header lines when headers is empty", () => {
		const out = formatCurl({
			method: "GET",
			url: "https://example.com/health",
		});
		expect(out).toBe("curl -X GET 'https://example.com/health'");
	});

	it("escapes single quotes inside body and headers", () => {
		const out = formatCurl({
			method: "POST",
			url: "https://example.com/api",
			headers: { "X-Note": "it's working" },
			body: `{"q":"don't break"}`,
		});
		expect(out).toContain("'X-Note: it'\\''s working'");
		expect(out).toContain(`'{"q":"don'\\''t break"}'`);
	});
});
