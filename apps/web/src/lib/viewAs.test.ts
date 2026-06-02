import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	DEFAULT_VIEW_AS_PRINCIPAL,
	getViewAs,
	setViewAs,
	subscribe,
	viewAsHeaderValue,
} from "./viewAs";

const WS = "00000000-0000-4000-8000-000000000001";
const OTHER = "00000000-0000-4000-8000-000000000002";

describe("viewAs", () => {
	beforeEach(() => {
		window.localStorage.clear();
	});
	afterEach(() => {
		window.localStorage.clear();
	});

	it("returns null (= admin default) when nothing is selected", () => {
		expect(getViewAs(WS)).toBeNull();
	});

	it("stores and reads an explicit selection", () => {
		setViewAs(WS, "alice");
		expect(getViewAs(WS)).toBe("alice");
		// Independent per workspace.
		expect(getViewAs(OTHER)).toBeNull();
	});

	it("models admin / default as the absence of a stored value", () => {
		setViewAs(WS, "bob");
		expect(getViewAs(WS)).toBe("bob");
		setViewAs(WS, DEFAULT_VIEW_AS_PRINCIPAL);
		expect(getViewAs(WS)).toBeNull();
	});

	it("clearing with null removes the entry", () => {
		setViewAs(WS, "carol");
		setViewAs(WS, null);
		expect(getViewAs(WS)).toBeNull();
	});

	it("notifies subscribers on change and stops after unsubscribe", () => {
		const fn = vi.fn();
		const unsub = subscribe(fn);
		setViewAs(WS, "alice");
		expect(fn).toHaveBeenCalledTimes(1);
		unsub();
		setViewAs(WS, "bob");
		expect(fn).toHaveBeenCalledTimes(1);
	});

	it("tolerates a corrupt storage blob", () => {
		window.localStorage.setItem("wb_view_as", "{not json");
		expect(getViewAs(WS)).toBeNull();
	});

	describe("viewAsHeaderValue", () => {
		it("sends the default admin for a workspace path when there is no token", () => {
			expect(
				viewAsHeaderValue(
					`/workspaces/${WS}/knowledge-bases/k/documents`,
					false,
				),
			).toBe(DEFAULT_VIEW_AS_PRINCIPAL);
		});

		it("sends nothing for a workspace path when a token is present (default selection)", () => {
			expect(
				viewAsHeaderValue(
					`/workspaces/${WS}/knowledge-bases/k/documents`,
					true,
				),
			).toBeNull();
		});

		it("sends an explicit selection regardless of token", () => {
			setViewAs(WS, "alice");
			expect(viewAsHeaderValue(`/workspaces/${WS}/documents`, true)).toBe(
				"alice",
			);
			expect(viewAsHeaderValue(`/workspaces/${WS}/documents`, false)).toBe(
				"alice",
			);
		});

		it("ignores non-workspace and placeholder paths", () => {
			expect(viewAsHeaderValue("/workspaces", false)).toBeNull();
			expect(viewAsHeaderValue("/llm-models/openai", false)).toBeNull();
			expect(
				viewAsHeaderValue("/workspaces/_/knowledge-bases/_/documents", false),
			).toBeNull();
		});
	});
});
