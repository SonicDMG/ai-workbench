import { type UseQueryResult, useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { AstraCliInventory } from "@/lib/schemas";

const QUERY_KEY = ["astra-cli", "inventory"] as const;

/**
 * Fetches the full astra-cli inventory: every configured profile +
 * the databases each can see, token-redacted. Drives the workspace
 * onboarding picker.
 *
 * Returns `null` if the endpoint isn't reachable (older runtimes,
 * network blip) — the UI must treat absence as "no picker" and
 * render its existing detection-card fallback rather than blocking
 * on an error.
 *
 * Cached for the session: profiles change rarely and the user is
 * unlikely to add a new database while filling out the onboarding
 * form. A fresh page load re-fetches.
 */
export function useAstraCliInventory(): UseQueryResult<
	AstraCliInventory | null,
	Error
> {
	return useQuery({
		queryKey: QUERY_KEY,
		queryFn: api.getAstraCliInventory,
		staleTime: Number.POSITIVE_INFINITY,
		gcTime: Number.POSITIVE_INFINITY,
		retry: false,
	});
}
