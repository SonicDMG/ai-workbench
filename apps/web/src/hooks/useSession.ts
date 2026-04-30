import {
	type UseQueryResult,
	useQuery,
	useQueryClient,
} from "@tanstack/react-query";
import { useEffect } from "react";
import {
	type AuthConfig,
	fetchAuthConfig,
	fetchSessionSubject,
	refreshSession,
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
 * load, which users reasonably read as "something is broken".
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

/**
 * Phase 3c — proactive silent refresh.
 *
 * Schedules a single timeout that fires roughly 80% of the way
 * through the access-token's lifetime (with a 30s floor + ceiling
 * clamp). When it fires, calls /auth/refresh; on success we
 * invalidate the session query so the UI gets the new `expiresAt`
 * and the next refresh schedules itself.
 *
 * No-op when:
 * - The runtime doesn't expose a refreshPath (no OIDC, no login).
 * - The session cookie can't be refreshed (`canRefresh: false` —
 *   e.g. the IdP didn't issue a refresh_token).
 * - The session subject is opaque (`expiresAt: null`).
 *
 * Reactive 401-driven refresh is wired into lib/api.ts as the
 * fallback; this hook just keeps the cookie ahead of the curve so
 * users don't see a one-request blip mid-flow.
 */
export function useSilentRefresh(): void {
	const cfg = useAuthConfig();
	const session = useSession();
	const qc = useQueryClient();
	const refreshPath = cfg.data?.refreshPath ?? null;
	const expiresAt = session.data?.expiresAt ?? null;
	const canRefresh = session.data?.canRefresh ?? false;

	useEffect(() => {
		if (!refreshPath || !canRefresh || expiresAt === null) return;
		const nowSeconds = Math.floor(Date.now() / 1000);
		const remaining = expiresAt - nowSeconds;
		if (remaining <= 0) return;
		// Refresh at 80% of the remaining lifetime, clamped to the
		// [30s, 30min] window so very short tokens don't spin and very
		// long tokens still get refreshed during a single browser
		// session.
		const targetSeconds = Math.min(
			Math.max(Math.floor(remaining * 0.8), 30),
			30 * 60,
		);
		const handle = window.setTimeout(() => {
			// `setTimeout` doesn't await its callback, so an `async`
			// callback's rejection would otherwise be swallowed silently.
			// Wrap with an explicit `.catch` and invalidate the session
			// query on failure so the next render falls through to the
			// 401-driven reactive refresh path in `lib/api.ts`.
			void (async () => {
				try {
					const result = await refreshSession(refreshPath);
					if (result !== null) {
						// Bump /auth/me so the next render sees the new expiry
						// and schedules the next refresh.
						await qc.invalidateQueries({ queryKey: ["auth", "me"] });
					}
				} catch {
					await qc.invalidateQueries({ queryKey: ["auth", "me"] });
				}
			})();
		}, targetSeconds * 1000);
		return () => window.clearTimeout(handle);
	}, [refreshPath, canRefresh, expiresAt, qc]);
}
