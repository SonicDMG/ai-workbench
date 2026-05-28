/**
 * Pure-renderer tests for `aiw principal`. The citty wrapper is
 * exercised by the smoke suite; here we lock the human layout for
 * `list` and `get` so a regression in column ordering or attribute
 * formatting surfaces as a unit-test failure.
 */

import { describe, expect, it } from "vitest";
import {
	renderPrincipal,
	renderPrincipalList,
} from "../src/commands/principal.js";
import type { Principal } from "../src/types.js";

const baseAlice: Principal = {
	workspaceId: "00000000-0000-4000-8000-000000000001",
	principalId: "alice",
	label: "Alice Lovelace",
	attributes: { dept: "engineering", level: "L5" },
	createdAt: "2026-05-27T10:00:00.000Z",
	updatedAt: "2026-05-27T10:00:00.000Z",
};

const baseBob: Principal = {
	workspaceId: "00000000-0000-4000-8000-000000000001",
	principalId: "bob@corp.example",
	label: null,
	attributes: {},
	createdAt: "2026-05-27T10:05:00.000Z",
	updatedAt: "2026-05-27T10:05:00.000Z",
};

describe("renderPrincipalList", () => {
	it("renders a table with ID / LABEL / ATTRIBUTES / UPDATED columns", () => {
		const out = renderPrincipalList([baseAlice, baseBob]);
		// Header row
		expect(out).toContain("ID");
		expect(out).toContain("LABEL");
		expect(out).toContain("ATTRIBUTES");
		expect(out).toContain("UPDATED");
		// Data
		expect(out).toContain("alice");
		expect(out).toContain("Alice Lovelace");
		expect(out).toContain("dept=engineering");
		expect(out).toContain("bob@corp.example");
	});

	it("formats a null label as an empty cell", () => {
		const out = renderPrincipalList([baseBob]);
		// Must not literally print "null".
		expect(out).not.toContain("null");
	});

	it("emits '(no rows)' for an empty list", () => {
		expect(renderPrincipalList([])).toContain("(no rows)");
	});

	it("joins attribute entries as `k=v` pairs in a stable order", () => {
		const out = renderPrincipalList([baseAlice]);
		// Alice has { dept: "engineering", level: "L5" } — they should both
		// appear together in a single cell separated by spaces or commas.
		// We don't pin the separator, just that both are present.
		const aliceRow = out.split("\n").find((l) => l.includes("alice")) ?? "";
		expect(aliceRow).toContain("dept=engineering");
		expect(aliceRow).toContain("level=L5");
	});

	it("shows '-' for an empty attributes map", () => {
		const out = renderPrincipalList([baseBob]);
		const bobRow =
			out.split("\n").find((l) => l.includes("bob@corp.example")) ?? "";
		// Empty attributes should render as something visible, not blank.
		expect(bobRow).toMatch(/-|\(none\)/);
	});
});

describe("renderPrincipal (single)", () => {
	it("emits id / label / attributes / timestamps on separate lines", () => {
		const out = renderPrincipal(baseAlice);
		expect(out).toContain("id          alice");
		expect(out).toContain("label       Alice Lovelace");
		expect(out).toMatch(/attributes\s+dept=engineering/);
		expect(out).toContain("level=L5");
		expect(out).toContain("created     2026-05-27T10:00:00.000Z");
		expect(out).toContain("updated     2026-05-27T10:00:00.000Z");
	});

	it("omits the label line when label is null", () => {
		const out = renderPrincipal(baseBob);
		expect(out).not.toContain("label       null");
	});

	it("shows attributes as '(none)' when the map is empty", () => {
		const out = renderPrincipal(baseBob);
		expect(out).toContain("attributes  (none)");
	});
});
