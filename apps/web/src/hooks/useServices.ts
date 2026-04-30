/**
 * Hooks for the three execution-service surfaces (chunking,
 * embedding, reranking). They share the same shape — list / create /
 * delete — so we use a small factory to avoid stamping out three
 * near-identical files.
 */
import {
	type UseMutationResult,
	type UseQueryResult,
	useMutation,
	useQuery,
	useQueryClient,
} from "@tanstack/react-query";
import { api } from "@/lib/api";
import type {
	ChunkingServiceRecord,
	CreateChunkingServiceInput,
	CreateEmbeddingServiceInput,
	CreateRerankingServiceInput,
	EmbeddingServiceRecord,
	RerankingServiceRecord,
} from "@/lib/schemas";

type ServiceKind = "chunking" | "embedding" | "reranking";

const KIND_PATH: Record<ServiceKind, string> = {
	chunking: "chunking-services",
	embedding: "embedding-services",
	reranking: "reranking-services",
};

function keys(workspaceId: string, kind: ServiceKind) {
	return ["workspaces", workspaceId, KIND_PATH[kind]] as const;
}

export function useChunkingServices(
	workspaceId: string | undefined,
): UseQueryResult<ChunkingServiceRecord[], Error> {
	return useQuery({
		queryKey: workspaceId
			? keys(workspaceId, "chunking")
			: ["workspaces", "_", "chunking-services"],
		queryFn: () => (workspaceId ? api.listChunkingServices(workspaceId) : []),
		enabled: Boolean(workspaceId),
	});
}

export function useEmbeddingServices(
	workspaceId: string | undefined,
): UseQueryResult<EmbeddingServiceRecord[], Error> {
	return useQuery({
		queryKey: workspaceId
			? keys(workspaceId, "embedding")
			: ["workspaces", "_", "embedding-services"],
		queryFn: () => (workspaceId ? api.listEmbeddingServices(workspaceId) : []),
		enabled: Boolean(workspaceId),
	});
}

export function useRerankingServices(
	workspaceId: string | undefined,
): UseQueryResult<RerankingServiceRecord[], Error> {
	return useQuery({
		queryKey: workspaceId
			? keys(workspaceId, "reranking")
			: ["workspaces", "_", "reranking-services"],
		queryFn: () => (workspaceId ? api.listRerankingServices(workspaceId) : []),
		enabled: Boolean(workspaceId),
	});
}

export function useCreateChunkingService(
	workspaceId: string,
): UseMutationResult<ChunkingServiceRecord, Error, CreateChunkingServiceInput> {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: (input) => api.createChunkingService(workspaceId, input),
		onSuccess: () => {
			qc.invalidateQueries({ queryKey: keys(workspaceId, "chunking") });
		},
	});
}

export function useCreateEmbeddingService(
	workspaceId: string,
): UseMutationResult<
	EmbeddingServiceRecord,
	Error,
	CreateEmbeddingServiceInput
> {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: (input) => api.createEmbeddingService(workspaceId, input),
		onSuccess: () => {
			qc.invalidateQueries({ queryKey: keys(workspaceId, "embedding") });
		},
	});
}

export function useCreateRerankingService(
	workspaceId: string,
): UseMutationResult<
	RerankingServiceRecord,
	Error,
	CreateRerankingServiceInput
> {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: (input) => api.createRerankingService(workspaceId, input),
		onSuccess: () => {
			qc.invalidateQueries({ queryKey: keys(workspaceId, "reranking") });
		},
	});
}

export function useDeleteChunkingService(
	workspaceId: string,
): UseMutationResult<void, Error, string> {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: (chunkingServiceId) =>
			api.deleteChunkingService(workspaceId, chunkingServiceId),
		onSuccess: () => {
			qc.invalidateQueries({ queryKey: keys(workspaceId, "chunking") });
		},
	});
}

export function useDeleteEmbeddingService(
	workspaceId: string,
): UseMutationResult<void, Error, string> {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: (embeddingServiceId) =>
			api.deleteEmbeddingService(workspaceId, embeddingServiceId),
		onSuccess: () => {
			qc.invalidateQueries({ queryKey: keys(workspaceId, "embedding") });
		},
	});
}

export function useDeleteRerankingService(
	workspaceId: string,
): UseMutationResult<void, Error, string> {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: (rerankingServiceId) =>
			api.deleteRerankingService(workspaceId, rerankingServiceId),
		onSuccess: () => {
			qc.invalidateQueries({ queryKey: keys(workspaceId, "reranking") });
		},
	});
}
