import { type UseQueryResult, useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { AstraCliInfo } from "@/lib/schemas";

const QUERY_KEY = ["astra-cli", "info"] as const;

/**
 * Fetches the runtime's `astra-cli` auto-detection status.
 *
 * Returns `null` if the endpoint isn't reachable (older runtimes,
 * network blip) — the UI must treat absence as "no detection" and
 * render its non-detected fallback rather than blocking on an error.
 *
 * Cached forever within a session: detection runs once at startup
 * and the answer doesn't change without a runtime restart.
 */
export function useAstraCliInfo(): UseQueryResult<AstraCliInfo | null, Error> {
	return useQuery({
		queryKey: QUERY_KEY,
		queryFn: api.getAstraCliInfo,
		staleTime: Number.POSITIVE_INFINITY,
		gcTime: Number.POSITIVE_INFINITY,
		retry: false,
	});
}
