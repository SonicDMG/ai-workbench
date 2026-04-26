/**
 * Session-aware fetch helpers.
 *
 * All /auth/* calls go through here so they: (1) ride the session
 * cookie (`credentials: "include"`), (2) never attach a bearer
 * token — paste-a-token is explicitly NOT the same credential as
 * the browser session, and (3) decode the canonical error envelope
 * exactly like lib/api.ts does.
 */

export interface SessionSubject {
	readonly id: string;
	readonly label: string | null;
	readonly type: "apiKey" | "oidc" | "bootstrap";
	readonly workspaceScopes: readonly string[] | null;
	/** Unix seconds when the access token expires, or null when the
	 * token is opaque (no JWT exp claim). Used to schedule silent
	 * refresh before the runtime starts rejecting requests. */
	readonly expiresAt: number | null;
	/** True when the session cookie carries a usable refresh_token —
	 * the UI then schedules a refresh ahead of expiry and attempts
	 * one on a 401 before redirecting to login. */
	readonly canRefresh: boolean;
}

export interface AuthConfig {
	readonly modes: {
		readonly apiKey: boolean;
		readonly oidc: boolean;
		readonly login: boolean;
	};
	readonly loginPath: string | null;
	readonly refreshPath: string | null;
}

async function getJson<T>(path: string): Promise<T | null> {
	const res = await fetch(path, {
		method: "GET",
		credentials: "include",
		headers: { accept: "application/json" },
	});
	if (res.status === 401 || res.status === 404) return null;
	if (!res.ok) throw new Error(`${path} → ${res.status}`);
	return (await res.json()) as T;
}

export function fetchAuthConfig(): Promise<AuthConfig | null> {
	return getJson<AuthConfig>("/auth/config");
}

export function fetchSessionSubject(): Promise<SessionSubject | null> {
	return getJson<SessionSubject>("/auth/me");
}

export interface RefreshResult {
	readonly ok: true;
	readonly expiresAt: number | null;
}

/**
 * Attempt a silent token refresh. Returns the new expiry on success,
 * `null` on any failure (no cookie, IdP rejected, network blip).
 * Callers treat `null` as "fall back to the login redirect."
 */
export async function refreshSession(
	refreshPath: string,
): Promise<RefreshResult | null> {
	try {
		const res = await fetch(refreshPath, {
			method: "POST",
			credentials: "include",
			headers: { accept: "application/json" },
		});
		if (!res.ok) return null;
		const body = (await res.json()) as {
			ok?: boolean;
			expiresAt?: number | null;
		};
		if (!body.ok) return null;
		return { ok: true, expiresAt: body.expiresAt ?? null };
	} catch {
		return null;
	}
}

export async function logout(): Promise<void> {
	await fetch("/auth/logout", {
		method: "POST",
		credentials: "include",
		headers: { accept: "application/json" },
	});
}

/**
 * Build the absolute login URL the browser should navigate to.
 * `redirect_after` is sent so the runtime can bring the user back
 * where they started.
 */
export function loginHref(loginPath: string, redirectAfter: string): string {
	const url = new URL(loginPath, window.location.origin);
	url.searchParams.set("redirect_after", redirectAfter);
	return url.toString();
}
