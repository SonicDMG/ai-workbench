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

vi.mock("@/hooks/useRlac", () => ({
	usePrincipals: () => ({
		data: principalsState.data,
		error: principalsState.error,
		isLoading: principalsState.isLoading,
		isError: principalsState.isError,
	}),
}));

vi.mock("@/lib/viewAs", () => ({
	getViewAsPrincipal: () => null,
	setViewAsPrincipal: vi.fn(),
	setActiveWorkspaceId: vi.fn(),
	subscribeViewAs: (_cb: (next: string | null) => void) => () => undefined,
}));

vi.mock("@tanstack/react-query", () => ({
	useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));

import { ViewAsPicker } from "./ViewAsPicker";

function makePrincipal(
	overrides: Partial<PrincipalRecord> = {},
): PrincipalRecord {
	return {
		workspaceId: "00000000-0000-4000-8000-000000000001",
		principalId: "alice@example.com",
		label: "Alice",
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
});

describe("ViewAsPicker", () => {
	it("renders nothing when the principals list is empty", () => {
		principalsState.data = [];
		const { container } = render(<ViewAsPicker workspace="ws-1" />);
		expect(container.firstChild).toBeNull();
	});

	it("renders the pill, label, and one <option> per principal", () => {
		principalsState.data = [
			makePrincipal({ principalId: "alice@example.com", label: "Alice" }),
			makePrincipal({ principalId: "bob@example.com", label: null }),
		];
		render(<ViewAsPicker workspace="ws-1" />);

		expect(screen.getByText("View as")).toBeInTheDocument();
		// Select is exposed via its aria-label.
		const select = screen.getByLabelText("View as principal");
		expect(select).toBeInTheDocument();

		// Option with a label renders as "<label> (<principalId>)".
		expect(
			screen.getByRole("option", { name: "Alice (alice@example.com)" }),
		).toBeInTheDocument();
		// Option without a label falls back to just the principalId.
		expect(
			screen.getByRole("option", { name: "bob@example.com" }),
		).toBeInTheDocument();
	});
});
