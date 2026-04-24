import {
	type UseMutationResult,
	type UseQueryResult,
	useMutation,
	useQuery,
	useQueryClient,
} from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { CreateVectorStoreInput, VectorStoreRecord } from "@/lib/schemas";

const keys = {
	all: (workspace: string) =>
		["workspaces", workspace, "vector-stores"] as const,
};

export function useVectorStores(
	workspace: string | undefined,
): UseQueryResult<VectorStoreRecord[], Error> {
	return useQuery({
		queryKey: workspace
			? keys.all(workspace)
			: ["workspaces", "_", "vector-stores"],
		queryFn: () => api.listVectorStores(workspace!),
		enabled: Boolean(workspace),
	});
}

export function useCreateVectorStore(
	workspace: string,
): UseMutationResult<VectorStoreRecord, Error, CreateVectorStoreInput> {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: (input) => api.createVectorStore(workspace, input),
		onSuccess: () => {
			qc.invalidateQueries({ queryKey: keys.all(workspace) });
		},
	});
}

export function useDeleteVectorStore(
	workspace: string,
): UseMutationResult<void, Error, string> {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: (uid) => api.deleteVectorStore(workspace, uid),
		onSuccess: () => {
			qc.invalidateQueries({ queryKey: keys.all(workspace) });
		},
	});
}
