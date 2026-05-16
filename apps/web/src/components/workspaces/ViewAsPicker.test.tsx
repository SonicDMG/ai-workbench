/**
 * Behaviour tests for ViewAsPicker — the workspace-header chip that
 * lets the operator impersonate different RLAC principals.
 *
 * Covers:
 *   - empty-roster → renders nothing (the picker is invisible unless
 *     a principal exists to pick).
 *   - one <option> per principal, with the label-or-id fallback.
 *   - workspace-id lifecycle: setActiveWorkspaceId is called with the
 *     workspace on mount and cleared on unmount.
 *   - auto-select default: when no view-as is set on mount, the picker
 *     auto-selects the first principal and invalidates workspace
 *     queries.
 *   - manual change: choosing a different <option> calls
 *     setViewAsPrincipal and invalidates the workspace cache.
 */

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PrincipalRecord } from "@/lib/schemas";

type PrincipalsState = {
	data: PrincipalRecord[] | undefined;
	error: Error | null;
	isLoading: boolean;
	isError: boolean;
};

const mocks = vi.hoisted(() => {
	const viewAsState: { current: string | null } = { current: null };
	return {
		principalsState: {
			data: undefined,
			error: null,
			isLoading: false,
			isError: false,
		} as PrincipalsState,
		viewAsState,
		setViewAsPrincipal: vi.fn((next: string | null) => {
			mocks.viewAsState.current = next;
		}),
		setActiveWorkspaceId: vi.fn(),
		invalidateQueries: vi.fn(),
	};
});

vi.mock("@/hooks/useRlac", () => ({
	usePrincipals: () => ({
		data: mocks.principalsState.data,
		error: mocks.principalsState.error,
		isLoading: mocks.principalsState.isLoading,
		isError: mocks.principalsState.isError,
	}),
}));

vi.mock("@/lib/viewAs", () => ({
	getViewAsPrincipal: () => mocks.viewAsState.current,
	setViewAsPrincipal: mocks.setViewAsPrincipal,
	setActiveWorkspaceId: mocks.setActiveWorkspaceId,
	subscribeViewAs: (_cb: (next: string | null) => void) => () => undefined,
}));

vi.mock("@tanstack/react-query", () => ({
	useQueryClient: () => ({ invalidateQueries: mocks.invalidateQueries }),
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
	mocks.principalsState.data = undefined;
	mocks.principalsState.error = null;
	mocks.principalsState.isLoading = false;
	mocks.principalsState.isError = false;
	mocks.viewAsState.current = null;
	mocks.setViewAsPrincipal.mockClear();
	mocks.setActiveWorkspaceId.mockClear();
	mocks.invalidateQueries.mockClear();
});

describe("ViewAsPicker", () => {
	it("renders nothing when the principals list is empty", () => {
		mocks.principalsState.data = [];
		const { container } = render(<ViewAsPicker workspace="ws-1" />);
		expect(container.firstChild).toBeNull();
	});

	it("renders the pill, label, and one <option> per principal", () => {
		mocks.principalsState.data = [
			makePrincipal({ principalId: "alice@example.com", label: "Alice" }),
			makePrincipal({ principalId: "bob@example.com", label: null }),
		];
		mocks.viewAsState.current = "alice@example.com";
		render(<ViewAsPicker workspace="ws-1" />);

		expect(screen.getByText("View as")).toBeInTheDocument();
		const select = screen.getByLabelText("View as principal");
		expect(select).toBeInTheDocument();

		expect(
			screen.getByRole("option", { name: "Alice (alice@example.com)" }),
		).toBeInTheDocument();
		expect(
			screen.getByRole("option", { name: "bob@example.com" }),
		).toBeInTheDocument();
	});

	it("registers the active workspace on mount and clears it on unmount", () => {
		mocks.principalsState.data = [makePrincipal({ principalId: "alice@example.com" })];
		const { unmount } = render(<ViewAsPicker workspace="ws-1" />);
		expect(mocks.setActiveWorkspaceId).toHaveBeenCalledWith("ws-1");
		mocks.setActiveWorkspaceId.mockClear();
		unmount();
		expect(mocks.setActiveWorkspaceId).toHaveBeenCalledWith(null);
	});

	it("auto-selects the first principal when no view-as has been picked yet", async () => {
		mocks.principalsState.data = [
			makePrincipal({ principalId: "alice@example.com" }),
			makePrincipal({ principalId: "bob@example.com" }),
		];
		mocks.viewAsState.current = null;
		render(<ViewAsPicker workspace="ws-1" />);
		await waitFor(() => {
			expect(mocks.setViewAsPrincipal).toHaveBeenCalledWith("alice@example.com");
		});
		expect(mocks.invalidateQueries).toHaveBeenCalledWith({
			queryKey: ["workspaces", "ws-1"],
		});
	});

	it("does NOT overwrite an existing view-as on mount", async () => {
		mocks.principalsState.data = [
			makePrincipal({ principalId: "alice@example.com" }),
			makePrincipal({ principalId: "bob@example.com" }),
		];
		mocks.viewAsState.current = "bob@example.com";
		render(<ViewAsPicker workspace="ws-1" />);
		// give effects a turn of the event loop
		await new Promise((r) => setTimeout(r, 0));
		expect(mocks.setViewAsPrincipal).not.toHaveBeenCalled();
	});

	it("calls setViewAsPrincipal and invalidates the workspace cache when the operator changes selection", async () => {
		const user = userEvent.setup();
		mocks.principalsState.data = [
			makePrincipal({ principalId: "alice@example.com" }),
			makePrincipal({ principalId: "bob@example.com" }),
		];
		mocks.viewAsState.current = "alice@example.com";
		render(<ViewAsPicker workspace="ws-1" />);

		const select = screen.getByLabelText(
			"View as principal",
		) as HTMLSelectElement;
		await user.selectOptions(select, "bob@example.com");

		expect(mocks.setViewAsPrincipal).toHaveBeenCalledWith("bob@example.com");
		expect(mocks.invalidateQueries).toHaveBeenCalledWith({
			queryKey: ["workspaces", "ws-1"],
		});
	});
});
