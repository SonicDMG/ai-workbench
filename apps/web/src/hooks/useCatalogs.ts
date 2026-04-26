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
	all: (workspaceUid: string) =>
		["workspaces", workspaceUid, "catalogs"] as const,
};

export function useCatalogs(
	workspaceUid: string | undefined,
): UseQueryResult<CatalogRecord[], Error> {
	return useQuery({
		queryKey: workspaceUid
			? keys.all(workspaceUid)
			: ["workspaces", "_", "catalogs"],
		queryFn: () => (workspaceUid ? api.listCatalogs(workspaceUid) : []),
		enabled: Boolean(workspaceUid),
	});
}

export function useCreateCatalog(
	workspaceUid: string,
): UseMutationResult<CatalogRecord, Error, CreateCatalogInput> {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: (input) => api.createCatalog(workspaceUid, input),
		onSuccess: () => {
			qc.invalidateQueries({ queryKey: keys.all(workspaceUid) });
		},
	});
}

export function useDeleteCatalog(
	workspaceUid: string,
): UseMutationResult<void, Error, string> {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: (catalogUid) => api.deleteCatalog(workspaceUid, catalogUid),
		onSuccess: () => {
			qc.invalidateQueries({ queryKey: keys.all(workspaceUid) });
		},
	});
}
