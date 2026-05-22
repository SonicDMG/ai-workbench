/**
 * react-query wrappers for the deep-health endpoints
 * (`GET /health/details`, `GET /health/recent-errors`) used by the
 * `/status` page. Both poll every 10 seconds so a stuck install
 * surfaces quickly without overwhelming the runtime.
 */
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { HealthDetails, RecentErrorsResponse } from "@/lib/schemas";

const REFETCH_INTERVAL_MS = 10_000;

export function useHealthDetails() {
	return useQuery<HealthDetails | null>({
		queryKey: ["health-details"],
		queryFn: () => api.getHealthDetails(),
		refetchInterval: REFETCH_INTERVAL_MS,
		refetchIntervalInBackground: true,
		staleTime: REFETCH_INTERVAL_MS / 2,
	});
}

export function useRecentErrors() {
	return useQuery<RecentErrorsResponse | null>({
		queryKey: ["recent-errors"],
		queryFn: () => api.getRecentErrors(),
		refetchInterval: REFETCH_INTERVAL_MS,
		refetchIntervalInBackground: true,
		staleTime: REFETCH_INTERVAL_MS / 2,
	});
}
