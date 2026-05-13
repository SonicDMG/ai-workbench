/**
 * WorkspaceDetailPage smoke tests. Page renders four major branches:
 * loading, not-found error, generic error, and the populated view.
 */

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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
vi.mock("@/hooks/useConversations", () => ({
	useAgents: vi.fn(),
	useCreateAgent: vi.fn(),
	useDeleteAgent: vi.fn(),
	useLlmServices: vi.fn(),
	useUpdateAgent: vi.fn(),
}));
vi.mock("@/hooks/useKnowledgeBases", () => ({
	useKnowledgeBases: vi.fn(),
}));
vi.mock("@/hooks/useServices", () => ({
	useRerankingServices: vi.fn(),
}));
vi.mock("sonner", () => ({
	toast: { success: vi.fn(), error: vi.fn() },
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
vi.mock("@/components/workspaces/CreateKnowledgeBaseDialog", () => ({
	CreateKnowledgeBaseDialog: ({ open }: { open: boolean }) =>
		open ? <div data-testid="create-kb-dialog" /> : null,
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
vi.mock("@/components/workspaces/SeededDefaultsCallout", () => ({
	// The callout's own test file covers its conditional logic; here we
	// just stub it out so WorkspaceDetailPage tests don't have to wire
	// the chunking / embedding / agent list mocks.
	SeededDefaultsCallout: () => null,
}));

import {
	useAgents,
	useCreateAgent,
	useDeleteAgent,
	useLlmServices,
	useUpdateAgent,
} from "@/hooks/useConversations";
import { useFeatures } from "@/hooks/useFeatures";
import { useKnowledgeBases } from "@/hooks/useKnowledgeBases";
import { useRerankingServices } from "@/hooks/useServices";
import {
	useDeleteWorkspace,
	useUpdateWorkspace,
	useWorkspace,
} from "@/hooks/useWorkspaces";
import type { AgentRecord } from "@/lib/schemas";
import { WorkspaceDetailPage } from "./WorkspaceDetailPage";

afterEach(() => {
	vi.mocked(useWorkspace).mockReset();
	vi.mocked(useUpdateWorkspace).mockReset();
	vi.mocked(useDeleteWorkspace).mockReset();
	vi.mocked(useFeatures).mockReset();
	vi.mocked(useAgents).mockReset();
	vi.mocked(useCreateAgent).mockReset();
	vi.mocked(useUpdateAgent).mockReset();
	vi.mocked(useDeleteAgent).mockReset();
	vi.mocked(useLlmServices).mockReset();
	vi.mocked(useKnowledgeBases).mockReset();
	vi.mocked(useRerankingServices).mockReset();
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
	vi.mocked(useAgents).mockReturnValue({
		data: [],
		isLoading: false,
		isError: false,
		error: null,
	} as unknown as ReturnType<typeof useAgents>);
	vi.mocked(useCreateAgent).mockReturnValue({
		mutateAsync: vi.fn(),
		isPending: false,
	} as unknown as ReturnType<typeof useCreateAgent>);
	vi.mocked(useUpdateAgent).mockReturnValue({
		mutateAsync: vi.fn(),
		isPending: false,
	} as unknown as ReturnType<typeof useUpdateAgent>);
	vi.mocked(useDeleteAgent).mockReturnValue({
		mutateAsync: vi.fn(),
		isPending: false,
	} as unknown as ReturnType<typeof useDeleteAgent>);
	vi.mocked(useLlmServices).mockReturnValue({
		data: [],
		isLoading: false,
		isError: false,
		error: null,
	} as unknown as ReturnType<typeof useLlmServices>);
	vi.mocked(useKnowledgeBases).mockReturnValue({
		data: [],
		isLoading: false,
		isError: false,
		error: null,
	} as unknown as ReturnType<typeof useKnowledgeBases>);
	vi.mocked(useRerankingServices).mockReturnValue({
		data: [],
		isLoading: false,
		isError: false,
		error: null,
	} as unknown as ReturnType<typeof useRerankingServices>);
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

function agentFixture(overrides: Partial<AgentRecord> = {}): AgentRecord {
	return {
		workspaceId: "00000000-0000-4000-8000-000000000001",
		agentId: "00000000-0000-4000-8000-00000000b0bb",
		name: "Bobby",
		description: "Direct and grounded.",
		systemPrompt: null,
		userPrompt: null,
		llmServiceId: null,
		knowledgeBaseIds: [],
		rerankEnabled: false,
		rerankingServiceId: null,
		rerankMaxResults: null,
		createdAt: "2026-04-01T00:00:00.000Z",
		updatedAt: "2026-04-01T00:00:00.000Z",
		...overrides,
	};
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
		expect(screen.getByRole("link", { name: /Connect/i })).toHaveAttribute(
			"href",
			"/workspaces/00000000-0000-4000-8000-000000000001/connect",
		);
		expect(screen.getByRole("link", { name: "Playground" })).toHaveAttribute(
			"href",
			"/workspaces/00000000-0000-4000-8000-000000000001/playground",
		);
		expect(screen.queryByText("Data API Playground")).not.toBeInTheDocument();
	});

	it("renders agent cards as direct links to agent chat", () => {
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
		vi.mocked(useAgents).mockReturnValue({
			data: [agentFixture()],
			isLoading: false,
			isError: false,
			error: null,
		} as unknown as ReturnType<typeof useAgents>);

		renderAt();

		expect(
			screen.getByRole("link", { name: /Chat with Bobby/i }),
		).toHaveAttribute(
			"href",
			"/workspaces/00000000-0000-4000-8000-000000000001/chat?agent=00000000-0000-4000-8000-00000000b0bb",
		);
		expect(
			screen.queryByRole("link", { name: /^Chat$/i }),
		).not.toBeInTheDocument();
		expect(screen.queryByText("Manage agents")).not.toBeInTheDocument();
		expect(
			screen.getByRole("button", { name: /New agent/i }),
		).toBeInTheDocument();
		expect(
			screen.getByRole("button", { name: /Edit Bobby/i }),
		).toBeInTheDocument();
		expect(
			screen.getByRole("button", { name: /Delete Bobby/i }),
		).toBeInTheDocument();
	});

	it("opens the create-KB dialog from the knowledge-bases card header", async () => {
		setupBaseHooks();
		const user = userEvent.setup();
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
		expect(screen.queryByTestId("create-kb-dialog")).not.toBeInTheDocument();
		await user.click(
			screen.getByRole("button", { name: /New knowledge base/i }),
		);
		expect(screen.getByTestId("create-kb-dialog")).toBeInTheDocument();
	});
});
