/**
 * Behaviour tests for VisibilityPicker — the three-mode (Only You /
 * Public / Custom) RLAC visibility selector.
 *
 * Covers two layers:
 *   1. value → view derivation: which mode radio is checked given a
 *      particular `value` + `currentPrincipal` combination, and which
 *      chips render with what `aria-pressed` state.
 *   2. user interaction → onChange contract: clicking a radio or a
 *      principal chip emits the right `visibleTo` payload, with the
 *      "self" pin enforced everywhere it should be.
 */

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PrincipalRecord } from "@/lib/schemas";

type PrincipalsState = {
	data: PrincipalRecord[] | undefined;
	error: Error | null;
	isLoading: boolean;
	isError: boolean;
};

const principalsState: PrincipalsState = {
	data: undefined,
	error: null,
	isLoading: false,
	isError: false,
};

const viewAsState: { current: string | null } = { current: null };

vi.mock("@/hooks/useRlac", () => ({
	usePrincipals: () => ({
		data: principalsState.data,
		error: principalsState.error,
		isLoading: principalsState.isLoading,
		isError: principalsState.isError,
	}),
}));

vi.mock("@/lib/viewAs", () => ({
	getViewAsPrincipal: () => viewAsState.current,
	subscribeViewAs: (_cb: (next: string | null) => void) => () => undefined,
}));

import { VisibilityPicker } from "./VisibilityPicker";

function makePrincipal(
	overrides: Partial<PrincipalRecord> = {},
): PrincipalRecord {
	return {
		workspaceId: "00000000-0000-4000-8000-000000000001",
		principalId: "alice@example.com",
		label: null,
		attributes: {},
		createdAt: "2026-05-14T10:00:00.000Z",
		updatedAt: "2026-05-14T10:00:00.000Z",
		...overrides,
	};
}

beforeEach(() => {
	principalsState.data = undefined;
	principalsState.error = null;
	principalsState.isLoading = false;
	principalsState.isError = false;
	viewAsState.current = null;
});

describe("VisibilityPicker — value → view derivation", () => {
	it("renders the three mode radios and defaults to Only-You when a principal is in flight", () => {
		viewAsState.current = "me";
		principalsState.data = [makePrincipal({ principalId: "me" })];
		render(
			<VisibilityPicker workspace="ws-1" value={null} onChange={() => {}} />,
		);

		expect(screen.getByText("Only You")).toBeInTheDocument();
		expect(screen.getByText("Public")).toBeInTheDocument();
		expect(screen.getByText("Custom")).toBeInTheDocument();

		const radios = screen.getAllByRole("radio");
		expect(radios).toHaveLength(3);
		const onlyYou = radios.find((r) => r.getAttribute("value") === "only-you");
		expect((onlyYou as HTMLInputElement).checked).toBe(true);
	});

	it("disables Only-You and surfaces the 'View as' hint when no principal is in flight", () => {
		viewAsState.current = null;
		principalsState.data = [
			makePrincipal({ principalId: "alice@example.com" }),
		];
		render(
			<VisibilityPicker workspace="ws-1" value={null} onChange={() => {}} />,
		);
		const radios = screen.getAllByRole("radio");
		const onlyYou = radios.find(
			(r) => r.getAttribute("value") === "only-you",
		) as HTMLInputElement;
		expect(onlyYou.disabled).toBe(true);
	});

	it("renders Public mode when value is ['*'] and hides the custom chip strip", () => {
		viewAsState.current = "me";
		principalsState.data = [makePrincipal({ principalId: "me" })];
		render(
			<VisibilityPicker workspace="ws-1" value={["*"]} onChange={() => {}} />,
		);

		const radios = screen.getAllByRole("radio");
		const publicRadio = radios.find(
			(r) => r.getAttribute("value") === "public",
		);
		expect((publicRadio as HTMLInputElement).checked).toBe(true);

		expect(
			screen.getByText(
				/Every principal in this workspace can read these documents\./,
			),
		).toBeInTheDocument();
		expect(screen.queryByRole("button", { name: "me" })).toBeNull();
	});

	it("renders Custom mode with one chip per principal when value has named entries", () => {
		viewAsState.current = "me";
		principalsState.data = [
			makePrincipal({ principalId: "me" }),
			makePrincipal({ principalId: "alice@example.com" }),
			makePrincipal({ principalId: "bob@example.com" }),
		];
		render(
			<VisibilityPicker
				workspace="ws-1"
				value={["me", "alice@example.com"]}
				onChange={() => {}}
			/>,
		);

		const radios = screen.getAllByRole("radio");
		const customRadio = radios.find(
			(r) => r.getAttribute("value") === "custom",
		);
		expect((customRadio as HTMLInputElement).checked).toBe(true);

		const meChip = screen.getByRole("button", { name: /me/ });
		expect(meChip).toBeDisabled();
		expect(meChip).toHaveAttribute("aria-pressed", "true");

		const aliceChip = screen.getByRole("button", { name: "alice@example.com" });
		expect(aliceChip).toHaveAttribute("aria-pressed", "true");

		const bobChip = screen.getByRole("button", { name: "bob@example.com" });
		expect(bobChip).toHaveAttribute("aria-pressed", "false");
	});

	it("renders the empty-roster hint in Custom mode when there are no principals", () => {
		viewAsState.current = null;
		principalsState.data = [];
		render(
			<VisibilityPicker
				workspace="ws-1"
				value={["alice@example.com"]}
				onChange={() => {}}
			/>,
		);

		const radios = screen.getAllByRole("radio");
		const customRadio = radios.find(
			(r) => r.getAttribute("value") === "custom",
		);
		expect((customRadio as HTMLInputElement).checked).toBe(true);

		expect(
			screen.getByText(
				/No principals in this workspace yet\. Create some in workspace settings/,
			),
		).toBeInTheDocument();
	});
});

