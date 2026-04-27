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

function keys(workspaceUid: string, kind: ServiceKind) {
	return ["workspaces", workspaceUid, KIND_PATH[kind]] as const;
}

export function useChunkingServices(
	workspaceUid: string | undefined,
): UseQueryResult<ChunkingServiceRecord[], Error> {
	return useQuery({
		queryKey: workspaceUid
			? keys(workspaceUid, "chunking")
			: ["workspaces", "_", "chunking-services"],
		queryFn: () => (workspaceUid ? api.listChunkingServices(workspaceUid) : []),
		enabled: Boolean(workspaceUid),
	});
}

export function useEmbeddingServices(
	workspaceUid: string | undefined,
): UseQueryResult<EmbeddingServiceRecord[], Error> {
	return useQuery({
		queryKey: workspaceUid
			? keys(workspaceUid, "embedding")
			: ["workspaces", "_", "embedding-services"],
		queryFn: () =>
			workspaceUid ? api.listEmbeddingServices(workspaceUid) : [],
		enabled: Boolean(workspaceUid),
	});
}

export function useRerankingServices(
	workspaceUid: string | undefined,
): UseQueryResult<RerankingServiceRecord[], Error> {
	return useQuery({
		queryKey: workspaceUid
			? keys(workspaceUid, "reranking")
			: ["workspaces", "_", "reranking-services"],
		queryFn: () =>
			workspaceUid ? api.listRerankingServices(workspaceUid) : [],
		enabled: Boolean(workspaceUid),
	});
}

export function useCreateChunkingService(
	workspaceUid: string,
): UseMutationResult<ChunkingServiceRecord, Error, CreateChunkingServiceInput> {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: (input) => api.createChunkingService(workspaceUid, input),
		onSuccess: () => {
			qc.invalidateQueries({ queryKey: keys(workspaceUid, "chunking") });
		},
	});
}

export function useCreateEmbeddingService(
	workspaceUid: string,
): UseMutationResult<
	EmbeddingServiceRecord,
	Error,
	CreateEmbeddingServiceInput
> {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: (input) => api.createEmbeddingService(workspaceUid, input),
		onSuccess: () => {
			qc.invalidateQueries({ queryKey: keys(workspaceUid, "embedding") });
		},
	});
}

export function useCreateRerankingService(
	workspaceUid: string,
): UseMutationResult<
	RerankingServiceRecord,
	Error,
	CreateRerankingServiceInput
> {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: (input) => api.createRerankingService(workspaceUid, input),
		onSuccess: () => {
			qc.invalidateQueries({ queryKey: keys(workspaceUid, "reranking") });
		},
	});
}

export function useDeleteChunkingService(
	workspaceUid: string,
): UseMutationResult<void, Error, string> {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: (uid) => api.deleteChunkingService(workspaceUid, uid),
		onSuccess: () => {
			qc.invalidateQueries({ queryKey: keys(workspaceUid, "chunking") });
		},
	});
}

export function useDeleteEmbeddingService(
	workspaceUid: string,
): UseMutationResult<void, Error, string> {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: (uid) => api.deleteEmbeddingService(workspaceUid, uid),
		onSuccess: () => {
			qc.invalidateQueries({ queryKey: keys(workspaceUid, "embedding") });
		},
	});
}

export function useDeleteRerankingService(
	workspaceUid: string,
): UseMutationResult<void, Error, string> {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: (uid) => api.deleteRerankingService(workspaceUid, uid),
		onSuccess: () => {
			qc.invalidateQueries({ queryKey: keys(workspaceUid, "reranking") });
		},
	});
}
