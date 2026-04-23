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
	readonly type: "apiKey" | "oidc";
	readonly workspaceScopes: readonly string[] | null;
}

export interface AuthConfig {
	readonly modes: {
		readonly apiKey: boolean;
		readonly oidc: boolean;
		readonly login: boolean;
	};
	readonly loginPath: string | null;
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
