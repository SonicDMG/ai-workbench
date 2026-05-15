import { render, screen } from "@testing-library/react";
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

describe("VisibilityPicker", () => {
	it("renders the three mode radios and defaults to Only-You when a principal is in flight", () => {
		viewAsState.current = "me";
		principalsState.data = [makePrincipal({ principalId: "me" })];
		render(
			<VisibilityPicker workspace="ws-1" value={null} onChange={() => {}} />,
		);

		// All three mode labels render.
		expect(screen.getByText("Only You")).toBeInTheDocument();
		expect(screen.getByText("Public")).toBeInTheDocument();
		expect(screen.getByText("Custom")).toBeInTheDocument();

		// Three radios — Only-You is the checked one when value is null and
		// a principal is in flight.
		const radios = screen.getAllByRole("radio");
		expect(radios).toHaveLength(3);
		const onlyYou = radios.find((r) => r.getAttribute("value") === "only-you");
		expect(onlyYou).toBeDefined();
		expect((onlyYou as HTMLInputElement).checked).toBe(true);
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

		// Custom chip strip is not rendered in public mode.
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

		// One chip button per principal — three total.
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
