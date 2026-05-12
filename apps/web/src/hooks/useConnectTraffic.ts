import { type UseQueryResult, useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { ConnectTrafficResponse } from "@/lib/schemas";

/**
 * Default polling cadence for the Connect tab's "Recent integration
 * traffic" strip. Five seconds feels live without thrashing the
 * runtime when the page is open for a long demo.
 */
const POLL_INTERVAL_MS = 5_000;

/**
 * Default page size. The strip only shows ~10 entries inline, but we
 * pull a few extra so the count badge ("seen 12 calls this session")
 * has something to work with without a second request.
 */
const DEFAULT_LIMIT = 25;

/**
 * Poll `GET /api/v1/workspaces/{w}/connect/traffic` for the recent-
 * MCP-invocation feed. Modeled as a polling query (not SSE) because:
 *
 *   - The buffer is in-memory and lossy by design — eventual
 *     consistency from a 5s poll is fine; no one is making decisions
 *     off this stream.
 *   - SSE adds a second long-lived connection per open tab; the
 *     overhead isn't worth the freshness gain for a v0 demo strip.
 *
 * The query is keyed only by `workspaceId` so the cache survives
 * unrelated state changes (tab switches, scope picker flips) — the
 * strip pulses continuously while the page is open.
 */
export function useConnectTraffic(
	workspaceId: string | undefined,
	opts: { limit?: number; enabled?: boolean } = {},
): UseQueryResult<ConnectTrafficResponse, Error> {
	const limit = opts.limit ?? DEFAULT_LIMIT;
	const enabled = (opts.enabled ?? true) && Boolean(workspaceId);
	return useQuery({
		queryKey: workspaceId
			? ["workspaces", workspaceId, "connect", "traffic", limit]
			: ["workspaces", "_", "connect", "traffic"],
		queryFn: () => {
			if (!workspaceId) {
				throw new Error("useConnectTraffic requires a workspaceId");
			}
			return api.getConnectTraffic(workspaceId, { limit });
		},
		enabled,
		// Refetch on a fixed cadence, AND when the tab regains focus —
		// makes the strip feel alive in a demo where the user just
		// switched away to run a notebook cell.
		refetchInterval: POLL_INTERVAL_MS,
		refetchOnWindowFocus: true,
		// 1s stale so a focus event right after a poll returns the
		// cached result instantly, then refreshes in the background.
		staleTime: 1_000,
	});
}
