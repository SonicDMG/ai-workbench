import {
	type UseMutationResult,
	type UseQueryResult,
	useMutation,
	useQuery,
	useQueryClient,
} from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { DocumentChunk, RagDocumentRecord } from "@/lib/schemas";

const keys = {
	all: (workspaceId: string, kbId: string) =>
		["workspaces", workspaceId, "knowledge-bases", kbId, "documents"] as const,
	chunks: (workspaceId: string, kbId: string, documentId: string) =>
		[
			"workspaces",
			workspaceId,
			"knowledge-bases",
			kbId,
			"documents",
			documentId,
			"chunks",
		] as const,
};

export function useDocuments(
	workspaceId: string | undefined,
	kbId: string | undefined,
): UseQueryResult<RagDocumentRecord[], Error> {
	return useQuery({
		queryKey:
			workspaceId && kbId
				? keys.all(workspaceId, kbId)
				: ["workspaces", "_", "knowledge-bases", "_", "documents"],
		queryFn: () =>
			workspaceId && kbId ? api.listKbDocuments(workspaceId, kbId) : [],
		enabled: Boolean(workspaceId && kbId),
	});
}

/**
 * Lists chunks under a KB document. Disabled until all three IDs
 * are defined so consumers can pass `undefined`s while the parent
 * dialog is closed.
 */
export function useDocumentChunks(
	workspaceId: string | undefined,
	kbId: string | undefined,
	documentId: string | undefined,
	opts?: { enabled?: boolean; limit?: number },
): UseQueryResult<DocumentChunk[], Error> {
	const enabled =
		Boolean(workspaceId && kbId && documentId) && (opts?.enabled ?? true);
	return useQuery({
		queryKey:
			workspaceId && kbId && documentId
				? keys.chunks(workspaceId, kbId, documentId)
				: [
						"workspaces",
						"_",
						"knowledge-bases",
						"_",
						"documents",
						"_",
						"chunks",
					],
		queryFn: () =>
			workspaceId && kbId && documentId
				? api.listKbDocumentChunks(workspaceId, kbId, documentId, {
						limit: opts?.limit ?? 1000,
					})
				: [],
		enabled,
	});
}

export function documentQueryKey(workspaceId: string, kbId: string) {
	return keys.all(workspaceId, kbId);
}

/**
 * Deletes a document from a KB. The runtime cascades to wipe the
 * document's chunks from the KB's vector collection too, so a
 * successful delete leaves no traces in KB-scoped search.
 */
export function useDeleteDocument(
	workspaceId: string,
	kbId: string,
): UseMutationResult<void, Error, string> {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: (documentId) =>
			api.deleteKbDocument(workspaceId, kbId, documentId),
		onSuccess: (_void, documentId) => {
			qc.invalidateQueries({ queryKey: keys.all(workspaceId, kbId) });
			qc.invalidateQueries({
				queryKey: keys.chunks(workspaceId, kbId, documentId),
			});
		},
	});
}
