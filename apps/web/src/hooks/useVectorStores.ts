import { type UseQueryResult, useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { VectorStoreRecord } from "@/lib/schemas";

const keys = {
	all: (workspace: string) =>
		["workspaces", workspace, "vector-stores"] as const,
};

export function useVectorStores(
	workspace: string | undefined,
): UseQueryResult<VectorStoreRecord[], Error> {
	return useQuery({
		queryKey: workspace
			? keys.all(workspace)
			: ["workspaces", "_", "vector-stores"],
		queryFn: () => api.listVectorStores(workspace!),
		enabled: Boolean(workspace),
	});
}
