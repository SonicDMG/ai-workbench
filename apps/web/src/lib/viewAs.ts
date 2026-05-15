/**
 * Client-side "view as" principal — the dev-mode override that lets a
 * single browser session impersonate different RLAC principals.
 *
 * The API client serializes the current value as `x-view-as-principal`
 * on every outbound request. The backend honors the header when
 * `WB_DEV_MODE=1` (or the caller is a bootstrap operator); otherwise
 * it falls back to the natural principal-resolution chain. See
 * `runtimes/typescript/src/auth/principal-resolver.ts`.
 *
 * The chosen principal is per-workspace so flipping workspaces in the
 * SPA doesn't accidentally drag an out-of-scope principal across.
 * Keyed in `localStorage` so reloads keep the demo state.
 */

const STORAGE_KEY = "wb_view_as_principal";
const CHANGE_EVENT = "wb:view-as-change";

type Listener = (principal: string | null) => void;
const listeners = new Set<Listener>();

function readMap(): Record<string, string> {
	if (typeof window === "undefined") return {};
	try {
		const raw = window.localStorage.getItem(STORAGE_KEY);
		if (!raw) return {};
		const parsed: unknown = JSON.parse(raw);
		if (typeof parsed === "object" && parsed !== null) {
			return parsed as Record<string, string>;
		}
		return {};
	} catch {
		return {};
	}
}

function writeMap(value: Record<string, string>): void {
	if (typeof window === "undefined") return;
	try {
		window.localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
	} catch {
		// storage denied; silently fall through.
	}
}

let activeWorkspaceId: string | null = null;

/**
 * Set which workspace the picker should target. Called by route
 * components when they mount, so the global view-as state always
 * reflects the workspace currently in view.
 */
export function setActiveWorkspaceId(workspaceId: string | null): void {
	activeWorkspaceId = workspaceId;
	const current = getViewAsPrincipal();
	for (const fn of listeners) fn(current);
}

export function getActiveWorkspaceId(): string | null {
	return activeWorkspaceId;
}

export function getViewAsPrincipal(): string | null {
	if (!activeWorkspaceId) return null;
	const map = readMap();
	return map[activeWorkspaceId] ?? null;
}

/**
 * Lookup the view-as principal for an explicit workspace id, without
 * touching the React-side "active workspace" state.
 *
 * The API client uses this on every request so the right header
 * goes out the first time the page loads — independent of when
 * the {@link ViewAsPicker} component happens to mount. Returns
 * `null` for paths that aren't workspace-scoped.
 */
export function getViewAsPrincipalForWorkspace(
	workspaceId: string | null,
): string | null {
	if (!workspaceId) return null;
	const map = readMap();
	return map[workspaceId] ?? null;
}

/**
 * Extract the workspace id from an API path. Returns `null` for
 * non-workspace-scoped paths (e.g. `/api/v1/health`).
 */
export function workspaceIdFromApiPath(path: string): string | null {
	// Match either an absolute `/api/v1/workspaces/<id>` or the
	// relative form the API client uses (`/workspaces/<id>`).
	const match = path.match(/(?:^|\/)workspaces\/([^/?#]+)/);
	return match?.[1] ?? null;
}

export function setViewAsPrincipal(value: string | null): void {
	if (!activeWorkspaceId) return;
	const map = readMap();
	if (value === null || value.length === 0) {
		delete map[activeWorkspaceId];
	} else {
		map[activeWorkspaceId] = value;
	}
	writeMap(map);
	for (const fn of listeners) fn(value);
	if (typeof window !== "undefined") {
		try {
			window.dispatchEvent(
				new CustomEvent<string | null>(CHANGE_EVENT, { detail: value }),
			);
		} catch {
			// non-DOM env — ignore
		}
	}
}

export function subscribeViewAs(fn: Listener): () => void {
	listeners.add(fn);
	return () => {
		listeners.delete(fn);
	};
}
