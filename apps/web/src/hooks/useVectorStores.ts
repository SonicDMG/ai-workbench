import {
	type UseMutationResult,
	type UseQueryResult,
	useMutation,
	useQuery,
	useQueryClient,
} from "@tanstack/react-query";
import { api } from "@/lib/api";
import type {
	AdoptableCollection,
	CreateVectorStoreInput,
	VectorStoreRecord,
} from "@/lib/schemas";

const keys = {
	all: (workspace: string) =>
		["workspaces", workspace, "vector-stores"] as const,
	discoverable: (workspace: string) =>
		["workspaces", workspace, "vector-stores", "discoverable"] as const,
};

export function useVectorStores(
	workspace: string | undefined,
): UseQueryResult<VectorStoreRecord[], Error> {
	return useQuery({
		queryKey: workspace
			? keys.all(workspace)
			: ["workspaces", "_", "vector-stores"],
		queryFn: () => (workspace ? api.listVectorStores(workspace) : []),
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

/**
 * Lists data-plane collections that exist in the bound DB but aren't
 * yet wrapped in a workbench descriptor. Empty for `mock` workspaces
 * (the driver has no listAdoptable). Drives the "Adopt existing"
 * flow on the workspace detail page.
 */
export function useDiscoverableCollections(
	workspace: string | undefined,
	opts?: { enabled?: boolean },
): UseQueryResult<AdoptableCollection[], Error> {
	const enabled = Boolean(workspace) && (opts?.enabled ?? true);
	return useQuery({
		queryKey: workspace
			? keys.discoverable(workspace)
			: ["workspaces", "_", "vector-stores", "discoverable"],
		queryFn: () =>
			workspace ? api.listDiscoverableCollections(workspace) : [],
		enabled,
	});
}

/**
 * Adopts a single existing collection. Invalidates both the
 * descriptor list (a new descriptor lands) and the discoverable list
 * (the collection is no longer adoptable).
 */
export function useAdoptCollection(
	workspace: string,
): UseMutationResult<VectorStoreRecord, Error, string> {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: (collectionName) =>
			api.adoptCollection(workspace, collectionName),
		onSuccess: () => {
			qc.invalidateQueries({ queryKey: keys.all(workspace) });
			qc.invalidateQueries({ queryKey: keys.discoverable(workspace) });
		},
	});
}
