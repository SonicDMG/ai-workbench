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
	CreateKnowledgeBaseInput,
	KnowledgeBaseRecord,
	UpdateKnowledgeBaseInput,
} from "@/lib/schemas";

const keys = {
	all: (workspaceId: string) =>
		["workspaces", workspaceId, "knowledge-bases"] as const,
	one: (workspaceId: string, kbId: string) =>
		["workspaces", workspaceId, "knowledge-bases", kbId] as const,
	adoptable: (workspaceId: string) =>
		["workspaces", workspaceId, "adoptable-collections"] as const,
};

export function useAdoptableCollections(
	workspaceId: string | undefined,
	enabled = true,
): UseQueryResult<AdoptableCollection[], Error> {
	return useQuery({
		queryKey: workspaceId
			? keys.adoptable(workspaceId)
			: ["workspaces", "_", "adoptable-collections"],
		queryFn: () =>
			workspaceId ? api.listAdoptableCollections(workspaceId) : [],
		enabled: Boolean(workspaceId) && enabled,
	});
}

export function useKnowledgeBases(
	workspaceId: string | undefined,
): UseQueryResult<KnowledgeBaseRecord[], Error> {
	return useQuery({
		queryKey: workspaceId
			? keys.all(workspaceId)
			: ["workspaces", "_", "knowledge-bases"],
		queryFn: () => (workspaceId ? api.listKnowledgeBases(workspaceId) : []),
		enabled: Boolean(workspaceId),
	});
}

export function useKnowledgeBase(
	workspaceId: string | undefined,
	kbId: string | undefined,
): UseQueryResult<KnowledgeBaseRecord, Error> {
	return useQuery({
		queryKey:
			workspaceId && kbId
				? keys.one(workspaceId, kbId)
				: ["workspaces", "_", "knowledge-bases", "_"],
		queryFn: () => {
			if (!workspaceId || !kbId) {
				throw new Error("useKnowledgeBase requires workspaceId + kbId");
			}
			return api.getKnowledgeBase(workspaceId, kbId);
		},
		enabled: Boolean(workspaceId && kbId),
	});
}

export function useCreateKnowledgeBase(
	workspaceId: string,
): UseMutationResult<KnowledgeBaseRecord, Error, CreateKnowledgeBaseInput> {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: (input) => api.createKnowledgeBase(workspaceId, input),
		onSuccess: () => {
			qc.invalidateQueries({ queryKey: keys.all(workspaceId) });
		},
	});
}

export function useUpdateKnowledgeBase(
	workspaceId: string,
	kbId: string,
): UseMutationResult<KnowledgeBaseRecord, Error, UpdateKnowledgeBaseInput> {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: (patch) => api.updateKnowledgeBase(workspaceId, kbId, patch),
		onSuccess: () => {
			qc.invalidateQueries({ queryKey: keys.all(workspaceId) });
			qc.invalidateQueries({ queryKey: keys.one(workspaceId, kbId) });
		},
	});
}

export function useDeleteKnowledgeBase(
	workspaceId: string,
): UseMutationResult<void, Error, string> {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: (kbId) => api.deleteKnowledgeBase(workspaceId, kbId),
		onSuccess: () => {
			qc.invalidateQueries({ queryKey: keys.all(workspaceId) });
		},
	});
}
