import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
	AgentRecord,
	ChunkingServiceRecord,
	EmbeddingServiceRecord,
	Workspace,
} from "@/lib/schemas";

vi.mock("@/lib/api", () => ({
	api: {
		listChunkingServices: vi.fn(),
		listEmbeddingServices: vi.fn(),
		listAgents: vi.fn(),
	},
	ApiError: class ApiError extends Error {},
}));

import { api } from "@/lib/api";
import { SeededDefaultsCallout } from "./SeededDefaultsCallout";

function wrapper({ children }: { children: ReactNode }) {
	const qc = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

const WORKSPACE_ID = "00000000-0000-4000-8000-000000000001";

function makeWorkspace(overrides: Partial<Workspace> = {}): Workspace {
	const now = new Date().toISOString();
	return {
		workspaceId: WORKSPACE_ID,
		name: "test",
		url: null,
		kind: "mock",
		credentials: {},
		keyspace: null,
		createdAt: now,
		updatedAt: now,
		...overrides,
	};
}

function chunkingFixture(name: string): ChunkingServiceRecord {
	return {
		workspaceId: WORKSPACE_ID,
		chunkingServiceId: `00000000-0000-4000-8000-${name.padEnd(12, "0")}`,
		name,
		description: null,
		status: "active",
		engine: "langchain_ts",
		strategy: "recursive",
		chunkUnit: "characters",
		maxChunkSize: 1000,
		minChunkSize: 100,
		overlapSize: 150,
		overlapUnit: "characters",
		preserveStructure: true,
		createdAt: "2026-05-04T12:00:00.000Z",
		updatedAt: "2026-05-04T12:00:00.000Z",
	} as unknown as ChunkingServiceRecord;
}

function embeddingFixture(name: string): EmbeddingServiceRecord {
	return {
		workspaceId: WORKSPACE_ID,
		embeddingServiceId: `00000000-0000-4000-8000-${name.padEnd(12, "0")}`,
		name,
		description: null,
		status: "active",
		engine: "langchain_ts",
		provider: "openai",
		modelName: "text-embedding-3-small",
		embeddingDimension: 1536,
		distanceMetric: "cosine",
		credentialRef: null,
		createdAt: "2026-05-04T12:00:00.000Z",
		updatedAt: "2026-05-04T12:00:00.000Z",
	} as unknown as EmbeddingServiceRecord;
}

function agentFixture(name: string): AgentRecord {
	return {
		workspaceId: WORKSPACE_ID,
		agentId: `00000000-0000-4000-8000-${name.padEnd(12, "0")}`,
		name,
		description: null,
		systemPrompt: null,
		userPrompt: null,
		llmServiceId: null,
		knowledgeBaseIds: [],
		rerankEnabled: false,
		rerankingServiceId: null,
		rerankMaxResults: null,
		createdAt: "2026-05-04T12:00:00.000Z",
		updatedAt: "2026-05-04T12:00:00.000Z",
	};
}

beforeEach(() => {
	window.localStorage.clear();
});

afterEach(() => {
	vi.mocked(api.listChunkingServices).mockReset();
	vi.mocked(api.listEmbeddingServices).mockReset();
	vi.mocked(api.listAgents).mockReset();
});

describe("SeededDefaultsCallout", () => {
	it("renders a summary of seeded services + agents on a fresh workspace", async () => {
		vi.mocked(api.listChunkingServices).mockResolvedValueOnce([
			chunkingFixture("a"),
			chunkingFixture("b"),
		]);
		vi.mocked(api.listEmbeddingServices).mockResolvedValueOnce([
			embeddingFixture("c"),
		]);
		vi.mocked(api.listAgents).mockResolvedValueOnce([
			agentFixture("Bobby"),
			agentFixture("Heidi"),
		]);

		render(<SeededDefaultsCallout workspace={makeWorkspace()} />, {
			wrapper,
		});

		expect(
			await screen.findByText(/We pre-configured this workspace for you/),
		).toBeInTheDocument();
		expect(
			screen.getByText(
				/2 chunking services, 1 embedding service, and 2 starter agents/,
			),
		).toBeInTheDocument();
	});

	it("hides itself when the workspace's createdAt is older than the freshness window", () => {
		// Two hours ago — outside the 1-hour freshness window.
		const stale = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();

		render(
			<SeededDefaultsCallout workspace={makeWorkspace({ createdAt: stale })} />,
			{ wrapper },
		);

		expect(
			screen.queryByText(/We pre-configured this workspace for you/),
		).not.toBeInTheDocument();
		// And it must not have triggered any list calls — the queries are
		// gated on freshness so a stale workspace doesn't pay any
		// network cost for the dismissed callout.
		expect(api.listChunkingServices).not.toHaveBeenCalled();
		expect(api.listEmbeddingServices).not.toHaveBeenCalled();
		expect(api.listAgents).not.toHaveBeenCalled();
	});

	it("does not render when localStorage has the dismissal stamp", () => {
		window.localStorage.setItem(
			`ai-workbench:dismiss-seeded-callout:${WORKSPACE_ID}`,
			"1",
		);

		render(<SeededDefaultsCallout workspace={makeWorkspace()} />, {
			wrapper,
		});

		expect(
			screen.queryByText(/We pre-configured this workspace for you/),
		).not.toBeInTheDocument();
	});

	it("disappears after the dismiss button is clicked and persists the dismissal to localStorage", async () => {
		vi.mocked(api.listChunkingServices).mockResolvedValueOnce([
			chunkingFixture("a"),
		]);
		vi.mocked(api.listEmbeddingServices).mockResolvedValueOnce([]);
		vi.mocked(api.listAgents).mockResolvedValueOnce([]);
		const user = userEvent.setup();

		render(<SeededDefaultsCallout workspace={makeWorkspace()} />, {
			wrapper,
		});

		const dismiss = await screen.findByRole("button", {
			name: /Dismiss callout/,
		});
		await user.click(dismiss);

		expect(
			screen.queryByText(/We pre-configured this workspace for you/),
		).not.toBeInTheDocument();
		expect(
			window.localStorage.getItem(
				`ai-workbench:dismiss-seeded-callout:${WORKSPACE_ID}`,
			),
		).toBe("1");
	});

	it("renders nothing when every list returns empty (failed-seed workspace)", async () => {
		vi.mocked(api.listChunkingServices).mockResolvedValueOnce([]);
		vi.mocked(api.listEmbeddingServices).mockResolvedValueOnce([]);
		vi.mocked(api.listAgents).mockResolvedValueOnce([]);

		const { container } = render(
			<SeededDefaultsCallout workspace={makeWorkspace()} />,
			{ wrapper },
		);

		// Wait one tick for queries to settle; without anything to claim,
		// the callout should remain hidden.
		await new Promise((r) => setTimeout(r, 10));
		expect(container.textContent).toBe("");
	});
});
