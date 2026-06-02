/**
 * Client-side "view as principal" selection (RLAC).
 *
 * When a workspace runs with auth disabled (the local / quickstart
 * posture), the backend has no token to derive a principal from, so the
 * SPA is the only thing that can say *which* principal a request acts
 * as — via the `x-view-as-principal` header that
 * `runtimes/typescript/src/auth/principal-resolver.ts` honors when the
 * auth subject is null. Without it, every read against an RLAC-enabled
 * KB fails with `policy_principal_required`. This module holds that
 * per-workspace selection so the API client can attach the header.
 *
 * The default is the bootstrap-created `admin` principal (universal
 * read), so RLAC stays transparent — you see every document — until you
 * deliberately impersonate someone. "admin / default" is modeled as the
 * *absence* of an entry: selecting it clears the workspace's key.
 *
 * Mirrors {@link ../lib/authToken}: `localStorage`-backed, a tiny
 * subscribe API, cross-tab via the `storage` event and same-tab via a
 * `CustomEvent`. localStorage is acceptable here for the same reason as
 * the auth token — the trust boundary is the runtime's own deployment.
 */

const STORAGE_KEY = "wb_view_as";
const CHANGE_EVENT = "wb:view-as-change";

/** The principal every workspace views as until told otherwise. */
export const DEFAULT_VIEW_AS_PRINCIPAL = "admin";

type Listener = () => void;
const listeners = new Set<Listener>();

type ViewAsMap = Record<string, string>;

function readMap(): ViewAsMap {
	if (typeof window === "undefined") return {};
	try {
		const raw = window.localStorage.getItem(STORAGE_KEY);
		if (!raw) return {};
		const parsed: unknown = JSON.parse(raw);
		if (!parsed || typeof parsed !== "object") return {};
		// Defensive: only keep string→string entries. A corrupt / hand-edited
		// blob shouldn't crash the request path.
		const out: ViewAsMap = {};
		for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
			if (typeof v === "string" && v.length > 0) out[k] = v;
		}
		return out;
	} catch {
		return {}; // private mode / disabled storage / malformed JSON
	}
}

function writeMap(map: ViewAsMap): void {
	if (typeof window === "undefined") return;
	try {
		if (Object.keys(map).length > 0) {
			window.localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
		} else {
			window.localStorage.removeItem(STORAGE_KEY);
		}
	} catch {
		// storage denied — broadcast anyway so this tab stays consistent.
	}
	for (const fn of listeners) fn();
	try {
		window.dispatchEvent(new CustomEvent(CHANGE_EVENT));
	} catch {
		// ignore in non-DOM environments
	}
}

/**
 * The *explicit* view-as selection for a workspace, or `null` when none
 * is set (meaning the {@link DEFAULT_VIEW_AS_PRINCIPAL} default applies).
 * Callers that need the effective id should treat `null` as admin.
 */
export function getViewAs(workspaceId: string): string | null {
	return readMap()[workspaceId] ?? null;
}

/**
 * Set (or clear) the view-as principal for a workspace. Passing `null`
 * or the default `admin` clears the entry — the default is the absence
 * of a selection, never a stored value.
 */
export function setViewAs(
	workspaceId: string,
	principalId: string | null,
): void {
	const map = { ...readMap() };
	if (principalId && principalId !== DEFAULT_VIEW_AS_PRINCIPAL) {
		map[workspaceId] = principalId;
	} else {
		delete map[workspaceId];
	}
	writeMap(map);
}

/** Subscribe to view-as changes. Returns an unsubscribe fn. */
export function subscribe(fn: Listener): () => void {
	listeners.add(fn);
	const onStorage = (e: StorageEvent) => {
		if (e.key === STORAGE_KEY) fn();
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
 * Resolve the `x-view-as-principal` header value for an outbound request
 * path, or `null` when none should be sent.
 *
 * Rules, by design (see the module header):
 *   - Only workspace-scoped paths (`/workspaces/:id/…`) carry a
 *     principal; everything else returns `null`.
 *   - An explicit selection always wins, token or not (so dev-mode and
 *     bootstrap operators can impersonate).
 *   - With no explicit selection, the default `admin` is sent *only when
 *     there is no bearer token* — i.e. the auth-disabled posture where
 *     the header is the sole identity signal. When a token is present the
 *     backend derives the principal from it, so we stay out of the way.
 */
export function viewAsHeaderValue(
	path: string,
	hasToken: boolean,
): string | null {
	const match = /^\/workspaces\/([^/?#]+)/.exec(path);
	const workspaceId = match?.[1];
	if (!workspaceId || workspaceId === "_") return null;
	const explicit = getViewAs(workspaceId);
	if (explicit) return explicit;
	return hasToken ? null : DEFAULT_VIEW_AS_PRINCIPAL;
}
