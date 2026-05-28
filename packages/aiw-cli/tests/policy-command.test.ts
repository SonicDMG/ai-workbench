/**
 * Pure-renderer tests for `aiw policy preview` and `aiw policy audit`.
 * The citty wrapper is exercised by the smoke suite; here we lock the
 * human layout of the compile-preview block (parseError vs issues vs
 * compiled-filter pretty-print) and the per-row audit format.
 */

import { describe, expect, it } from "vitest";
import {
	renderAuditRow,
	renderCompilePreview,
} from "../src/commands/policy.js";
import type { PolicyAuditRecord, PolicyCompilePreview } from "../src/types.js";

const okPreview: PolicyCompilePreview = {
	ok: true,
	parseError: null,
	issues: [],
	compiledFilter: { $or: [{ visible_to: "alice" }, { visible_to: "*" }] },
	principalId: "alice",
};

const issuesPreview: PolicyCompilePreview = {
	ok: false,
	parseError: null,
	issues: [
		{
			code: "row_to_row_comparison",
			message: "Row column compared against another row column",
			hint: "Compare against a literal or $principal.<attr> instead.",
		},
		{ code: "constant_only_comparison", message: "Both sides are literals" },
	],
	compiledFilter: null,
	principalId: null,
};

const parseFailedPreview: PolicyCompilePreview = {
	ok: false,
	parseError: "unexpected token at position 12",
	issues: [],
	compiledFilter: null,
	principalId: null,
};

const auditRow: PolicyAuditRecord = {
	workspaceId: "00000000-0000-4000-8000-000000000001",
	auditDay: "2026-05-27",
	ts: "2026-05-27T12:00:00.000Z",
	decisionId: "00000000-0000-4000-8000-aaaaaaaaaaaa",
	principalId: "alice",
	knowledgeBaseId: "00000000-0000-4000-8000-bbbbbbbbbbbb",
	resourceId: "doc-1",
	action: "list",
	decision: "filter",
	reason: "rlac_filter",
	compiledFilterJson: '{"$or":[{"visible_to":"alice"}]}',
};

describe("renderCompilePreview", () => {
	it("on success, shows ok + principal + the compiled filter as pretty JSON", () => {
		const out = renderCompilePreview(okPreview);
		expect(out).toMatch(/ok\s+true/);
		expect(out).toMatch(/principal\s+alice/);
		// Pretty-printed filter spans multiple lines.
		expect(out).toContain("$or");
		expect(out).toContain("visible_to");
	});

	it("on parse failure, surfaces the error message and no compiled filter", () => {
		const out = renderCompilePreview(parseFailedPreview);
		expect(out).toMatch(/ok\s+false/);
		expect(out).toContain("parse error: unexpected token at position 12");
		expect(out).not.toContain("compiled filter");
	});

	it("renders the issues list (code + message + optional hint) when present", () => {
		const out = renderCompilePreview(issuesPreview);
		expect(out).toContain("issues:");
		expect(out).toContain("[row_to_row_comparison]");
		expect(out).toContain("Row column compared against another row column");
		// Hint is indented under the issue.
		expect(out).toContain("hint: Compare against a literal");
		// Second issue, no hint.
		expect(out).toContain("[constant_only_comparison]");
	});

	it("shows '(unbound)' when principalId is null but compile succeeded", () => {
		const out = renderCompilePreview({
			...okPreview,
			principalId: null,
		});
		expect(out).toMatch(/principal\s+\(unbound\)/);
	});

	it("emits 'issues: (none)' when issues array is empty", () => {
		const out = renderCompilePreview(okPreview);
		expect(out).toContain("issues:     (none)");
	});
});

describe("renderAuditRow", () => {
	it("packs ts + decision + action + principal + resource onto one line", () => {
		const out = renderAuditRow(auditRow);
		expect(out).toContain("2026-05-27T12:00:00.000Z");
		expect(out).toContain("filter");
		expect(out).toContain("list");
		expect(out).toContain("alice");
		expect(out).toContain("doc-1");
		expect(out).toContain("rlac_filter");
		// Single line per row.
		expect(out.split("\n")).toHaveLength(1);
	});

	it("shows '(none)' when principalId is null", () => {
		const out = renderAuditRow({ ...auditRow, principalId: null });
		expect(out).toContain("(none)");
	});

	it("does not leak compiledFilterJson in the one-line view", () => {
		const out = renderAuditRow(auditRow);
		expect(out).not.toContain("visible_to");
	});
});
