import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import type {
	ChunkingServiceRecord,
	EmbeddingServiceRecord,
	RerankingServiceRecord,
} from "@/lib/schemas";

vi.mock("@/lib/api", () => ({
	api: {
		listChunkingServices: vi.fn(),
		listEmbeddingServices: vi.fn(),
		listRerankingServices: vi.fn(),
		createChunkingService: vi.fn(),
		updateChunkingService: vi.fn(),
		deleteChunkingService: vi.fn(),
		createEmbeddingService: vi.fn(),
		updateEmbeddingService: vi.fn(),
		deleteEmbeddingService: vi.fn(),
		createRerankingService: vi.fn(),
		updateRerankingService: vi.fn(),
		deleteRerankingService: vi.fn(),
	},
	ApiError: class ApiError extends Error {},
}));

import { api } from "@/lib/api";
import {
	useChunkingServices,
	useCreateChunkingService,
	useCreateEmbeddingService,
	useCreateRerankingService,
	useDeleteChunkingService,
	useDeleteEmbeddingService,
	useDeleteRerankingService,
	useEmbeddingServices,
	useRerankingServices,
	useUpdateChunkingService,
	useUpdateEmbeddingService,
	useUpdateRerankingService,
} from "./useServices";

const WORKSPACE_ID = "00000000-0000-4000-8000-000000000001";
const CHUNK_ID = "00000000-0000-4000-8000-aaaaaaaaaaaa";
const EMBED_ID = "00000000-0000-4000-8000-bbbbbbbbbbbb";
const RERANK_ID = "00000000-0000-4000-8000-cccccccccccc";

const sampleEndpoint = {
	authType: "none" as const,
	credentialRef: null,
	endpointBaseUrl: null,
	endpointPath: null,
	requestTimeoutMs: null,
	maxBatchSize: null,
};

const sampleChunking: ChunkingServiceRecord = {
	workspaceId: WORKSPACE_ID,
	chunkingServiceId: CHUNK_ID,
	name: "default",
	description: null,
	status: "active",
	engine: "line",
	engineVersion: null,
	strategy: null,
	maxChunkSize: null,
	minChunkSize: null,
	chunkUnit: null,
	overlapSize: null,
	overlapUnit: null,
	preserveStructure: null,
	language: null,
	maxPayloadSizeKb: null,
	enableOcr: null,
	extractTables: null,
	extractFigures: null,
	readingOrder: null,
	...sampleEndpoint,
	createdAt: "2026-04-22T10:11:12.345Z",
	updatedAt: "2026-04-22T10:11:12.345Z",
};

const sampleEmbedding = {
	workspaceId: WORKSPACE_ID,
	embeddingServiceId: EMBED_ID,
	name: "openai-3-small",
	description: null,
	status: "active",
	createdAt: "2026-04-22T10:11:12.345Z",
	updatedAt: "2026-04-22T10:11:12.345Z",
} as unknown as EmbeddingServiceRecord;

const sampleReranking = {
	workspaceId: WORKSPACE_ID,
	rerankingServiceId: RERANK_ID,
	name: "cohere-rerank-3",
	description: null,
	status: "active",
	createdAt: "2026-04-22T10:11:12.345Z",
	updatedAt: "2026-04-22T10:11:12.345Z",
} as unknown as RerankingServiceRecord;

function makeWrapper() {
	const qc = new QueryClient({
		defaultOptions: {
			queries: { retry: false },
			mutations: { retry: false },
		},
	});
	function Wrapper({ children }: { children: ReactNode }) {
		return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
	}
	return { wrapper: Wrapper, qc };
}

