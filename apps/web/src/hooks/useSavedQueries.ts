import {
	type UseMutationResult,
	type UseQueryResult,
	useMutation,
	useQuery,
	useQueryClient,
} from "@tanstack/react-query";
import { api } from "@/lib/api";
import type {
	CreateSavedQueryInput,
	SavedQueryRecord,
	SearchHit,
} from "@/lib/schemas";

const keys = {
	all: (workspace: string, catalogId: string) =>
		["workspaces", workspace, "catalogs", catalogId, "queries"] as const,
};

export function useSavedQueries(
	workspace: string | undefined,
	catalogId: string | undefined,
): UseQueryResult<SavedQueryRecord[], Error> {
	return useQuery({
		queryKey:
			workspace && catalogId
				? keys.all(workspace, catalogId)
				: ["workspaces", "_", "catalogs", "_", "queries"],
		queryFn: () =>
			workspace && catalogId ? api.listSavedQueries(workspace, catalogId) : [],
		enabled: Boolean(workspace && catalogId),
	});
}

export function useCreateSavedQuery(
	workspace: string,
	catalogId: string,
): UseMutationResult<SavedQueryRecord, Error, CreateSavedQueryInput> {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: (input) => api.createSavedQuery(workspace, catalogId, input),
		onSuccess: () => {
			qc.invalidateQueries({ queryKey: keys.all(workspace, catalogId) });
		},
	});
}

export function useDeleteSavedQuery(
	workspace: string,
	catalogId: string,
): UseMutationResult<void, Error, string> {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: (queryId) =>
			api.deleteSavedQuery(workspace, catalogId, queryId),
		onSuccess: () => {
			qc.invalidateQueries({ queryKey: keys.all(workspace, catalogId) });
		},
	});
}

/**
 * Run a saved query on demand. Returns hits the same shape as the
 * catalog-scoped search route — `/run` is just a server-side replay
 * through that path with `catalogUid` merged into the filter.
 */
export function useRunSavedQuery(
	workspace: string,
	catalogId: string,
): UseMutationResult<SearchHit[], Error, string> {
	return useMutation({
		mutationFn: (queryId) => api.runSavedQuery(workspace, catalogId, queryId),
	});
}
