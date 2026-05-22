/**
 * Regenerate `docs/errors.md` from the error-code registry at
 * {@link ../src/lib/error-codes.ts}.
 *
 * Runs via `tsx` so the registry is imported directly — no separate
 * build step. Drift-checked by `tests/errors-doc.test.ts`: if you edit
 * the registry without regenerating, `npm test` fails.
 *
 * Usage:
 *   npm run docs:errors          # write to disk
 *   npm run docs:errors -- --check  # diff-only; exit 1 on drift
 */

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
	type ErrorCodeDescriptor,
	listErrorCodes,
} from "../src/lib/error-codes.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "../../..");
const OUTPUT = resolve(REPO_ROOT, "docs/errors.md");

export function renderErrorsMarkdown(
	entries: readonly ErrorCodeDescriptor[],
): string {
	const lines: string[] = [];
	lines.push("# Error codes");
	lines.push("");
	lines.push(
		"AI Workbench returns every error in a stable envelope:",
		"",
		"```json",
		"{",
		'  "error": {',
		'    "code": "workspace_not_found",',
		'    "message": "workspace \\"ws_123\\" not found",',
		'    "requestId": "01HY2Z...",',
		'    "hint": "The workspace does not exist or your principal cannot see it; run `aiw workspace list` to verify.",',
		'    "docs": "docs/errors.md#workspace-not-found"',
		"  }",
		"}",
		"```",
		"",
		"The `code` field is stable across releases. The table below maps",
		"every registered code to its canonical HTTP status and remediation",
		"hint; the long-form sections that follow are the canonical",
		"destination for the envelope's `docs` field.",
		"",
		"<!-- GENERATED FROM runtimes/typescript/src/lib/error-codes.ts —",
		"     re-run `npm run docs:errors` after editing the registry. -->",
		"",
		"## Index",
		"",
		"| Code | Status | Hint |",
		"|---|---|---|",
	);
	for (const e of entries) {
		const hint = e.hint.replace(/\|/g, "\\|");
		lines.push(
			`| [\`${e.code}\`](#${e.docsAnchor}) | ${e.defaultStatus} | ${hint} |`,
		);
	}
	lines.push("");
	lines.push("---");
	lines.push("");
	for (const e of entries) {
		lines.push(`## ${e.code}`);
		lines.push("");
		lines.push(`- **Default status**: \`${e.defaultStatus}\``);
		lines.push(`- **Hint**: ${e.hint}`);
		lines.push("");
	}
	return `${lines.join("\n")}\n`;
}

function main(): void {
	const entries = listErrorCodes();
	const rendered = renderErrorsMarkdown(entries);
	const checkOnly = process.argv.includes("--check");
	if (checkOnly) {
		let existing = "";
		try {
			existing = readFileSync(OUTPUT, "utf8");
		} catch {
			existing = "";
		}
		if (existing === rendered) {
			process.exit(0);
		}
		process.stderr.write(
			"docs/errors.md is stale — re-run `npm run docs:errors`.\n",
		);
		process.exit(1);
	}
	writeFileSync(OUTPUT, rendered);
	process.stderr.write(`wrote ${OUTPUT} (${entries.length} codes)\n`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
	main();
}
