import { type UseQueryResult, useQuery } from "@tanstack/react-query";
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
