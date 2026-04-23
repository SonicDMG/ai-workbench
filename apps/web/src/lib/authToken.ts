/**
 * Client-side auth-token storage.
 *
 * Persists a single bearer token in `localStorage` so a reload
 * doesn't lose it, exposes a tiny subscribe API so the UI can
 * react when it changes, and hands the value to the API client
 * on every outbound request.
 *
 * Scope is intentionally small — this is Phase 2 auth; the
 * Phase 3 OIDC flow will replace the manual-paste model with a
 * proper login flow and an in-memory / httpOnly-cookie-backed
 * access token. Keeping the storage layer behind this module
 * means the migration is local.
 *
 * XSS note: localStorage is readable by any JS on the page.
 * Acceptable for the self-hosted workbench UI (trust boundary
 * == the runtime's own deployment) but not for anything that
 * embeds third-party scripts. Call out in the README.
 */

const STORAGE_KEY = "wb_auth_token";
const CHANGE_EVENT = "wb:auth-token-change";

type Listener = (token: string | null) => void;
const listeners = new Set<Listener>();

function readRaw(): string | null {
	if (typeof window === "undefined") return null;
	try {
		const value = window.localStorage.getItem(STORAGE_KEY);
		return value && value.length > 0 ? value : null;
	} catch {
		return null; // private mode / storage disabled
	}
}

export function getAuthToken(): string | null {
	return readRaw();
}

export function setAuthToken(value: string | null): void {
	if (typeof window === "undefined") return;
	try {
		if (value && value.length > 0) {
			window.localStorage.setItem(STORAGE_KEY, value);
		} else {
			window.localStorage.removeItem(STORAGE_KEY);
		}
	} catch {
		// storage denied — fall through to broadcast anyway so UI stays
		// consistent for this tab.
	}
	const payload = value && value.length > 0 ? value : null;
	for (const fn of listeners) fn(payload);
	// Also broadcast so a second tab picks up clears. `storage` fires
	// across tabs; `CustomEvent` catches same-tab subscribers that
	// can't see `storage`.
	try {
		window.dispatchEvent(
			new CustomEvent<string | null>(CHANGE_EVENT, { detail: payload }),
		);
	} catch {
		// ignore in non-DOM environments
	}
}

/** Subscribe to token changes. Returns an unsubscribe fn. */
export function subscribe(fn: Listener): () => void {
	listeners.add(fn);
	const onStorage = (e: StorageEvent) => {
		if (e.key === STORAGE_KEY) fn(readRaw());
	};
	if (typeof window !== "undefined") {
		window.addEventListener("storage", onStorage);
	}
	return () => {
		listeners.delete(fn);
		if (typeof window !== "undefined") {
			window.removeEventListener("storage", onStorage);
		}
	};
}

/**
 * Display-only preview of a token. Shows the `wb_live_<prefix>_…`
 * portion without the secret half — matches what the server stores
 * and what the UI's API-key table displays.
 */
export function previewToken(token: string | null): string {
	if (!token) return "No token";
	const m = /^(wb_live_[a-z0-9]{12})_/.exec(token);
	return m ? `${m[1] as string}_…` : `${token.slice(0, 16)}…`;
}
