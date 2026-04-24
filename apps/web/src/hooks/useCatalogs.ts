import {
	type UseMutationResult,
	type UseQueryResult,
	useMutation,
	useQuery,
	useQueryClient,
} from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { CatalogRecord, CreateCatalogInput } from "@/lib/schemas";

const keys = {
	all: (workspace: string) => ["workspaces", workspace, "catalogs"] as const,
};

export function useCatalogs(
	workspace: string | undefined,
): UseQueryResult<CatalogRecord[], Error> {
	return useQuery({
		queryKey: workspace ? keys.all(workspace) : ["workspaces", "_", "catalogs"],
		queryFn: () => (workspace ? api.listCatalogs(workspace) : []),
		enabled: Boolean(workspace),
	});
}

export function useCreateCatalog(
	workspace: string,
): UseMutationResult<CatalogRecord, Error, CreateCatalogInput> {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: (input) => api.createCatalog(workspace, input),
		onSuccess: () => {
			qc.invalidateQueries({ queryKey: keys.all(workspace) });
		},
	});
}

export function useDeleteCatalog(
	workspace: string,
): UseMutationResult<void, Error, string> {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: (catalogId) => api.deleteCatalog(workspace, catalogId),
		onSuccess: () => {
			qc.invalidateQueries({ queryKey: keys.all(workspace) });
		},
	});
}
