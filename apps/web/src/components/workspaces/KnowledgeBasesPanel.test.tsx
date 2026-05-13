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

vi.mock("@/hooks/useServices", () => ({
	useChunkingServices: () => ({
		data: [
			{ chunkingServiceId: "chk-1", name: "default-chunker" },
			{ chunkingServiceId: "chk-2", name: "csv-line" },
		],
		isLoading: false,
	}),
	useEmbeddingServices: () => ({
		data: [{ embeddingServiceId: "emb-1", name: "openai-3-small" }],
		isLoading: false,
	}),
	useRerankingServices: () => ({
		data: [{ rerankingServiceId: "rrk-1", name: "cohere-rerank" }],
		isLoading: false,
	}),
}));

vi.mock("./EditKnowledgeBaseDialog", () => ({
	EditKnowledgeBaseDialog: ({
		kb,
	}: {
		kb: { knowledgeBaseId: string } | null;
	}) =>
		kb ? (
			<div data-testid="edit-kb-dialog" data-kb-id={kb.knowledgeBaseId} />
		) : null,
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
	vectorCollection: "wb_vectors_kb_alpha",
	owned: true,
	chunkingServiceId: "chk-1",
	embeddingServiceId: "emb-1",
	rerankingServiceId: null,
	language: null,
	lexical: { enabled: false, analyzer: null, options: {} },
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

	it("does not render a separate row-count summary when cards are present", () => {
		listState.data = [KB_ALPHA];
		renderPanel();

		expect(
			screen.queryByText(/knowledge bases? in this workspace/i),
		).not.toBeInTheDocument();
	});

	it("renders rows with the KB name, status badge, and a 'reranker' chip when a reranker is bound", () => {
		listState.data = [KB_ALPHA, KB_BETA];
		renderPanel();
		expect(screen.getByText("alpha")).toBeInTheDocument();
		expect(screen.getByText("beta")).toBeInTheDocument();
		expect(screen.getByRole("link", { name: "Open alpha" })).toHaveAttribute(
			"href",
			"/workspaces/ws-1/knowledge-bases/kb-alpha",
		);
		// KB_BETA has rerankingServiceId set; KB_ALPHA does not — exactly
		// one reranker chip should render.
		expect(screen.getAllByText("reranker")).toHaveLength(1);
		// Each row exposes edit and delete buttons labeled with the KB
		// name so destructive and mutating actions stay readable to AT
		// users.
		expect(
			screen.getByRole("button", { name: "Edit alpha" }),
		).toBeInTheDocument();
		expect(
			screen.getByRole("button", { name: "Edit beta" }),
		).toBeInTheDocument();
		expect(
			screen.getByRole("button", { name: "Delete alpha" }),
		).toBeInTheDocument();
		expect(
			screen.getByRole("button", { name: "Delete beta" }),
		).toBeInTheDocument();
	});

	it("keeps ingest and document-list actions on the KB page", () => {
		listState.data = [KB_ALPHA];
		renderPanel();

		expect(
			screen.queryByRole("button", { name: /Ingest/i }),
		).not.toBeInTheDocument();
		expect(
			screen.queryByRole("button", { name: /documents for alpha/i }),
		).not.toBeInTheDocument();
	});

	it("renders chunking and embedding service chips with the resolved service names", () => {
		listState.data = [KB_ALPHA];
		renderPanel();
		// KB_ALPHA binds chk-1 (default-chunker) and emb-1
		// (openai-3-small); both names should be visible on the row.
		expect(screen.getByText("default-chunker")).toBeInTheDocument();
		expect(screen.getByText("openai-3-small")).toBeInTheDocument();
		// Chip labels render alongside each service name.
		expect(screen.getByText("chunking")).toBeInTheDocument();
		expect(screen.getByText("embedding")).toBeInTheDocument();
	});

	it("opens the EditKnowledgeBaseDialog when the edit icon for a row is clicked", async () => {
		listState.data = [KB_ALPHA, KB_BETA];
		const user = userEvent.setup();
		renderPanel();
		expect(screen.queryByTestId("edit-kb-dialog")).not.toBeInTheDocument();
		await user.click(screen.getByRole("button", { name: "Edit beta" }));
		const dialog = screen.getByTestId("edit-kb-dialog");
		expect(dialog).toBeInTheDocument();
		expect(dialog).toHaveAttribute("data-kb-id", "kb-beta");
	});
});
