import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { KnowledgeBaseRecord } from "@/lib/schemas";

const listState = {
	data: [] as KnowledgeBaseRecord[] | undefined,
	error: null as Error | null,
	isLoading: false,
	isError: false,
	refetch: vi.fn(),
};
const deleteMutate = vi.fn();

vi.mock("@/hooks/useKnowledgeBases", () => ({
	useKnowledgeBases: () => ({
		data: listState.data,
		error: listState.error,
		isLoading: listState.isLoading,
		isError: listState.isError,
		refetch: listState.refetch,
	}),
	useDeleteKnowledgeBase: () => ({
		mutateAsync: deleteMutate,
		isPending: false,
	}),
}));

// Document fetch only fires when a row is expanded; in these tests
// we don't expand rows, so a stub is enough.
vi.mock("@/hooks/useDocuments", () => ({
	useDocuments: () => ({
		data: [],
		error: null,
		isLoading: false,
		isError: false,
	}),
}));

vi.mock("./CreateKnowledgeBaseDialog", () => ({
	CreateKnowledgeBaseDialog: ({ open }: { open: boolean }) =>
		open ? <div data-testid="create-kb-dialog" /> : null,
}));

vi.mock("./IngestQueueDialog", () => ({
	IngestQueueDialog: () => <div data-testid="ingest-dialog" />,
}));

vi.mock("sonner", () => ({
	toast: { success: vi.fn(), error: vi.fn() },
}));

import { MemoryRouter } from "react-router-dom";
import { KnowledgeBasesPanel } from "./KnowledgeBasesPanel";

function renderPanel() {
	return render(
		<MemoryRouter>
			<KnowledgeBasesPanel workspace="ws-1" />
		</MemoryRouter>,
	);
}

const KB_ALPHA: KnowledgeBaseRecord = {
	knowledgeBaseId: "kb-alpha",
	workspaceId: "ws-1",
	name: "alpha",
	description: "Internal docs",
	status: "active",
	collection: "wb_vectors_kb_alpha",
	chunkingServiceId: "chk-1",
	embeddingServiceId: "emb-1",
	rerankingServiceId: null,
	createdAt: "2026-04-01T00:00:00.000Z",
	updatedAt: "2026-04-01T00:00:00.000Z",
};

const KB_BETA: KnowledgeBaseRecord = {
	...KB_ALPHA,
	knowledgeBaseId: "kb-beta",
	name: "beta",
	description: null,
	status: "draft",
	rerankingServiceId: "rrk-1",
};

beforeEach(() => {
	listState.data = [];
	listState.error = null;
	listState.isLoading = false;
	listState.isError = false;
	listState.refetch.mockReset();
	deleteMutate.mockReset();
});

describe("KnowledgeBasesPanel", () => {
	it("renders the loading state while the list query is in flight", () => {
		listState.isLoading = true;
		renderPanel();
		expect(screen.getByText(/Loading knowledge bases/i)).toBeInTheDocument();
	});

	it("renders an error state with a Retry button when the list query fails", async () => {
		listState.isError = true;
		listState.error = new Error("upstream blew up");
		const user = userEvent.setup();
		renderPanel();

		expect(
			screen.getByText("Couldn't load knowledge bases"),
		).toBeInTheDocument();
		expect(screen.getByText("upstream blew up")).toBeInTheDocument();

		await user.click(screen.getByRole("button", { name: /Retry/ }));
		expect(listState.refetch).toHaveBeenCalledTimes(1);
	});

	it("renders the empty-state explainer when the workspace has no knowledge bases", () => {
		listState.data = [];
		renderPanel();
		expect(screen.getByText(/No knowledge bases yet/i)).toBeInTheDocument();
		expect(
			screen.getByText(/A knowledge base owns one Astra collection/i),
		).toBeInTheDocument();
	});

	it("singular vs plural copy reflects row count", () => {
		listState.data = [KB_ALPHA];
		const { rerender } = renderPanel();
		expect(
			screen.getByText("1 knowledge base in this workspace."),
		).toBeInTheDocument();

		listState.data = [KB_ALPHA, KB_BETA];
		rerender(
			<MemoryRouter>
				<KnowledgeBasesPanel workspace="ws-1" />
			</MemoryRouter>,
		);
		expect(
			screen.getByText("2 knowledge bases in this workspace."),
		).toBeInTheDocument();
	});

	it("opens the CreateKnowledgeBaseDialog when 'New knowledge base' is clicked", async () => {
		const user = userEvent.setup();
		renderPanel();
		expect(screen.queryByTestId("create-kb-dialog")).not.toBeInTheDocument();
		await user.click(
			screen.getByRole("button", { name: /New knowledge base/ }),
		);
		expect(screen.getByTestId("create-kb-dialog")).toBeInTheDocument();
	});

	it("renders rows with the KB name, status badge, and a 'reranker' chip when a reranker is bound", () => {
		listState.data = [KB_ALPHA, KB_BETA];
		renderPanel();
		expect(screen.getByText("alpha")).toBeInTheDocument();
		expect(screen.getByText("beta")).toBeInTheDocument();
		// KB_BETA has rerankingServiceId set; KB_ALPHA does not — exactly
		// one reranker chip should render.
		expect(screen.getAllByText("reranker")).toHaveLength(1);
		// Each row exposes a delete button labeled with the KB name so
		// destructive actions stay readable to AT users.
		expect(
			screen.getByRole("button", { name: "Delete alpha" }),
		).toBeInTheDocument();
		expect(
			screen.getByRole("button", { name: "Delete beta" }),
		).toBeInTheDocument();
	});
});
