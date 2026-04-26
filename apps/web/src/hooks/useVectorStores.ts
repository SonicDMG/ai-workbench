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
	all: (workspaceUid: string) =>
		["workspaces", workspaceUid, "vector-stores"] as const,
	discoverable: (workspaceUid: string) =>
		["workspaces", workspaceUid, "vector-stores", "discoverable"] as const,
};

export function useVectorStores(
	workspaceUid: string | undefined,
): UseQueryResult<VectorStoreRecord[], Error> {
	return useQuery({
		queryKey: workspaceUid
			? keys.all(workspaceUid)
			: ["workspaces", "_", "vector-stores"],
		queryFn: () => (workspaceUid ? api.listVectorStores(workspaceUid) : []),
		enabled: Boolean(workspaceUid),
	});
}

export function useCreateVectorStore(
	workspaceUid: string,
): UseMutationResult<VectorStoreRecord, Error, CreateVectorStoreInput> {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: (input) => api.createVectorStore(workspaceUid, input),
		onSuccess: () => {
			qc.invalidateQueries({ queryKey: keys.all(workspaceUid) });
		},
	});
}

export function useDeleteVectorStore(
	workspaceUid: string,
): UseMutationResult<void, Error, string> {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: (uid) => api.deleteVectorStore(workspaceUid, uid),
		onSuccess: () => {
			qc.invalidateQueries({ queryKey: keys.all(workspaceUid) });
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
	workspaceUid: string | undefined,
	opts?: { enabled?: boolean },
): UseQueryResult<AdoptableCollection[], Error> {
	const enabled = Boolean(workspaceUid) && (opts?.enabled ?? true);
	return useQuery({
		queryKey: workspaceUid
			? keys.discoverable(workspaceUid)
			: ["workspaces", "_", "vector-stores", "discoverable"],
		queryFn: () =>
			workspaceUid ? api.listDiscoverableCollections(workspaceUid) : [],
		enabled,
	});
}

/**
 * Adopts a single existing collection. Invalidates both the
 * descriptor list (a new descriptor lands) and the discoverable list
 * (the collection is no longer adoptable).
 */
export function useAdoptCollection(
	workspaceUid: string,
): UseMutationResult<VectorStoreRecord, Error, string> {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: (collectionName) =>
			api.adoptCollection(workspaceUid, collectionName),
		onSuccess: () => {
			qc.invalidateQueries({ queryKey: keys.all(workspaceUid) });
			qc.invalidateQueries({ queryKey: keys.discoverable(workspaceUid) });
		},
	});
}
