import { type UseQueryResult, useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { DocumentRecord } from "@/lib/schemas";

const keys = {
	all: (workspace: string, catalogId: string) =>
		["workspaces", workspace, "catalogs", catalogId, "documents"] as const,
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

export function documentQueryKey(workspace: string, catalogId: string) {
	return keys.all(workspace, catalogId);
}
