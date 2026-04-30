import { type UseQueryResult, useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { Features } from "@/lib/schemas";

const QUERY_KEY = ["runtime", "features"] as const;

/**
 * Fetches the runtime's feature-flag snapshot. Cached forever within
 * a session — flags are driven by `workbench.yaml` and only change on
 * runtime restart, so retrying or re-fetching is wasted work. The API
 * client falls back to all-disabled on network errors so older
 * runtimes without `/features` keep rendering correctly.
 */
export function useFeatures(): UseQueryResult<Features, Error> {
	return useQuery({
		queryKey: QUERY_KEY,
		queryFn: api.getFeatures,
		staleTime: Number.POSITIVE_INFINITY,
		gcTime: Number.POSITIVE_INFINITY,
		retry: false,
	});
}