describe("list hooks", () => {
	it("useChunkingServices fetches when workspaceId is present", async () => {
		vi.mocked(api.listChunkingServices).mockResolvedValueOnce([sampleChunking]);
		const { wrapper } = makeWrapper();
		const { result } = renderHook(() => useChunkingServices(WORKSPACE_ID), {
			wrapper,
		});
		await waitFor(() => expect(result.current.isSuccess).toBe(true));
		expect(result.current.data).toEqual([sampleChunking]);
		expect(api.listChunkingServices).toHaveBeenCalledWith(WORKSPACE_ID);
	});

	it("useEmbeddingServices fetches when workspaceId is present", async () => {
		vi.mocked(api.listEmbeddingServices).mockResolvedValueOnce([
			sampleEmbedding,
		]);
		const { wrapper } = makeWrapper();
		const { result } = renderHook(() => useEmbeddingServices(WORKSPACE_ID), {
			wrapper,
		});
		await waitFor(() => expect(result.current.isSuccess).toBe(true));
		expect(api.listEmbeddingServices).toHaveBeenCalledWith(WORKSPACE_ID);
	});

	it("useRerankingServices fetches when workspaceId is present", async () => {
		vi.mocked(api.listRerankingServices).mockResolvedValueOnce([
			sampleReranking,
		]);
		const { wrapper } = makeWrapper();
		const { result } = renderHook(() => useRerankingServices(WORKSPACE_ID), {
			wrapper,
		});
		await waitFor(() => expect(result.current.isSuccess).toBe(true));
		expect(api.listRerankingServices).toHaveBeenCalledWith(WORKSPACE_ID);
	});

	it.each([
		["chunking", useChunkingServices, "listChunkingServices"],
		["embedding", useEmbeddingServices, "listEmbeddingServices"],
		["reranking", useRerankingServices, "listRerankingServices"],
	] as const)("%s list stays idle and never calls the api when workspaceId is undefined", (_kind, hook, apiKey) => {
		const { wrapper } = makeWrapper();
		const { result } = renderHook(() => hook(undefined), { wrapper });
		expect(result.current.fetchStatus).toBe("idle");
		expect(api[apiKey as keyof typeof api]).not.toHaveBeenCalled();
	});
});

describe("chunking mutations invalidate the chunking list", () => {
	it("create", async () => {
		vi.mocked(api.createChunkingService).mockResolvedValueOnce(sampleChunking);
		const { wrapper, qc } = makeWrapper();
		qc.setQueryData(["workspaces", WORKSPACE_ID, "chunking-services"], []);
		const { result } = renderHook(
			() => useCreateChunkingService(WORKSPACE_ID),
			{
				wrapper,
			},
		);
		await act(async () => {
			await result.current.mutateAsync({ name: "x", engine: "line" });
		});
		expect(
			qc.getQueryState(["workspaces", WORKSPACE_ID, "chunking-services"])
				?.isInvalidated,
		).toBe(true);
	});

	it("update", async () => {
		vi.mocked(api.updateChunkingService).mockResolvedValueOnce(sampleChunking);
		const { wrapper, qc } = makeWrapper();
		qc.setQueryData(
			["workspaces", WORKSPACE_ID, "chunking-services"],
			[sampleChunking],
		);
		const { result } = renderHook(
			() => useUpdateChunkingService(WORKSPACE_ID, CHUNK_ID),
			{ wrapper },
		);
		await act(async () => {
			await result.current.mutateAsync({ name: "renamed" });
		});
		expect(api.updateChunkingService).toHaveBeenCalledWith(
			WORKSPACE_ID,
			CHUNK_ID,
			{ name: "renamed" },
		);
		expect(
			qc.getQueryState(["workspaces", WORKSPACE_ID, "chunking-services"])
				?.isInvalidated,
		).toBe(true);
	});

	it("delete", async () => {
		vi.mocked(api.deleteChunkingService).mockResolvedValueOnce(undefined);
		const { wrapper, qc } = makeWrapper();
		qc.setQueryData(
			["workspaces", WORKSPACE_ID, "chunking-services"],
			[sampleChunking],
		);
		const { result } = renderHook(
			() => useDeleteChunkingService(WORKSPACE_ID),
			{
				wrapper,
			},
		);
		await act(async () => {
			await result.current.mutateAsync(CHUNK_ID);
		});
		expect(vi.mocked(api.deleteChunkingService).mock.calls[0]?.[0]).toBe(
			WORKSPACE_ID,
		);
		expect(vi.mocked(api.deleteChunkingService).mock.calls[0]?.[1]).toBe(
			CHUNK_ID,
		);
		expect(
			qc.getQueryState(["workspaces", WORKSPACE_ID, "chunking-services"])
				?.isInvalidated,
		).toBe(true);
	});
});

