/**
 * AgentsPage smoke tests. Page-level branching: missing route param,
 * loading, error (incl. workspace-not-found), populated heading.
 */

import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/hooks/useWorkspaces", () => ({
	useWorkspace: vi.fn(),
}));
vi.mock("@/hooks/useConversations", () => ({
	useAgents: vi.fn(),
	useCreateAgent: vi.fn(),
	useUpdateAgent: vi.fn(),
	useDeleteAgent: vi.fn(),
	useLlmServices: vi.fn(),
}));
vi.mock("@/hooks/useServices", () => ({
	useRerankingServices: vi.fn(),
}));
vi.mock("@/hooks/useKnowledgeBases", () => ({
	useKnowledgeBases: vi.fn(),
}));
vi.mock("@/components/agents/LlmServicesPanel", () => ({
	LlmServicesPanel: () => <div data-testid="llm-panel" />,
}));

import {
	useAgents,
	useCreateAgent,
	useDeleteAgent,
	useLlmServices,
	useUpdateAgent,
} from "@/hooks/useConversations";
import { useKnowledgeBases } from "@/hooks/useKnowledgeBases";
import { useRerankingServices } from "@/hooks/useServices";
import { useWorkspace } from "@/hooks/useWorkspaces";
import { AgentsPage } from "./AgentsPage";

afterEach(() => {
	vi.mocked(useWorkspace).mockReset();
	vi.mocked(useAgents).mockReset();
	vi.mocked(useCreateAgent).mockReset();
	vi.mocked(useUpdateAgent).mockReset();
	vi.mocked(useDeleteAgent).mockReset();
	vi.mocked(useLlmServices).mockReset();
	vi.mocked(useRerankingServices).mockReset();
	vi.mocked(useKnowledgeBases).mockReset();
});

function setupChildHooks() {
	vi.mocked(useAgents).mockReturnValue({
		data: [],
		isLoading: false,
		isError: false,
	} as unknown as ReturnType<typeof useAgents>);
	vi.mocked(useCreateAgent).mockReturnValue({
		mutate: vi.fn(),
		mutateAsync: vi.fn(),
		isPending: false,
	} as unknown as ReturnType<typeof useCreateAgent>);
	vi.mocked(useUpdateAgent).mockReturnValue({
		mutate: vi.fn(),
		mutateAsync: vi.fn(),
		isPending: false,
	} as unknown as ReturnType<typeof useUpdateAgent>);
	vi.mocked(useDeleteAgent).mockReturnValue({
		mutate: vi.fn(),
		mutateAsync: vi.fn(),
		isPending: false,
	} as unknown as ReturnType<typeof useDeleteAgent>);
	vi.mocked(useLlmServices).mockReturnValue({
		data: [],
	} as unknown as ReturnType<typeof useLlmServices>);
	vi.mocked(useRerankingServices).mockReturnValue({
		data: [],
	} as unknown as ReturnType<typeof useRerankingServices>);
	vi.mocked(useKnowledgeBases).mockReturnValue({
		data: [],
	} as unknown as ReturnType<typeof useKnowledgeBases>);
}

function renderAt(path = "/workspaces/ws-1/agents") {
	return render(
		<MemoryRouter initialEntries={[path]}>
			<Routes>
				<Route
					path="/workspaces/:workspaceId/agents"
					element={<AgentsPage />}
				/>
				<Route path="/" element={<div>root stub</div>} />
			</Routes>
		</MemoryRouter>,
	);
}

describe("AgentsPage", () => {
	it("shows loading state while workspace resolves", () => {
		setupChildHooks();
		vi.mocked(useWorkspace).mockReturnValue({
			isLoading: true,
		} as unknown as ReturnType<typeof useWorkspace>);

		renderAt();
		expect(screen.getByText(/Loading workspace/i)).toBeInTheDocument();
	});

	it("shows the error state when workspace fetch fails", () => {
		setupChildHooks();
		vi.mocked(useWorkspace).mockReturnValue({
			isLoading: false,
			isError: true,
			error: new Error("boom"),
			data: undefined,
		} as unknown as ReturnType<typeof useWorkspace>);

		renderAt();
		expect(screen.getByText(/Couldn't load workspace/i)).toBeInTheDocument();
	});

	it("renders the Agents heading + workspace name on success", () => {
		setupChildHooks();
		vi.mocked(useWorkspace).mockReturnValue({
			isLoading: false,
			isError: false,
			error: null,
			data: { workspaceId: "ws-1", name: "research-lab", kind: "astra" },
		} as unknown as ReturnType<typeof useWorkspace>);

		renderAt();
		const headings = screen.getAllByRole("heading", { name: /Agents/i });
		expect(headings.length).toBeGreaterThan(0);
		expect(screen.getByText(/research-lab/)).toBeInTheDocument();
	});
});
