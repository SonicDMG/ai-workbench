/**
 * PlaygroundPage smoke tests. The page is route-scoped to a single
 * KB. Three branches matter at the page level: missing route params
 * (redirect), loading, and KB-not-found error.
 */

import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/hooks/useWorkspaces", () => ({
	useWorkspace: vi.fn(),
}));
vi.mock("@/hooks/useKnowledgeBases", () => ({
	useKnowledgeBase: vi.fn(),
}));
vi.mock("@/hooks/useServices", () => ({
	useEmbeddingServices: vi.fn(),
}));
vi.mock("@/hooks/usePlaygroundSearch", () => ({
	usePlaygroundSearch: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

import { useKnowledgeBase } from "@/hooks/useKnowledgeBases";
import { useEmbeddingServices } from "@/hooks/useServices";
import { useWorkspace } from "@/hooks/useWorkspaces";
import { PlaygroundPage } from "./PlaygroundPage";

afterEach(() => {
	vi.mocked(useWorkspace).mockReset();
	vi.mocked(useKnowledgeBase).mockReset();
	vi.mocked(useEmbeddingServices).mockReset();
});

function renderAt(path: string) {
	return render(
		<MemoryRouter initialEntries={[path]}>
			<Routes>
				<Route
					path="/workspaces/:workspaceId/knowledge-bases/:knowledgeBaseId/playground"
					element={<PlaygroundPage />}
				/>
				<Route path="/" element={<div>root stub</div>} />
			</Routes>
		</MemoryRouter>,
	);
}

describe("PlaygroundPage", () => {
	it("shows the loading state while workspace + KB queries resolve", () => {
		vi.mocked(useWorkspace).mockReturnValue({
			isLoading: true,
		} as unknown as ReturnType<typeof useWorkspace>);
		vi.mocked(useKnowledgeBase).mockReturnValue({
			isLoading: true,
		} as unknown as ReturnType<typeof useKnowledgeBase>);
		vi.mocked(useEmbeddingServices).mockReturnValue({
			data: [],
		} as unknown as ReturnType<typeof useEmbeddingServices>);

		renderAt("/workspaces/ws-1/knowledge-bases/kb-1/playground");
		expect(screen.getByText(/Loading playground/i)).toBeInTheDocument();
	});

	it("shows an error state when the KB query fails", () => {
		vi.mocked(useWorkspace).mockReturnValue({
			isLoading: false,
			isError: false,
			data: { workspaceId: "ws-1", name: "w", kind: "astra" },
		} as unknown as ReturnType<typeof useWorkspace>);
		vi.mocked(useKnowledgeBase).mockReturnValue({
			isLoading: false,
			isError: true,
			error: new Error("nope"),
			data: undefined,
		} as unknown as ReturnType<typeof useKnowledgeBase>);
		vi.mocked(useEmbeddingServices).mockReturnValue({
			data: [],
		} as unknown as ReturnType<typeof useEmbeddingServices>);

		renderAt("/workspaces/ws-1/knowledge-bases/kb-1/playground");
		expect(
			screen.getByText(/Couldn't load knowledge base/i),
		).toBeInTheDocument();
		expect(screen.getByText(/nope/)).toBeInTheDocument();
	});
});
