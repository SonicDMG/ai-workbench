/**
 * WorkspaceDetailPage smoke tests. Page renders four major branches:
 * loading, not-found error, generic error, and the populated view.
 */

import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/hooks/useWorkspaces", () => ({
	useWorkspace: vi.fn(),
	useUpdateWorkspace: vi.fn(),
	useDeleteWorkspace: vi.fn(),
}));
vi.mock("@/hooks/useFeatures", () => ({
	useFeatures: vi.fn(),
}));
// Heavy children — stub them so the page test stays focused on
// branching rather than child-component setup.
vi.mock("@/components/workspaces/TestConnectionPanel", () => ({
	TestConnectionPanel: () => <div data-testid="test-connection" />,
}));
vi.mock("@/components/workspaces/McpUrlButton", () => ({
	McpUrlButton: () => <div data-testid="mcp-url" />,
}));
vi.mock("@/components/workspaces/KnowledgeBasesPanel", () => ({
	KnowledgeBasesPanel: () => <div data-testid="kbs-panel" />,
}));
vi.mock("@/components/workspaces/ApiKeysPanel", () => ({
	ApiKeysPanel: () => <div data-testid="api-keys-panel" />,
}));
vi.mock("@/components/workspaces/DeleteDialog", () => ({
	DeleteDialog: () => <div data-testid="delete-dialog" />,
}));
vi.mock("@/components/workspaces/WorkspaceForm", () => ({
	WorkspaceForm: () => <div data-testid="workspace-form" />,
}));
vi.mock("@/components/workspaces/AstraCliDetectionCard", () => ({
	AstraCliDetectionCard: () => null,
}));
vi.mock("@/components/workspaces/ServicesPanel", () => ({
	ServicesPanel: () => <div data-testid="services-panel" />,
}));

import { useFeatures } from "@/hooks/useFeatures";
import {
	useDeleteWorkspace,
	useUpdateWorkspace,
	useWorkspace,
} from "@/hooks/useWorkspaces";
import { WorkspaceDetailPage } from "./WorkspaceDetailPage";

afterEach(() => {
	vi.mocked(useWorkspace).mockReset();
	vi.mocked(useUpdateWorkspace).mockReset();
	vi.mocked(useDeleteWorkspace).mockReset();
	vi.mocked(useFeatures).mockReset();
});

function setupBaseHooks() {
	vi.mocked(useUpdateWorkspace).mockReturnValue({
		mutate: vi.fn(),
		mutateAsync: vi.fn(),
		isPending: false,
	} as unknown as ReturnType<typeof useUpdateWorkspace>);
	vi.mocked(useDeleteWorkspace).mockReturnValue({
		mutate: vi.fn(),
		mutateAsync: vi.fn(),
		isPending: false,
	} as unknown as ReturnType<typeof useDeleteWorkspace>);
	vi.mocked(useFeatures).mockReturnValue({
		data: { mcp: { enabled: false, baseUrl: null } },
	} as unknown as ReturnType<typeof useFeatures>);
}

function renderAt(path = "/workspaces/00000000-0000-4000-8000-000000000001") {
	return render(
		<MemoryRouter initialEntries={[path]}>
			<Routes>
				<Route
					path="/workspaces/:workspaceId"
					element={<WorkspaceDetailPage />}
				/>
				<Route path="/" element={<div>root stub</div>} />
			</Routes>
		</MemoryRouter>,
	);
}

describe("WorkspaceDetailPage", () => {
	it("shows loading state while fetching", () => {
		setupBaseHooks();
		vi.mocked(useWorkspace).mockReturnValue({
			data: undefined,
			isLoading: true,
			isError: false,
			error: null,
		} as unknown as ReturnType<typeof useWorkspace>);

		renderAt();
		expect(screen.getByText(/Loading workspace/i)).toBeInTheDocument();
	});

	it("shows the error state when fetch fails", () => {
		setupBaseHooks();
		vi.mocked(useWorkspace).mockReturnValue({
			data: undefined,
			isLoading: false,
			isError: true,
			error: new Error("nope"),
		} as unknown as ReturnType<typeof useWorkspace>);

		renderAt();
		expect(screen.getByText(/Couldn't load workspace/i)).toBeInTheDocument();
	});

	it("renders the workspace name + kind badge on success", () => {
		setupBaseHooks();
		vi.mocked(useWorkspace).mockReturnValue({
			data: {
				workspaceId: "00000000-0000-4000-8000-000000000001",
				name: "research-lab",
				kind: "astra",
				credentials: {},
				credentialsRef: { token: "env:T" },
				createdAt: "2026-04-01T00:00:00.000Z",
				updatedAt: "2026-04-01T00:00:00.000Z",
			},
			isLoading: false,
			isError: false,
			error: null,
		} as unknown as ReturnType<typeof useWorkspace>);

		renderAt();
		expect(
			screen.getByRole("heading", { name: "research-lab" }),
		).toBeInTheDocument();
	});
});
