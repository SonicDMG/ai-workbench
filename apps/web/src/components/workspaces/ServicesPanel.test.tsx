import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
	ChunkingServiceRecord,
	EmbeddingServiceRecord,
	LlmServiceRecord,
	RerankingServiceRecord,
} from "@/lib/schemas";

type ListState<T> = {
	data: T[] | undefined;
	error: Error | null;
	isLoading: boolean;
	isError: boolean;
	refetch: () => void;
};

const embeddingState: ListState<EmbeddingServiceRecord> = {
	data: [],
	error: null,
	isLoading: false,
	isError: false,
	refetch: vi.fn(),
};
const chunkingState: ListState<ChunkingServiceRecord> = {
	data: [],
	error: null,
	isLoading: false,
	isError: false,
	refetch: vi.fn(),
};
const rerankingState: ListState<RerankingServiceRecord> = {
	data: [],
	error: null,
	isLoading: false,
	isError: false,
	refetch: vi.fn(),
};
const llmState: ListState<LlmServiceRecord> = {
	data: [],
	error: null,
	isLoading: false,
	isError: false,
	refetch: vi.fn(),
};

vi.mock("@/hooks/useServices", () => ({
	useEmbeddingServices: () => ({ ...embeddingState }),
	useChunkingServices: () => ({ ...chunkingState }),
	useRerankingServices: () => ({ ...rerankingState }),
	useCreateEmbeddingService: () => ({ mutateAsync: vi.fn(), isPending: false }),
	useCreateChunkingService: () => ({ mutateAsync: vi.fn(), isPending: false }),
	useCreateRerankingService: () => ({ mutateAsync: vi.fn(), isPending: false }),
	useUpdateEmbeddingService: () => ({ mutateAsync: vi.fn(), isPending: false }),
	useUpdateChunkingService: () => ({ mutateAsync: vi.fn(), isPending: false }),
	useUpdateRerankingService: () => ({ mutateAsync: vi.fn(), isPending: false }),
	useDeleteEmbeddingService: () => ({ mutateAsync: vi.fn(), isPending: false }),
	useDeleteChunkingService: () => ({ mutateAsync: vi.fn(), isPending: false }),
	useDeleteRerankingService: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

vi.mock("@/hooks/useConversations", () => ({
	useLlmServices: () => ({ ...llmState }),
	useCreateLlmService: () => ({ mutateAsync: vi.fn(), isPending: false }),
	useUpdateLlmService: () => ({ mutateAsync: vi.fn(), isPending: false }),
	useDeleteLlmService: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

vi.mock("sonner", () => ({
	toast: { success: vi.fn(), error: vi.fn() },
}));

import { ServicesPanel } from "./ServicesPanel";

function makeEmbedding(
	overrides: Partial<EmbeddingServiceRecord> = {},
): EmbeddingServiceRecord {
	return {
		workspaceId: "00000000-0000-4000-8000-000000000001",
		embeddingServiceId: "emb-1",
		name: "OpenAI default",
		description: null,
		status: "active",
		provider: "openai",
		modelName: "text-embedding-3-small",
		embeddingDimension: 1536,
		distanceMetric: "cosine",
		endpointBaseUrl: null,
		endpointPath: null,
		requestTimeoutMs: null,
		maxBatchSize: null,
		maxInputTokens: null,
		authType: "api_key",
		credentialRef: "env:OPENAI_API_KEY",
		supportedLanguages: [],
		supportedContent: [],
		createdAt: "2026-04-25T10:00:00.000Z",
		updatedAt: "2026-04-25T10:00:00.000Z",
		...overrides,
	};
}

function makeChunking(
	overrides: Partial<ChunkingServiceRecord> = {},
): ChunkingServiceRecord {
	return {
		workspaceId: "00000000-0000-4000-8000-000000000001",
		chunkingServiceId: "chunk-1",
		name: "Recursive default",
		description: null,
		status: "active",
		engine: "langchain_ts",
		engineVersion: null,
		strategy: "recursive",
		maxChunkSize: null,
		minChunkSize: null,
		chunkUnit: null,
		overlapSize: null,
		overlapUnit: null,
		preserveStructure: null,
		language: null,
		endpointBaseUrl: null,
		endpointPath: null,
		requestTimeoutMs: null,
		authType: "none",
		credentialRef: null,
		maxPayloadSizeKb: null,
		enableOcr: null,
		extractTables: null,
		extractFigures: null,
		readingOrder: null,
		createdAt: "2026-04-25T10:00:00.000Z",
		updatedAt: "2026-04-25T10:00:00.000Z",
		...overrides,
	};
}

function makeReranking(
	overrides: Partial<RerankingServiceRecord> = {},
): RerankingServiceRecord {
	return {
		workspaceId: "00000000-0000-4000-8000-000000000001",
		rerankingServiceId: "rer-1",
		name: "Cohere reranker",
		description: null,
		status: "active",
		provider: "cohere",
		engine: null,
		modelName: "rerank-english-v3.0",
		modelVersion: null,
		maxCandidates: null,
		scoringStrategy: null,
		scoreNormalized: null,
		returnScores: null,
		endpointBaseUrl: null,
		endpointPath: null,
		requestTimeoutMs: null,
		maxBatchSize: null,
		authType: "api_key",
		credentialRef: "env:COHERE_API_KEY",
		supportedLanguages: [],
		supportedContent: [],
		createdAt: "2026-04-25T10:00:00.000Z",
		updatedAt: "2026-04-25T10:00:00.000Z",
		...overrides,
	};
}

function makeLlm(overrides: Partial<LlmServiceRecord> = {}): LlmServiceRecord {
	return {
		workspaceId: "00000000-0000-4000-8000-000000000001",
		llmServiceId: "00000000-0000-4000-8000-000000000101",
		name: "Mistral chat",
		description: null,
		status: "active",
		provider: "huggingface",
		engine: null,
		modelName: "mistralai/Mistral-7B-Instruct-v0.3",
		modelVersion: null,
		contextWindowTokens: null,
		maxOutputTokens: 1024,
		temperatureMin: null,
		temperatureMax: null,
		supportsStreaming: null,
		supportsTools: null,
		endpointBaseUrl: null,
		endpointPath: null,
		requestTimeoutMs: null,
		maxBatchSize: null,
		authType: "api_key",
		credentialRef: "env:HUGGINGFACE_API_KEY",
		supportedLanguages: [],
		supportedContent: [],
		createdAt: "2026-04-25T10:00:00.000Z",
		updatedAt: "2026-04-25T10:00:00.000Z",
		...overrides,
	};
}

function resetState() {
	llmState.data = [];
	llmState.error = null;
	llmState.isLoading = false;
	llmState.isError = false;
	embeddingState.data = [];
	embeddingState.error = null;
	embeddingState.isLoading = false;
	embeddingState.isError = false;
	chunkingState.data = [];
	chunkingState.error = null;
	chunkingState.isLoading = false;
	chunkingState.isError = false;
	rerankingState.data = [];
	rerankingState.error = null;
	rerankingState.isLoading = false;
	rerankingState.isError = false;
}

beforeEach(resetState);

describe("ServicesPanel", () => {
	it("renders the service subpanel headers", () => {
		render(<ServicesPanel workspace="ws-1" />);
		expect(screen.getByTestId("settings-services-grid")).toHaveClass(
			"grid",
			"md:grid-cols-2",
		);
		expect(
			screen.getByRole("button", { name: /LLM services/ }),
		).toBeInTheDocument();
		expect(screen.getByText(/Embedding services/)).toBeInTheDocument();
		expect(screen.getByText(/Chunking services/)).toBeInTheDocument();
		expect(screen.getByText(/Reranking services/)).toBeInTheDocument();
	});

	it("shows the row count in each collapsed subpanel header", () => {
		llmState.data = [makeLlm({ name: "Mistral chat" })];
		embeddingState.data = [
			makeEmbedding({ name: "Embed-A" }),
			makeEmbedding({ embeddingServiceId: "emb-2", name: "Embed-B" }),
		];
		chunkingState.data = [makeChunking({ name: "Chunk-A" })];
		rerankingState.data = [];
		render(<ServicesPanel workspace="ws-1" />);
		expect(screen.getByText(/1 LLM service\b/)).toBeInTheDocument();
		expect(screen.getByText(/2 embedding services/)).toBeInTheDocument();
		expect(screen.getByText(/1 chunking service\b/)).toBeInTheDocument();
		expect(screen.getByText(/0 reranking services/)).toBeInTheDocument();
	});

	it("expands a subpanel and renders the underlying rows when its header is clicked", async () => {
		const user = userEvent.setup();
		embeddingState.data = [makeEmbedding({ name: "OpenAI default" })];
		render(<ServicesPanel workspace="ws-1" />);
		// Collapsed by default — row title hidden.
		expect(screen.queryByText("OpenAI default")).not.toBeInTheDocument();

		await user.click(
			screen.getByRole("button", { name: /Embedding services/ }),
		);
		expect(screen.getByText("OpenAI default")).toBeInTheDocument();
		// The row's subtitle shows the provider:model and dimension.
		expect(
			screen.getByText(/openai:text-embedding-3-small/),
		).toBeInTheDocument();
	});

	it("opens the embedding edit dialog from a service row", async () => {
		const user = userEvent.setup();
		embeddingState.data = [makeEmbedding({ name: "OpenAI default" })];
		render(<ServicesPanel workspace="ws-1" />);

		await user.click(
			screen.getByRole("button", { name: /Embedding services/ }),
		);
		await user.click(
			screen.getByRole("button", { name: /Edit OpenAI default/ }),
		);

		expect(screen.getByText(/Edit embedding service/)).toBeInTheDocument();
		expect(screen.getByDisplayValue("OpenAI default")).toBeInTheDocument();
	});

	it("shows the loading state inside an expanded subpanel while the list query is pending", async () => {
		const user = userEvent.setup();
		embeddingState.isLoading = true;
		embeddingState.data = undefined;
		render(<ServicesPanel workspace="ws-1" />);
		await user.click(
			screen.getByRole("button", { name: /Embedding services/ }),
		);
		expect(screen.getByText(/Loading embedding services/i)).toBeInTheDocument();
	});

	it("surfaces the error message and a retry affordance when a list query fails", async () => {
		const user = userEvent.setup();
		embeddingState.isError = true;
		embeddingState.error = new Error("boom: embedder list");
		embeddingState.data = undefined;
		render(<ServicesPanel workspace="ws-1" />);
		await user.click(
			screen.getByRole("button", { name: /Embedding services/ }),
		);
		expect(screen.getByText(/Couldn't load/)).toBeInTheDocument();
		expect(screen.getByText(/boom: embedder list/)).toBeInTheDocument();
		expect(screen.getByRole("button", { name: /Retry/ })).toBeInTheDocument();
	});

	it("opens the create dialog with the preset picker when 'New' is clicked", async () => {
		const user = userEvent.setup();
		render(<ServicesPanel workspace="ws-1" />);
		// Four "New" buttons — LLM, embedding, chunking, reranking.
		const newButtons = screen.getAllByRole("button", { name: /^New/ });
		expect(newButtons.length).toBe(4);
		await user.click(newButtons[1] as HTMLButtonElement);
		expect(screen.getByText(/New embedding service/)).toBeInTheDocument();
		expect(screen.getByText(/Pick a preset/)).toBeInTheDocument();
	});

	it("expands the chunking subpanel and renders its rows", async () => {
		const user = userEvent.setup();
		chunkingState.data = [makeChunking({ name: "Recursive default" })];
		render(<ServicesPanel workspace="ws-1" />);
		await user.click(screen.getByRole("button", { name: /Chunking services/ }));
		expect(screen.getByText("Recursive default")).toBeInTheDocument();
		expect(screen.getByText(/langchain_ts \/ recursive/)).toBeInTheDocument();
	});

	it("expands the reranking subpanel and renders its rows", async () => {
		const user = userEvent.setup();
		rerankingState.data = [makeReranking({ name: "Cohere reranker" })];
		render(<ServicesPanel workspace="ws-1" />);
		await user.click(
			screen.getByRole("button", { name: /Reranking services/ }),
		);
		expect(screen.getByText("Cohere reranker")).toBeInTheDocument();
		expect(screen.getByText(/cohere:rerank-english-v3.0/)).toBeInTheDocument();
	});

	it("opens the chunking create dialog with its engine and strategy fields", async () => {
		const user = userEvent.setup();
		render(<ServicesPanel workspace="ws-1" />);
		const newButtons = screen.getAllByRole("button", { name: /^New/ });
		// Order in the DOM: LLM (0), embedding (1), chunking (2), reranking (3).
		await user.click(newButtons[2] as HTMLButtonElement);
		expect(screen.getByText(/New chunking service/)).toBeInTheDocument();
		expect(screen.getByLabelText(/Engine/)).toBeInTheDocument();
		expect(screen.getByLabelText(/Strategy/)).toBeInTheDocument();
	});

	it("opens the reranking create dialog with its provider and model fields", async () => {
		const user = userEvent.setup();
		render(<ServicesPanel workspace="ws-1" />);
		const newButtons = screen.getAllByRole("button", { name: /^New/ });
		await user.click(newButtons[3] as HTMLButtonElement);
		expect(screen.getByText(/New reranking service/)).toBeInTheDocument();
		expect(screen.getByLabelText(/Provider/)).toBeInTheDocument();
		expect(screen.getByLabelText(/Model/)).toBeInTheDocument();
	});

	it("exposes the embedding dimension and credential ref fields in the create dialog", async () => {
		const user = userEvent.setup();
		render(<ServicesPanel workspace="ws-1" />);
		const newButtons = screen.getAllByRole("button", { name: /^New/ });
		await user.click(newButtons[1] as HTMLButtonElement);
		expect(screen.getByLabelText(/Dimension/)).toBeInTheDocument();
		// "Secret ref" is part of the help-tooltip wording too, so use a
		// stricter label match.
		expect(screen.getByLabelText("Secret ref")).toBeInTheDocument();
		// Typing into the Name field exercises the draft setter.
		await user.type(screen.getByLabelText("Name"), "my-embedder");
		expect(screen.getByDisplayValue("my-embedder")).toBeInTheDocument();
	});

	it("renders the description hint inside each create dialog", async () => {
		const user = userEvent.setup();
		render(<ServicesPanel workspace="ws-1" />);
		const newButtons = screen.getAllByRole("button", { name: /^New/ });
		await user.click(newButtons[2] as HTMLButtonElement);
		// Chunking dialog dialog hint about presets vs custom.
		expect(
			screen.getByText(
				/Pick a preset for one-click setup, or build a custom chunker/,
			),
		).toBeInTheDocument();
	});

	it("disables Create until required fields are filled in the embedding dialog", async () => {
		const user = userEvent.setup();
		render(<ServicesPanel workspace="ws-1" />);
		const newButtons = screen.getAllByRole("button", { name: /^New/ });
		await user.click(newButtons[1] as HTMLButtonElement);
		// On a blank form the Create button is disabled because name +
		// modelName + dimension are required.
		const createBtn = screen.getByRole("button", { name: /^Create$/ });
		expect(createBtn).toBeDisabled();
	});
});
