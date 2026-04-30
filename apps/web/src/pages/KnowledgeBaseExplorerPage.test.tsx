/**
 * KnowledgeBaseExplorerPage smoke tests. The page is route-scoped to
 * a single KB. Three branches matter at the page level: loading,
 * KB-not-found, and the populated header.
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
vi.mock("@/hooks/useDocuments", () => ({
	useDocuments: vi.fn(),
	useDeleteDocument: vi.fn(),
}));
vi.mock("@/components/workspaces/DocumentTable", () => ({
	DocumentTable: () => <div data-testid="document-table" />,
}));
vi.mock("@/components/workspaces/IngestQueueDialog", () => ({
	IngestQueueDialog: () => <div data-testid="ingest-dialog" />,
}));
vi.mock("@/components/workspaces/DocumentViewerDialog", () => ({
	DocumentViewerDialog: () => null,
}));

import { useDeleteDocument, useDocuments } from "@/hooks/useDocuments";
import { useKnowledgeBase } from "@/hooks/useKnowledgeBases";
import { useWorkspace } from "@/hooks/useWorkspaces";
import { KnowledgeBaseExplorerPage } from "./KnowledgeBaseExplorerPage";

afterEach(() => {
	vi.mocked(useWorkspace).mockReset();
	vi.mocked(useKnowledgeBase).mockReset();
	vi.mocked(useDocuments).mockReset();
	vi.mocked(useDeleteDocument).mockReset();
});

function renderAt(path = "/workspaces/ws-1/knowledge-bases/kb-1") {
	vi.mocked(useDeleteDocument).mockReturnValue({
		mutate: vi.fn(),
		mutateAsync: vi.fn(),
		isPending: false,
	} as unknown as ReturnType<typeof useDeleteDocument>);
	return render(
		<MemoryRouter initialEntries={[path]}>
			<Routes>
				<Route
					path="/workspaces/:workspaceId/knowledge-bases/:knowledgeBaseId"
					element={<KnowledgeBaseExplorerPage />}
				/>
				<Route path="/" element={<div>root stub</div>} />
			</Routes>
		</MemoryRouter>,
	);
}

describe("KnowledgeBaseExplorerPage", () => {
	it("shows loading state while workspace + kb resolve", () => {
		vi.mocked(useWorkspace).mockReturnValue({
			isLoading: true,
		} as unknown as ReturnType<typeof useWorkspace>);
		vi.mocked(useKnowledgeBase).mockReturnValue({
			isLoading: true,
		} as unknown as ReturnType<typeof useKnowledgeBase>);
		vi.mocked(useDocuments).mockReturnValue({
			data: [],
			isLoading: false,
		} as unknown as ReturnType<typeof useDocuments>);

		renderAt();
		expect(screen.getByText(/Loading knowledge base/i)).toBeInTheDocument();
	});

	it("shows the not-found state when KB query fails", () => {
		vi.mocked(useWorkspace).mockReturnValue({
			isLoading: false,
			isError: false,
			data: { workspaceId: "ws-1", name: "w", kind: "astra" },
		} as unknown as ReturnType<typeof useWorkspace>);
		vi.mocked(useKnowledgeBase).mockReturnValue({
			isLoading: false,
			isError: true,
			error: new Error("404"),
			data: undefined,
		} as unknown as ReturnType<typeof useKnowledgeBase>);
		vi.mocked(useDocuments).mockReturnValue({
			data: [],
		} as unknown as ReturnType<typeof useDocuments>);

		renderAt();
		expect(screen.getByText(/Knowledge base not found/i)).toBeInTheDocument();
	});
});
