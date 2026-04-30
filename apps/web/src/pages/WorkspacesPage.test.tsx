/**
 * WorkspacesPage smoke tests.
 *
 * The page is the app's landing route. Three branches matter for a
 * unit test: loading, error, and the empty-state redirect to
 * `/onboarding`. The "happy" branch (data present) is exercised
 * indirectly through the WorkspaceCard tests + the e2e golden path,
 * so this file stays focused on the page-level branching that
 * WorkspaceCard tests can't see.
 */

import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/hooks/useWorkspaces", () => ({
	useWorkspaces: vi.fn(),
}));

import { useWorkspaces } from "@/hooks/useWorkspaces";
import { WorkspacesPage } from "./WorkspacesPage";

const mockedUseWorkspaces = vi.mocked(useWorkspaces);

afterEach(() => {
	mockedUseWorkspaces.mockReset();
});

function renderPage() {
	return render(
		<MemoryRouter initialEntries={["/"]}>
			<Routes>
				<Route path="/" element={<WorkspacesPage />} />
				<Route path="/onboarding" element={<div>Onboarding stub</div>} />
			</Routes>
		</MemoryRouter>,
	);
}

describe("WorkspacesPage", () => {
	it("shows the loading state while fetching", () => {
		mockedUseWorkspaces.mockReturnValue({
			data: undefined,
			isLoading: true,
			isError: false,
			error: null,
			refetch: vi.fn(),
			isFetching: true,
		} as unknown as ReturnType<typeof useWorkspaces>);

		renderPage();
		expect(screen.getByText(/Loading workspaces/i)).toBeInTheDocument();
	});

	it("shows the error state with a retry button on failure", () => {
		const refetch = vi.fn();
		mockedUseWorkspaces.mockReturnValue({
			data: undefined,
			isLoading: false,
			isError: true,
			error: new Error("network down"),
			refetch,
			isFetching: false,
		} as unknown as ReturnType<typeof useWorkspaces>);

		renderPage();
		expect(screen.getByText(/Couldn't load workspaces/i)).toBeInTheDocument();
		expect(screen.getByText(/network down/i)).toBeInTheDocument();
	});

	it("redirects to /onboarding when the list is empty", () => {
		mockedUseWorkspaces.mockReturnValue({
			data: [],
			isLoading: false,
			isError: false,
			error: null,
			refetch: vi.fn(),
			isFetching: false,
		} as unknown as ReturnType<typeof useWorkspaces>);

		renderPage();
		expect(screen.getByText(/Onboarding stub/i)).toBeInTheDocument();
	});

	it("renders the heading + workspace cards when data is present", () => {
		mockedUseWorkspaces.mockReturnValue({
			data: [
				{
					workspaceId: "00000000-0000-4000-8000-000000000001",
					name: "research-lab",
					kind: "astra",
					credentialsRef: { token: "env:ASTRA_TOKEN" },
					createdAt: "2026-04-01T00:00:00.000Z",
					updatedAt: "2026-04-01T00:00:00.000Z",
				},
			],
			isLoading: false,
			isError: false,
			error: null,
			refetch: vi.fn(),
			isFetching: false,
		} as unknown as ReturnType<typeof useWorkspaces>);

		renderPage();
		expect(
			screen.getByRole("heading", { name: /Workspaces/i }),
		).toBeInTheDocument();
		expect(screen.getByText("research-lab")).toBeInTheDocument();
		expect(screen.getByText(/sorted by creation time/i)).toBeInTheDocument();
	});
});