describe("embedding mutations invalidate the embedding list", () => {
	it("create + update + delete each invalidate", async () => {
		vi.mocked(api.createEmbeddingService).mockResolvedValueOnce(
			sampleEmbedding,
		);
		vi.mocked(api.updateEmbeddingService).mockResolvedValueOnce(
			sampleEmbedding,
		);
		vi.mocked(api.deleteEmbeddingService).mockResolvedValueOnce(undefined);
		const { wrapper, qc } = makeWrapper();
		qc.setQueryData(["workspaces", WORKSPACE_ID, "embedding-services"], []);

		const create = renderHook(() => useCreateEmbeddingService(WORKSPACE_ID), {
			wrapper,
		});
		await act(async () => {
			await create.result.current.mutateAsync({
				name: "x",
				engine: "openai",
			} as unknown as Parameters<typeof create.result.current.mutateAsync>[0]);
		});
		expect(
			qc.getQueryState(["workspaces", WORKSPACE_ID, "embedding-services"])
				?.isInvalidated,
		).toBe(true);

		const update = renderHook(
			() => useUpdateEmbeddingService(WORKSPACE_ID, EMBED_ID),
			{ wrapper },
		);
		await act(async () => {
			await update.result.current.mutateAsync({ name: "renamed" });
		});
		expect(api.updateEmbeddingService).toHaveBeenCalledWith(
			WORKSPACE_ID,
			EMBED_ID,
			{ name: "renamed" },
		);

		const del = renderHook(() => useDeleteEmbeddingService(WORKSPACE_ID), {
			wrapper,
		});
		await act(async () => {
			await del.result.current.mutateAsync(EMBED_ID);
		});
		expect(vi.mocked(api.deleteEmbeddingService).mock.calls[0]?.[0]).toBe(
			WORKSPACE_ID,
		);
		expect(vi.mocked(api.deleteEmbeddingService).mock.calls[0]?.[1]).toBe(
			EMBED_ID,
		);
	});
});

describe("reranking mutations invalidate the reranking list", () => {
	it("create + update + delete each invalidate", async () => {
		vi.mocked(api.createRerankingService).mockResolvedValueOnce(
			sampleReranking,
		);
		vi.mocked(api.updateRerankingService).mockResolvedValueOnce(
			sampleReranking,
		);
		vi.mocked(api.deleteRerankingService).mockResolvedValueOnce(undefined);
		const { wrapper, qc } = makeWrapper();
		qc.setQueryData(["workspaces", WORKSPACE_ID, "reranking-services"], []);

		const create = renderHook(() => useCreateRerankingService(WORKSPACE_ID), {
			wrapper,
		});
		await act(async () => {
			await create.result.current.mutateAsync({
				name: "x",
				engine: "cohere",
			} as unknown as Parameters<typeof create.result.current.mutateAsync>[0]);
		});
		expect(
			qc.getQueryState(["workspaces", WORKSPACE_ID, "reranking-services"])
				?.isInvalidated,
		).toBe(true);

		const update = renderHook(
			() => useUpdateRerankingService(WORKSPACE_ID, RERANK_ID),
			{ wrapper },
		);
		await act(async () => {
			await update.result.current.mutateAsync({ name: "renamed" });
		});
		expect(api.updateRerankingService).toHaveBeenCalledWith(
			WORKSPACE_ID,
			RERANK_ID,
			{ name: "renamed" },
		);

		const del = renderHook(() => useDeleteRerankingService(WORKSPACE_ID), {
			wrapper,
		});
		await act(async () => {
			await del.result.current.mutateAsync(RERANK_ID);
		});
		expect(vi.mocked(api.deleteRerankingService).mock.calls[0]?.[0]).toBe(
			WORKSPACE_ID,
		);
		expect(vi.mocked(api.deleteRerankingService).mock.calls[0]?.[1]).toBe(
			RERANK_ID,
		);
	});
});
