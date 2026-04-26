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
	all: (workspaceUid: string, catalogUid: string) =>
		["workspaces", workspaceUid, "catalogs", catalogUid, "documents"] as const,
	chunks: (workspaceUid: string, catalogUid: string, documentUid: string) =>
		[
			"workspaces",
			workspaceUid,
			"catalogs",
			catalogUid,
			"documents",
			documentUid,
			"chunks",
		] as const,
};

export function useDocuments(
	workspaceUid: string | undefined,
	catalogUid: string | undefined,
): UseQueryResult<DocumentRecord[], Error> {
	return useQuery({
		queryKey:
			workspaceUid && catalogUid
				? keys.all(workspaceUid, catalogUid)
				: ["workspaces", "_", "catalogs", "_", "documents"],
		queryFn: () =>
			workspaceUid && catalogUid
				? api.listDocuments(workspaceUid, catalogUid)
				: [],
		enabled: Boolean(workspaceUid && catalogUid),
	});
}

/**
 * Lists chunks under a document. Disabled until all three UIDs are
 * defined, so consumers can pass `undefined`s while the parent
 * dialog is closed without firing requests for non-rows.
 */
export function useDocumentChunks(
	workspaceUid: string | undefined,
	catalogUid: string | undefined,
	documentUid: string | undefined,
	opts?: { enabled?: boolean; limit?: number },
): UseQueryResult<DocumentChunk[], Error> {
	const enabled =
		Boolean(workspaceUid && catalogUid && documentUid) &&
		(opts?.enabled ?? true);
	return useQuery({
		queryKey:
			workspaceUid && catalogUid && documentUid
				? keys.chunks(workspaceUid, catalogUid, documentUid)
				: ["workspaces", "_", "catalogs", "_", "documents", "_", "chunks"],
		queryFn: () =>
			workspaceUid && catalogUid && documentUid
				? api.listDocumentChunks(workspaceUid, catalogUid, documentUid, {
						limit: opts?.limit ?? 1000,
					})
				: [],
		enabled,
	});
}

export function documentQueryKey(workspaceUid: string, catalogUid: string) {
	return keys.all(workspaceUid, catalogUid);
}

/**
 * Deletes a document from a catalog. The runtime cascades to wipe
 * the document's chunks from the bound vector store too, so a
 * successful delete leaves no traces in catalog-scoped search.
 *
 * Mutation argument is the documentUid; we close over workspaceUid +
 * catalogUid so each call site doesn't have to thread them through
 * the mutation surface. On success both the documents list and the
 * deleted document's chunks query are invalidated — the explorer
 * table updates immediately and any open detail dialog renders the
 * empty state.
 */
export function useDeleteDocument(
	workspaceUid: string,
	catalogUid: string,
): UseMutationResult<void, Error, string> {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: (documentUid) =>
			api.deleteDocument(workspaceUid, catalogUid, documentUid),
		onSuccess: (_void, documentUid) => {
			qc.invalidateQueries({ queryKey: keys.all(workspaceUid, catalogUid) });
			qc.invalidateQueries({
				queryKey: keys.chunks(workspaceUid, catalogUid, documentUid),
			});
		},
	});
}
