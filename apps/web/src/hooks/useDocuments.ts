import {
	type UseMutationResult,
	type UseQueryResult,
	useMutation,
	useQuery,
	useQueryClient,
} from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { DocumentChunk, DocumentRecord } from "@/lib/schemas";

const keys = {
	all: (workspace: string, catalogId: string) =>
		["workspaces", workspace, "catalogs", catalogId, "documents"] as const,
	chunks: (workspace: string, catalogId: string, documentId: string) =>
		[
			"workspaces",
			workspace,
			"catalogs",
			catalogId,
			"documents",
			documentId,
			"chunks",
		] as const,
};

export function useDocuments(
	workspace: string | undefined,
	catalogId: string | undefined,
): UseQueryResult<DocumentRecord[], Error> {
	return useQuery({
		queryKey:
			workspace && catalogId
				? keys.all(workspace, catalogId)
				: ["workspaces", "_", "catalogs", "_", "documents"],
		queryFn: () =>
			workspace && catalogId ? api.listDocuments(workspace, catalogId) : [],
		enabled: Boolean(workspace && catalogId),
	});
}

/**
 * Lists chunks under a document. Disabled until all three ids are
 * defined, so consumers can pass `undefined`s while the parent
 * dialog is closed without firing requests for non-rows.
 */
export function useDocumentChunks(
	workspace: string | undefined,
	catalogId: string | undefined,
	documentId: string | undefined,
	opts?: { enabled?: boolean; limit?: number },
): UseQueryResult<DocumentChunk[], Error> {
	const enabled =
		Boolean(workspace && catalogId && documentId) && (opts?.enabled ?? true);
	return useQuery({
		queryKey:
			workspace && catalogId && documentId
				? keys.chunks(workspace, catalogId, documentId)
				: ["workspaces", "_", "catalogs", "_", "documents", "_", "chunks"],
		queryFn: () =>
			workspace && catalogId && documentId
				? api.listDocumentChunks(workspace, catalogId, documentId, {
						limit: opts?.limit ?? 1000,
					})
				: [],
		enabled,
	});
}

export function documentQueryKey(workspace: string, catalogId: string) {
	return keys.all(workspace, catalogId);
}

/**
 * Deletes a document from a catalog. The runtime cascades to wipe
 * the document's chunks from the bound vector store too, so a
 * successful delete leaves no traces in catalog-scoped search.
 *
 * Mutation argument is the documentUid; we close over workspace +
 * catalogId so each call site doesn't have to thread them through
 * the mutation surface. On success both the documents list and the
 * deleted document's chunks query are invalidated — the explorer
 * table updates immediately and any open detail dialog renders the
 * empty state.
 */
export function useDeleteDocument(
	workspace: string,
	catalogId: string,
): UseMutationResult<void, Error, string> {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: (documentId) =>
			api.deleteDocument(workspace, catalogId, documentId),
		onSuccess: (_void, documentId) => {
			qc.invalidateQueries({ queryKey: keys.all(workspace, catalogId) });
			qc.invalidateQueries({
				queryKey: keys.chunks(workspace, catalogId, documentId),
			});
		},
	});
}
