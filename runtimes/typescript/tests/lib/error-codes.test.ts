import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { renderErrorsMarkdown } from "../../scripts/gen-errors-doc.js";
import {
	getErrorCode,
	listErrorCodes,
	RESOURCE_NOT_FOUND_CODES,
} from "../../src/lib/error-codes.js";

const HERE = resolve(fileURLToPath(import.meta.url), "..");
const REPO_ROOT = resolve(HERE, "../../../..");
const RUNTIME_SRC = resolve(REPO_ROOT, "runtimes/typescript/src");
const ERRORS_DOC = resolve(REPO_ROOT, "docs/errors.md");

function walk(dir: string): string[] {
	const out: string[] = [];
	for (const name of readdirSync(dir)) {
		const full = join(dir, name);
		const stat = statSync(full);
		if (stat.isDirectory()) out.push(...walk(full));
		else if (name.endsWith(".ts")) out.push(full);
	}
	return out;
}

function collectThrownCodes(): Set<string> {
	const codes = new Set<string>();
	const apiErrorPattern = /throw new ApiError\(\s*"([a-z_][a-z0-9_]*)"/g;
	const conflictPattern =
		/new ControlPlaneConflictError\([^)]*,\s*"([a-z_][a-z0-9_]*)"/g;
	const envelopePattern = /errorEnvelope\(\s*c\s*,\s*"([a-z_][a-z0-9_]*)"/g;
	for (const file of walk(RUNTIME_SRC)) {
		const txt = readFileSync(file, "utf8");
		for (const m of txt.matchAll(apiErrorPattern)) {
			if (m[1]) codes.add(m[1]);
		}
		for (const m of txt.matchAll(conflictPattern)) {
			if (m[1]) codes.add(m[1]);
		}
		for (const m of txt.matchAll(envelopePattern)) {
			if (m[1]) codes.add(m[1]);
		}
	}
	return codes;
}

describe("error-codes registry", () => {
	test("every registered code has a non-empty hint and a docs anchor", () => {
		for (const entry of listErrorCodes()) {
			expect(entry.hint, `code ${entry.code} is missing a hint`).toMatch(/\S/);
			expect(
				entry.docsAnchor,
				`code ${entry.code} is missing a docs anchor`,
			).toMatch(/^[a-z0-9-]+$/);
		}
	});

	test("docs anchors are unique", () => {
		const seen = new Map<string, string>();
		for (const entry of listErrorCodes()) {
			const prior = seen.get(entry.docsAnchor);
			expect(
				prior,
				`anchor ${entry.docsAnchor} is used by both ${prior} and ${entry.code}`,
			).toBeUndefined();
			seen.set(entry.docsAnchor, entry.code);
		}
	});

	test("every code thrown in src is registered", () => {
		const thrown = collectThrownCodes();
		const orphans = [...thrown].filter((code) => !getErrorCode(code));
		expect(
			orphans,
			`These error codes are thrown but unregistered — add them to runtimes/typescript/src/lib/error-codes.ts: ${orphans.join(", ")}`,
		).toEqual([]);
	});

	test("every RESOURCE_NOT_FOUND_CODES target is registered", () => {
		for (const code of Object.values(RESOURCE_NOT_FOUND_CODES)) {
			expect(getErrorCode(code), `${code} missing from registry`).toBeDefined();
		}
	});

	test("docs/errors.md matches the registry (run `npm run docs:errors`)", () => {
		const expected = renderErrorsMarkdown(listErrorCodes());
		const actual = readFileSync(ERRORS_DOC, "utf8");
		expect(actual).toBe(expected);
	});
});
