import { type UseQueryResult, useQuery } from "@tanstack/react-query";
import {
	type AuthConfig,
	fetchAuthConfig,
	fetchSessionSubject,
	type SessionSubject,
} from "@/lib/session";

/**
 * Auth config from `/auth/config`. Tells the UI which credential
 * surfaces to render. Loaded once; stale-while-revalidate on focus
 * is fine but not needed.
 */
export function useAuthConfig(): UseQueryResult<AuthConfig | null, Error> {
	return useQuery({
		queryKey: ["auth", "config"],
		queryFn: fetchAuthConfig,
		staleTime: Number.POSITIVE_INFINITY,
		retry: false,
	});
}

/**
 * The current logged-in subject, or `null` if unauthenticated.
 *
 * Gated on the auth config's `modes.login` — when the runtime
 * isn't running the OIDC browser-login flow, the `/auth/me` route
 * isn't mounted and would 404. Firing it anyway paints a
 * `Failed to load resource` line in the console on every page
 * load, which users reasonably read as \"something is broken\".
 */
export function useSession(): UseQueryResult<SessionSubject | null, Error> {
	const cfg = useAuthConfig();
	const loginAvailable = cfg.data?.modes.login === true;
	return useQuery({
		queryKey: ["auth", "me"],
		queryFn: fetchSessionSubject,
		staleTime: 30_000,
		retry: false,
		enabled: loginAvailable,
	});
}
