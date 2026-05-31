import { describe, expect, it } from "vitest";
import { resolveRlacDefaults } from "../../src/routes/api-v1/rlac-defaults.js";

const ALICE = { id: "alice" };

describe("resolveRlacDefaults", () => {
	it("leaves both fields omitted when RLAC is off", () => {
		expect(resolveRlacDefaults(false, ALICE, {})).toEqual({
			visibleTo: undefined,
			ownerPrincipalId: undefined,
		});
	});

	it("leaves both fields omitted when there is no principal", () => {
		expect(resolveRlacDefaults(true, null, {})).toEqual({
			visibleTo: undefined,
			ownerPrincipalId: undefined,
		});
	});

	it("defaults both to the caller when RLAC on and both omitted", () => {
		expect(resolveRlacDefaults(true, ALICE, {})).toEqual({
			visibleTo: ["alice"],
			ownerPrincipalId: "alice",
		});
	});

	// The canonical rule: owner defaults independently of visibleTo.
	it("defaults owner to the caller even when visibleTo is supplied", () => {
		expect(
			resolveRlacDefaults(true, ALICE, { visibleTo: ["bob", "carol"] }),
		).toEqual({
			visibleTo: ["bob", "carol"],
			ownerPrincipalId: "alice",
		});
	});

	it("defaults visibleTo to the caller even when owner is supplied", () => {
		expect(
			resolveRlacDefaults(true, ALICE, { ownerPrincipalId: "bob" }),
		).toEqual({
			visibleTo: ["alice"],
			ownerPrincipalId: "bob",
		});
	});

	it("passes both through untouched when the caller supplies both", () => {
		expect(
			resolveRlacDefaults(true, ALICE, {
				visibleTo: ["bob"],
				ownerPrincipalId: "carol",
			}),
		).toEqual({ visibleTo: ["bob"], ownerPrincipalId: "carol" });
	});

	it("preserves an explicit empty visibleTo (lock-out), still defaulting owner", () => {
		expect(resolveRlacDefaults(true, ALICE, { visibleTo: [] })).toEqual({
			visibleTo: [],
			ownerPrincipalId: "alice",
		});
	});

	// `visibleTo: null` is an explicit choice (admin-only), preserved as-is;
	// owner still defaults since it's independent provenance.
	it("preserves an explicit null visibleTo, still defaulting owner", () => {
		expect(resolveRlacDefaults(true, ALICE, { visibleTo: null })).toEqual({
			visibleTo: null,
			ownerPrincipalId: "alice",
		});
	});

	// `null` owner is coalesced like an omission — both mean "no owner".
	it("coalesces a null ownerPrincipalId to the caller default", () => {
		expect(
			resolveRlacDefaults(true, ALICE, { ownerPrincipalId: null }),
		).toEqual({ visibleTo: ["alice"], ownerPrincipalId: "alice" });
	});

	it("leaves a null ownerPrincipalId as undefined when RLAC is off", () => {
		expect(
			resolveRlacDefaults(false, ALICE, { ownerPrincipalId: null }),
		).toEqual({ visibleTo: undefined, ownerPrincipalId: undefined });
	});
});
