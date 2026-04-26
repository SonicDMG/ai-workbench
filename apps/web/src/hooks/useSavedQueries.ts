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
	all: (workspaceUid: string, catalogUid: string) =>
		["workspaces", workspaceUid, "catalogs", catalogUid, "queries"] as const,
};

export function useSavedQueries(
	workspaceUid: string | undefined,
	catalogUid: string | undefined,
): UseQueryResult<SavedQueryRecord[], Error> {
	return useQuery({
		queryKey:
			workspaceUid && catalogUid
				? keys.all(workspaceUid, catalogUid)
				: ["workspaces", "_", "catalogs", "_", "queries"],
		queryFn: () =>
			workspaceUid && catalogUid
				? api.listSavedQueries(workspaceUid, catalogUid)
				: [],
		enabled: Boolean(workspaceUid && catalogUid),
	});
}

export function useCreateSavedQuery(
	workspaceUid: string,
	catalogUid: string,
): UseMutationResult<SavedQueryRecord, Error, CreateSavedQueryInput> {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: (input) =>
			api.createSavedQuery(workspaceUid, catalogUid, input),
		onSuccess: () => {
			qc.invalidateQueries({ queryKey: keys.all(workspaceUid, catalogUid) });
		},
	});
}

export function useDeleteSavedQuery(
	workspaceUid: string,
	catalogUid: string,
): UseMutationResult<void, Error, string> {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: (queryUid) =>
			api.deleteSavedQuery(workspaceUid, catalogUid, queryUid),
		onSuccess: () => {
			qc.invalidateQueries({ queryKey: keys.all(workspaceUid, catalogUid) });
		},
	});
}

/**
 * Run a saved query on demand. Returns hits the same shape as the
 * catalog-scoped search route — `/run` is just a server-side replay
 * through that path with `catalogUid` merged into the filter.
 */
export function useRunSavedQuery(
	workspaceUid: string,
	catalogUid: string,
): UseMutationResult<SearchHit[], Error, string> {
	return useMutation({
		mutationFn: (queryUid) =>
			api.runSavedQuery(workspaceUid, catalogUid, queryUid),
	});
}
