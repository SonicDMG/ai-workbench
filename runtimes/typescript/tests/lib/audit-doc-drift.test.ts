import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "../../../..");
const AUDIT_SRC = resolve(REPO_ROOT, "runtimes/typescript/src/lib/audit.ts");
const AUDIT_DOC = resolve(REPO_ROOT, "docs/audit.md");

/**
 * Parse the `AuditAction` discriminated union out of `audit.ts` and
 * compare it to the action column of the "What gets logged" table in
 * `docs/audit.md`. Drift between the two surfaces means either the
 * type grew without doc coverage or the doc references actions the
 * runtime no longer emits.
 */
describe("audit doc drift", () => {
	test("AuditAction union matches docs/audit.md table", () => {
		const sourceActions = parseAuditActionsFromSource();
		const docActions = parseAuditActionsFromDoc();

		expect(sourceActions.size).toBeGreaterThan(0);
		expect(docActions.size).toBeGreaterThan(0);

		const onlyInSource = [...sourceActions].filter((a) => !docActions.has(a));
		const onlyInDoc = [...docActions].filter((a) => !sourceActions.has(a));

		expect(
			onlyInSource,
			`actions in AuditAction union but missing from docs/audit.md table — add a row: ${onlyInSource.join(", ")}`,
		).toEqual([]);
		expect(
			onlyInDoc,
			`actions documented in docs/audit.md but not present in AuditAction union — remove the row or restore the type member: ${onlyInDoc.join(", ")}`,
		).toEqual([]);
	});
});

function parseAuditActionsFromSource(): Set<string> {
	const src = readFileSync(AUDIT_SRC, "utf8");
	const match = src.match(/export type AuditAction =([\s\S]*?);/);
	if (!match) {
		throw new Error("could not locate `export type AuditAction =` in audit.ts");
	}
	const body = match[1] ?? "";
	const actions = new Set<string>();
	for (const literal of body.matchAll(/"([^"]+)"/g)) {
		actions.add(literal[1] ?? "");
	}
	actions.delete("");
	return actions;
}

function parseAuditActionsFromDoc(): Set<string> {
	const doc = readFileSync(AUDIT_DOC, "utf8");
	const lines = doc.split("\n");
	const headerIdx = lines.findIndex((line) =>
		line.replace(/\s+/g, "").startsWith("|Action|"),
	);
	if (headerIdx < 0) {
		throw new Error(
			"could not locate the `| Action | Trigger | Notes |` table in docs/audit.md",
		);
	}
	const actions = new Set<string>();
	for (let i = headerIdx + 2; i < lines.length; i += 1) {
		const line = lines[i] ?? "";
		if (!line.startsWith("|")) break;
		const cells = line
			.split("|")
			.slice(1, -1)
			.map((cell) => cell.trim());
		const cell = cells[0] ?? "";
		const tick = cell.match(/`([^`]+)`/);
		if (tick) actions.add(tick[1] ?? "");
	}
	actions.delete("");
	return actions;
}
