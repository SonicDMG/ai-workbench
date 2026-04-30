/**
 * OnboardingPage smoke tests. Two surfaces matter: the first-run hero
 * (workspaces empty) vs. the subsequent "New workspace" heading.
 */

import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/hooks/useWorkspaces", () => ({
	useWorkspaces: vi.fn(),
	useCreateWorkspace: vi.fn(),
}));
vi.mock("@/hooks/useAstraCliInfo", () => ({
	useAstraCliInfo: vi.fn(),
}));

import { useAstraCliInfo } from "@/hooks/useAstraCliInfo";
import { useCreateWorkspace, useWorkspaces } from "@/hooks/useWorkspaces";
import { OnboardingPage } from "./OnboardingPage";

afterEach(() => {
	vi.mocked(useWorkspaces).mockReset();
	vi.mocked(useCreateWorkspace).mockReset();
	vi.mocked(useAstraCliInfo).mockReset();
});

function setupHooks(workspaces: unknown[]) {
	vi.mocked(useWorkspaces).mockReturnValue({
		data: workspaces,
		isLoading: false,
		isError: false,
		error: null,
		refetch: vi.fn(),
		isFetching: false,
	} as unknown as ReturnType<typeof useWorkspaces>);
	vi.mocked(useCreateWorkspace).mockReturnValue({
		mutate: vi.fn(),
		mutateAsync: vi.fn(),
		isPending: false,
	} as unknown as ReturnType<typeof useCreateWorkspace>);
	vi.mocked(useAstraCliInfo).mockReturnValue({
		data: null,
	} as unknown as ReturnType<typeof useAstraCliInfo>);
}

describe("OnboardingPage", () => {
	it("renders the first-run hero when no workspaces exist yet", () => {
		setupHooks([]);
		render(
			<MemoryRouter>
				<OnboardingPage />
			</MemoryRouter>,
		);
		expect(
			screen.getByRole("heading", { name: /Manage AI-ready data at scale/i }),
		).toBeInTheDocument();
	});

	it("renders the compact 'New workspace' heading once a workspace exists", () => {
		setupHooks([
			{
				workspaceId: "00000000-0000-4000-8000-000000000001",
				name: "existing",
				kind: "astra",
				credentialsRef: { token: "env:T" },
				createdAt: "2026-04-01T00:00:00.000Z",
				updatedAt: "2026-04-01T00:00:00.000Z",
			},
		]);
		render(
			<MemoryRouter>
				<OnboardingPage />
			</MemoryRouter>,
		);
		expect(
			screen.getByRole("heading", { name: /New workspace/i }),
		).toBeInTheDocument();
	});
});
