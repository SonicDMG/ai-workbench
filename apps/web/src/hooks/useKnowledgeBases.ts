import {
	type UseMutationResult,
	type UseQueryResult,
	useMutation,
	useQuery,
	useQueryClient,
} from "@tanstack/react-query";
import { api } from "@/lib/api";
import type {
	CreateKnowledgeBaseInput,
	KnowledgeBaseRecord,
	UpdateKnowledgeBaseInput,
} from "@/lib/schemas";

const keys = {
	all: (workspaceUid: string) =>
		["workspaces", workspaceUid, "knowledge-bases"] as const,
	one: (workspaceUid: string, kbUid: string) =>
		["workspaces", workspaceUid, "knowledge-bases", kbUid] as const,
};

export function useKnowledgeBases(
	workspaceUid: string | undefined,
): UseQueryResult<KnowledgeBaseRecord[], Error> {
	return useQuery({
		queryKey: workspaceUid
			? keys.all(workspaceUid)
			: ["workspaces", "_", "knowledge-bases"],
		queryFn: () => (workspaceUid ? api.listKnowledgeBases(workspaceUid) : []),
		enabled: Boolean(workspaceUid),
	});
}

export function useKnowledgeBase(
	workspaceUid: string | undefined,
	kbUid: string | undefined,
): UseQueryResult<KnowledgeBaseRecord, Error> {
	return useQuery({
		queryKey:
			workspaceUid && kbUid
				? keys.one(workspaceUid, kbUid)
				: ["workspaces", "_", "knowledge-bases", "_"],
		queryFn: () => {
			if (!workspaceUid || !kbUid) {
				throw new Error("useKnowledgeBase requires workspaceUid + kbUid");
			}
			return api.getKnowledgeBase(workspaceUid, kbUid);
		},
		enabled: Boolean(workspaceUid && kbUid),
	});
}

export function useCreateKnowledgeBase(
	workspaceUid: string,
): UseMutationResult<KnowledgeBaseRecord, Error, CreateKnowledgeBaseInput> {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: (input) => api.createKnowledgeBase(workspaceUid, input),
		onSuccess: () => {
			qc.invalidateQueries({ queryKey: keys.all(workspaceUid) });
		},
	});
}

export function useUpdateKnowledgeBase(
	workspaceUid: string,
	kbUid: string,
): UseMutationResult<KnowledgeBaseRecord, Error, UpdateKnowledgeBaseInput> {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: (patch) => api.updateKnowledgeBase(workspaceUid, kbUid, patch),
		onSuccess: () => {
			qc.invalidateQueries({ queryKey: keys.all(workspaceUid) });
			qc.invalidateQueries({ queryKey: keys.one(workspaceUid, kbUid) });
		},
	});
}

export function useDeleteKnowledgeBase(
	workspaceUid: string,
): UseMutationResult<void, Error, string> {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: (kbUid) => api.deleteKnowledgeBase(workspaceUid, kbUid),
		onSuccess: () => {
			qc.invalidateQueries({ queryKey: keys.all(workspaceUid) });
		},
	});
}
