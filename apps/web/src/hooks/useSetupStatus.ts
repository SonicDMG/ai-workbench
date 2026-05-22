/**
 * `useSetupStatus` — react-query wrapper around `GET /setup-status`.
 *
 * The onboarding wizard uses this on first render to decide whether
 * to show the credentials step (skip when `hasAstraCreds` is true,
 * or when the managed env file is not writable — both of those mean
 * the wizard can't help the user beyond what they've already set up
 * via shell env vars or a bind-mounted file).
 *
 * Returns `null` when the runtime predates the endpoint so the
 * wizard degrades gracefully on old builds: the credentials step is
 * simply skipped.
 */
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { SetupStatus } from "@/lib/schemas";

export function useSetupStatus() {
	return useQuery<SetupStatus | null>({
		queryKey: ["setup-status"],
		queryFn: () => api.getSetupStatus(),
		staleTime: 30_000,
	});
}
