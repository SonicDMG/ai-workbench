import { describe, expect, test } from "vitest";
import { hintForForbidden } from "../src/commands/login.js";

describe("hintForForbidden (403 RBAC guidance)", () => {
	test("missing 'manage' scope → points at the Admin preset + aiw key", () => {
		const hint = hintForForbidden(
			"authenticated subject is missing required scope 'manage'",
		);
		expect(hint).not.toBeNull();
		// Names the CLI mint command and the role/scope that grants it.
		expect(hint).toMatch(/aiw key create/);
		expect(hint).toMatch(/--role admin/);
		expect(hint).toMatch(/--scope manage/);
		// Calls out that manage is the admin tier.
		expect(hint?.toLowerCase()).toMatch(/admin tier|admin ops/);
	});

	test("missing 'write' scope → points at the Editor (or Admin) preset", () => {
		const hint = hintForForbidden(
			"authenticated subject is missing required scope 'write'",
		);
		expect(hint).toMatch(/Editor \(or Admin\)/);
		expect(hint).toMatch(/--role editor/);
		// Does NOT add the manage-specific addendum.
		expect(hint?.toLowerCase()).not.toMatch(/admin tier/);
	});

	test("missing a fine 'write:ingest' scope → recognized, names the fine scope", () => {
		const hint = hintForForbidden(
			"authenticated subject is missing required scope 'write:ingest'",
		);
		expect(hint).not.toBeNull();
		// The fine scope (with its colon) is echoed verbatim — the pre-0.5.0
		// `[a-z]+` regex silently missed this and fell back to a generic hint.
		expect(hint).toMatch(/--scope write:ingest/);
		// write tier → Editor preset, no manage addendum.
		expect(hint).toMatch(/--role editor/);
		expect(hint?.toLowerCase()).not.toMatch(/admin tier/);
	});

	test("missing a fine 'manage:keys' scope → admin tier + Admin preset", () => {
		const hint = hintForForbidden(
			"authenticated subject is missing required scope 'manage:keys'",
		);
		expect(hint).toMatch(/--scope manage:keys/);
		expect(hint).toMatch(/--role admin/);
		expect(hint?.toLowerCase()).toMatch(/admin tier/);
	});

	test("workspace-scope denial → not a role problem, suggests profile/key", () => {
		const hint = hintForForbidden(
			"authenticated subject is not authorized for workspace 'ws-123'",
		);
		expect(hint).toMatch(/ws-123/);
		expect(hint).toMatch(/workspace-scoped/);
		expect(hint).toMatch(/aiw login --profile/);
	});

	test("returns null for an unrecognized message (falls back to server hint)", () => {
		expect(hintForForbidden("some unrelated error")).toBeNull();
	});
});
