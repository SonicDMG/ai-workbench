/**
 * PlaygroundPage smoke tests. The page is workspace-scoped and has
 * three important branches: loading, unsupported workspace kind, and
 * the populated Astra command surface.
 */

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/hooks/useWorkspaces", () => ({
	useWorkspace: vi.fn(),
}));
vi.mock("@/hooks/useKnowledgeBases", () => ({
	useKnowledgeBases: vi.fn(),
}));
vi.mock("@/hooks/usePlayground", () => ({
	usePlaygroundCommand: vi.fn(),
}));

import { useKnowledgeBases } from "@/hooks/useKnowledgeBases";
import { usePlaygroundCommand } from "@/hooks/usePlayground";
import { useWorkspace } from "@/hooks/useWorkspaces";
import { PlaygroundPage } from "./PlaygroundPage";

afterEach(() => {
	vi.mocked(useWorkspace).mockReset();
	vi.mocked(useKnowledgeBases).mockReset();
	vi.mocked(usePlaygroundCommand).mockReset();
});

function setupPlaygroundMutation() {
	vi.mocked(usePlaygroundCommand).mockReturnValue({
		mutateAsync: vi.fn(),
		isPending: false,
	} as unknown as ReturnType<typeof usePlaygroundCommand>);
}

function renderAt(path = "/workspaces/ws-1/playground") {
	return render(
		<MemoryRouter initialEntries={[path]}>
			<Routes>
				<Route
					path="/workspaces/:workspaceId/playground"
					element={<PlaygroundPage />}
				/>
				<Route path="/" element={<div>root stub</div>} />
			</Routes>
		</MemoryRouter>,
	);
}

describe("PlaygroundPage", () => {
	it("shows the loading state while the workspace query resolves", () => {
		setupPlaygroundMutation();
		vi.mocked(useWorkspace).mockReturnValue({
			isLoading: true,
		} as unknown as ReturnType<typeof useWorkspace>);
		vi.mocked(useKnowledgeBases).mockReturnValue({
			data: [],
			isLoading: false,
		} as unknown as ReturnType<typeof useKnowledgeBases>);

		renderAt();
		expect(screen.getByText(/Loading playground/i)).toBeInTheDocument();
	});

	it("disables execution for non-Astra workspaces", () => {
		setupPlaygroundMutation();
		vi.mocked(useWorkspace).mockReturnValue({
			isLoading: false,
			isError: false,
			data: {
				workspaceId: "00000000-0000-4000-8000-000000000001",
				name: "mock-space",
				kind: "mock",
				url: null,
				keyspace: null,
				credentials: {},
				createdAt: "2026-04-01T00:00:00.000Z",
				updatedAt: "2026-04-01T00:00:00.000Z",
			},
		} as unknown as ReturnType<typeof useWorkspace>);
		vi.mocked(useKnowledgeBases).mockReturnValue({
			data: [],
			isLoading: false,
		} as unknown as ReturnType<typeof useKnowledgeBases>);

		renderAt();
		expect(
			screen.getByText(/Playground is available for Astra workspaces/i),
		).toBeInTheDocument();
	});

	it("renders the Astra command workbench", async () => {
		const user = userEvent.setup();
		setupPlaygroundMutation();
		vi.mocked(useWorkspace).mockReturnValue({
			isLoading: false,
			isError: false,
			data: {
				workspaceId: "00000000-0000-4000-8000-000000000001",
				name: "research-lab",
				kind: "astra",
				url: "https://db.apps.astra.datastax.com",
				keyspace: "default_keyspace",
				credentials: {},
				createdAt: "2026-04-01T00:00:00.000Z",
				updatedAt: "2026-04-01T00:00:00.000Z",
			},
		} as unknown as ReturnType<typeof useWorkspace>);
		vi.mocked(useKnowledgeBases).mockReturnValue({
			data: [
				{
					workspaceId: "00000000-0000-4000-8000-000000000001",
					knowledgeBaseId: "00000000-0000-4000-8000-000000000002",
					name: "kb_one",
					description: null,
					status: "active",
					embeddingServiceId: "00000000-0000-4000-8000-000000000003",
					chunkingServiceId: "00000000-0000-4000-8000-000000000004",
					rerankingServiceId: null,
					language: null,
					vectorCollection: "kb_one_vectors",
					owned: true,
					lexical: { enabled: false, analyzer: null, options: {} },
					createdAt: "2026-04-01T00:00:00.000Z",
					updatedAt: "2026-04-01T00:00:00.000Z",
				},
			],
			isLoading: false,
		} as unknown as ReturnType<typeof useKnowledgeBases>);

		renderAt();
		expect(
			screen.getByRole("heading", { name: /Data API Playground/i }),
		).toBeInTheDocument();
		expect(screen.getAllByText("List collection names").length).toBeGreaterThan(
			0,
		);
		expect(screen.queryByText("List table names")).not.toBeInTheDocument();
		await user.click(screen.getByRole("button", { name: "Table" }));
		expect(screen.getAllByText("List table names").length).toBeGreaterThan(0);
		expect(screen.queryByText("List collection names")).not.toBeInTheDocument();
		expect(
			screen.getByRole("heading", { name: /Client code/i }),
		).toBeInTheDocument();
	});
});