describe("VisibilityPicker — user interaction → onChange", () => {
	it("emits ['*'] when the user clicks the Public radio", async () => {
		const user = userEvent.setup();
		viewAsState.current = "me";
		principalsState.data = [makePrincipal({ principalId: "me" })];
		const onChange = vi.fn();
		render(
			<VisibilityPicker workspace="ws-1" value={null} onChange={onChange} />,
		);
		const radios = screen.getAllByRole("radio");
		const publicRadio = radios.find(
			(r) => r.getAttribute("value") === "public",
		) as HTMLInputElement;
		await user.click(publicRadio);
		expect(onChange).toHaveBeenCalledWith(["*"]);
	});

	it("emits [currentPrincipal] when the user clicks Only-You with a view-as set", async () => {
		const user = userEvent.setup();
		viewAsState.current = "me";
		principalsState.data = [makePrincipal({ principalId: "me" })];
		const onChange = vi.fn();
		render(
			<VisibilityPicker workspace="ws-1" value={["*"]} onChange={onChange} />,
		);
		const radios = screen.getAllByRole("radio");
		const onlyYou = radios.find(
			(r) => r.getAttribute("value") === "only-you",
		) as HTMLInputElement;
		await user.click(onlyYou);
		expect(onChange).toHaveBeenCalledWith(["me"]);
	});

	it("pins the current principal when switching to Custom so the user can't lock themselves out", async () => {
		const user = userEvent.setup();
		viewAsState.current = "me";
		principalsState.data = [
			makePrincipal({ principalId: "me" }),
			makePrincipal({ principalId: "alice@example.com" }),
		];
		const onChange = vi.fn();
		render(
			<VisibilityPicker workspace="ws-1" value={["*"]} onChange={onChange} />,
		);
		const radios = screen.getAllByRole("radio");
		const customRadio = radios.find(
			(r) => r.getAttribute("value") === "custom",
		) as HTMLInputElement;
		await user.click(customRadio);
		// Custom always re-adds the current principal; wildcard is dropped.
		expect(onChange).toHaveBeenCalledWith(["me"]);
	});

	it("toggles a non-self principal on/off in Custom mode while keeping self pinned", async () => {
		const user = userEvent.setup();
		viewAsState.current = "me";
		principalsState.data = [
			makePrincipal({ principalId: "me" }),
			makePrincipal({ principalId: "alice@example.com" }),
			makePrincipal({ principalId: "bob@example.com" }),
		];
		const onChange = vi.fn();
		render(
			<VisibilityPicker
				workspace="ws-1"
				value={["me", "alice@example.com"]}
				onChange={onChange}
			/>,
		);

		// Bob is unselected → click adds him.
		await user.click(screen.getByRole("button", { name: "bob@example.com" }));
		expect(onChange).toHaveBeenLastCalledWith([
			"alice@example.com",
			"bob@example.com",
			"me",
		]);

		onChange.mockClear();

		// Alice is selected → click removes her, but self ("me") stays pinned.
		await user.click(screen.getByRole("button", { name: "alice@example.com" }));
		expect(onChange).toHaveBeenLastCalledWith(["me"]);
	});

	it("does NOT emit when the user clicks their own (self) chip in Custom mode", async () => {
		const user = userEvent.setup();
		viewAsState.current = "me";
		principalsState.data = [
			makePrincipal({ principalId: "me" }),
			makePrincipal({ principalId: "alice@example.com" }),
		];
		const onChange = vi.fn();
		render(
			<VisibilityPicker
				workspace="ws-1"
				value={["me", "alice@example.com"]}
				onChange={onChange}
			/>,
		);
		// The self chip is `disabled`; user.click is a no-op on disabled
		// elements, which is the contract we want: the user cannot remove
		// themselves from their own visibility set.
		await user.click(screen.getByRole("button", { name: /me/ }));
		expect(onChange).not.toHaveBeenCalled();
	});
});
