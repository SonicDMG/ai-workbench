import { describe, expect, test } from "vitest";
import { hintForForbidden } from "../src/commands/login.js";

describe("hintForForbidden (403 RBAC guidance)", () => {
	test("missing 'manage' scope → points at the Admin role", () => {
		const hint = hintForForbidden(
			"authenticated subject is missing required scope 'manage'",
		);
		expect(hint).not.toBeNull();
		expect(hint).toMatch(/Admin role/);
		expect(hint).toMatch(/manage/);
		// Calls out that manage is the admin tier.
		expect(hint?.toLowerCase()).toMatch(/admin tier|admin ops/);
	});

	test("missing 'write' scope → points at Editor (or Admin)", () => {
		const hint = hintForForbidden(
			"authenticated subject is missing required scope 'write'",
		);
		expect(hint).toMatch(/Editor \(or Admin\)/);
		// Does NOT add the manage-specific addendum.
		expect(hint?.toLowerCase()).not.toMatch(/admin tier/);
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
