/**
 * ChatPage smoke tests. Verify the three top-level branches: workspace
 * loading, workspace error, and the populated heading. Per-conversation
 * streaming + message-list behavior is covered separately by the
 * components those areas use.
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
	useConversations: vi.fn(),
	useCreateConversation: vi.fn(),
	useConversation: vi.fn(),
	useConversationMessages: vi.fn(),
	useDeleteConversation: vi.fn(),
	useSendConversationStream: vi.fn(),
}));

import { useAgents, useCreateAgent } from "@/hooks/useConversations";
import { useWorkspace } from "@/hooks/useWorkspaces";
import { ChatPage } from "./ChatPage";

afterEach(() => {
	vi.mocked(useWorkspace).mockReset();
	vi.mocked(useAgents).mockReset();
	vi.mocked(useCreateAgent).mockReset();
});

function setupAgents() {
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
}

function renderAt(path = "/workspaces/ws-1/chat") {
	return render(
		<MemoryRouter initialEntries={[path]}>
			<Routes>
				<Route path="/workspaces/:workspaceId/chat" element={<ChatPage />} />
				<Route path="/" element={<div>root stub</div>} />
			</Routes>
		</MemoryRouter>,
	);
}

describe("ChatPage", () => {
	it("shows loading state while workspace resolves", () => {
		setupAgents();
		vi.mocked(useWorkspace).mockReturnValue({
			isLoading: true,
		} as unknown as ReturnType<typeof useWorkspace>);

		renderAt();
		expect(screen.getByText(/Loading workspace/i)).toBeInTheDocument();
	});

	it("shows the error state when workspace fetch fails", () => {
		setupAgents();
		vi.mocked(useWorkspace).mockReturnValue({
			isLoading: false,
			isError: true,
			error: new Error("boom"),
			data: undefined,
		} as unknown as ReturnType<typeof useWorkspace>);

		renderAt();
		expect(screen.getByText(/Couldn't load workspace/i)).toBeInTheDocument();
	});

	it("renders the Chat heading with the workspace name on success", () => {
		setupAgents();
		vi.mocked(useWorkspace).mockReturnValue({
			isLoading: false,
			isError: false,
			error: null,
			data: { workspaceId: "ws-1", name: "research-lab", kind: "astra" },
		} as unknown as ReturnType<typeof useWorkspace>);

		renderAt();
		expect(screen.getByRole("heading", { name: /^Chat$/ })).toBeInTheDocument();
		expect(screen.getAllByText(/research-lab/).length).toBeGreaterThan(0);
	});
});
