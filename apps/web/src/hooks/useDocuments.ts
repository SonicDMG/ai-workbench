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
	all: (workspaceUid: string, kbUid: string) =>
		[
			"workspaces",
			workspaceUid,
			"knowledge-bases",
			kbUid,
			"documents",
		] as const,
	chunks: (workspaceUid: string, kbUid: string, documentUid: string) =>
		[
			"workspaces",
			workspaceUid,
			"knowledge-bases",
			kbUid,
			"documents",
			documentUid,
			"chunks",
		] as const,
};

export function useDocuments(
	workspaceUid: string | undefined,
	kbUid: string | undefined,
): UseQueryResult<RagDocumentRecord[], Error> {
	return useQuery({
		queryKey:
			workspaceUid && kbUid
				? keys.all(workspaceUid, kbUid)
				: ["workspaces", "_", "knowledge-bases", "_", "documents"],
		queryFn: () =>
			workspaceUid && kbUid ? api.listKbDocuments(workspaceUid, kbUid) : [],
		enabled: Boolean(workspaceUid && kbUid),
	});
}

/**
 * Lists chunks under a KB document. Disabled until all three UIDs
 * are defined so consumers can pass `undefined`s while the parent
 * dialog is closed.
 */
export function useDocumentChunks(
	workspaceUid: string | undefined,
	kbUid: string | undefined,
	documentUid: string | undefined,
	opts?: { enabled?: boolean; limit?: number },
): UseQueryResult<DocumentChunk[], Error> {
	const enabled =
		Boolean(workspaceUid && kbUid && documentUid) && (opts?.enabled ?? true);
	return useQuery({
		queryKey:
			workspaceUid && kbUid && documentUid
				? keys.chunks(workspaceUid, kbUid, documentUid)
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
			workspaceUid && kbUid && documentUid
				? api.listKbDocumentChunks(workspaceUid, kbUid, documentUid, {
						limit: opts?.limit ?? 1000,
					})
				: [],
		enabled,
	});
}

export function documentQueryKey(workspaceUid: string, kbUid: string) {
	return keys.all(workspaceUid, kbUid);
}

/**
 * Deletes a document from a KB. The runtime cascades to wipe the
 * document's chunks from the KB's vector collection too, so a
 * successful delete leaves no traces in KB-scoped search.
 */
export function useDeleteDocument(
	workspaceUid: string,
	kbUid: string,
): UseMutationResult<void, Error, string> {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: (documentUid) =>
			api.deleteKbDocument(workspaceUid, kbUid, documentUid),
		onSuccess: (_void, documentUid) => {
			qc.invalidateQueries({ queryKey: keys.all(workspaceUid, kbUid) });
			qc.invalidateQueries({
				queryKey: keys.chunks(workspaceUid, kbUid, documentUid),
			});
		},
	});
}
