import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
	AdoptableCollection,
	ChunkingServiceRecord,
	EmbeddingServiceRecord,
	RerankingServiceRecord,
} from "@/lib/schemas";
import {
	CreateKnowledgeBaseDialog,
	isCompatible,
} from "./CreateKnowledgeBaseDialog";

const createMutate = vi.fn();
const adoptableState: { data: AdoptableCollection[]; isLoading: boolean } = {
	data: [],
	isLoading: false,
};
const embeddingState: { data: EmbeddingServiceRecord[] } = { data: [] };
const chunkingState: { data: ChunkingServiceRecord[] } = { data: [] };
const rerankingState: { data: RerankingServiceRecord[] } = { data: [] };

vi.mock("@/hooks/useKnowledgeBases", () => ({
	useCreateKnowledgeBase: () => ({
		mutateAsync: createMutate,
		reset: vi.fn(),
		isPending: false,
	}),
	useAdoptableCollections: () => ({
		data: adoptableState.data,
		isLoading: adoptableState.isLoading,
	}),
}));

vi.mock("@/hooks/useServices", () => ({
	useEmbeddingServices: () => ({
		data: embeddingState.data,
		isLoading: false,
	}),
	useChunkingServices: () => ({
		data: chunkingState.data,
		isLoading: false,
	}),
	useRerankingServices: () => ({
		data: rerankingState.data,
		isLoading: false,
	}),
}));

vi.mock("sonner", () => ({
	toast: { success: vi.fn(), error: vi.fn() },
}));

const EMB_SMALL: EmbeddingServiceRecord = {
	workspaceId: "ws",
	embeddingServiceId: "00000000-0000-4000-8000-000000000010",
	name: "openai-3-small",
	description: null,
	status: "active",
	provider: "openai",
	modelName: "text-embedding-3-small",
	embeddingDimension: 1536,
	distanceMetric: "cosine",
	maxBatchSize: null,
	maxInputTokens: null,
	supportedLanguages: [],
	supportedContent: [],
	endpointBaseUrl: null,
	endpointPath: null,
	requestTimeoutMs: null,
	authType: "none",
	credentialRef: null,
	createdAt: "2026-04-01T00:00:00Z",
	updatedAt: "2026-04-01T00:00:00Z",
};
const EMB_LARGE: EmbeddingServiceRecord = {
	...EMB_SMALL,
	embeddingServiceId: "00000000-0000-4000-8000-000000000011",
	name: "openai-3-large",
	modelName: "text-embedding-3-large",
	embeddingDimension: 3072,
};

const COL_SMALL: AdoptableCollection = {
	name: "products",
	vectorDimension: 1536,
	vectorSimilarity: "cosine",
	vectorService: null,
	lexicalEnabled: false,
	rerankEnabled: false,
	attached: false,
};
const COL_VECTORIZE: AdoptableCollection = {
	name: "products_vectorize",
	vectorDimension: 1536,
	vectorSimilarity: "cosine",
	vectorService: { provider: "openai", modelName: "text-embedding-3-small" },
	lexicalEnabled: false,
	rerankEnabled: false,
	attached: false,
};

beforeEach(() => {
	createMutate.mockReset();
	adoptableState.data = [];
	adoptableState.isLoading = false;
	embeddingState.data = [];
	chunkingState.data = [];
	rerankingState.data = [];
});

describe("isCompatible", () => {
	it("matches dimension only when no vectorize service is set on the collection", () => {
		expect(isCompatible(COL_SMALL, EMB_SMALL)).toBe(true);
		expect(isCompatible(COL_SMALL, EMB_LARGE)).toBe(false);
	});

	it("requires provider+model match when the collection has a vectorize service", () => {
		expect(isCompatible(COL_VECTORIZE, EMB_SMALL)).toBe(true);
		const wrongModel: EmbeddingServiceRecord = {
			...EMB_SMALL,
			modelName: "text-embedding-ada-002",
		};
		expect(isCompatible(COL_VECTORIZE, wrongModel)).toBe(false);
		const wrongProvider: EmbeddingServiceRecord = {
			...EMB_SMALL,
			provider: "cohere",
		};
		expect(isCompatible(COL_VECTORIZE, wrongProvider)).toBe(false);
	});

	it("rejects when dimension differs even if vectorize matches", () => {
		const sameVectorize: AdoptableCollection = {
			...COL_VECTORIZE,
			vectorDimension: 3072,
		};
		expect(isCompatible(sameVectorize, EMB_SMALL)).toBe(false);
	});
});

describe("CreateKnowledgeBaseDialog", () => {
	it("starts in 'create' mode and hides the existing-collection picker", () => {
		render(
			<CreateKnowledgeBaseDialog workspace="ws" open onOpenChange={() => {}} />,
		);
		expect(
			screen.getByRole("tab", { name: /Create new collection/ }),
		).toHaveAttribute("aria-selected", "true");
		expect(
			screen.getByRole("tab", { name: /Attach existing/ }),
		).toHaveAttribute("aria-selected", "false");
		expect(screen.queryByText(/Existing collection/)).not.toBeInTheDocument();
	});

	it("switches to 'attach' mode and shows the collection picker", async () => {
		const user = userEvent.setup();
		render(
			<CreateKnowledgeBaseDialog workspace="ws" open onOpenChange={() => {}} />,
		);
		await user.click(screen.getByRole("tab", { name: /Attach existing/ }));
		expect(screen.getByText(/Existing collection/)).toBeInTheDocument();
		// CTA copy reflects the attach action.
		expect(
			screen.getByRole("button", { name: /Attach knowledge base/ }),
		).toBeInTheDocument();
	});

	it("warns the user when no unattached collections are available in attach mode", async () => {
		adoptableState.data = [{ ...COL_SMALL, attached: true }];
		const user = userEvent.setup();
		render(
			<CreateKnowledgeBaseDialog workspace="ws" open onOpenChange={() => {}} />,
		);
		await user.click(screen.getByRole("tab", { name: /Attach existing/ }));
		expect(
			screen.getByText(/No unattached collections found/i),
		).toBeInTheDocument();
		// Submit is blocked.
		expect(
			screen.getByRole("button", { name: /Attach knowledge base/ }),
		).toBeDisabled();
	});
});
