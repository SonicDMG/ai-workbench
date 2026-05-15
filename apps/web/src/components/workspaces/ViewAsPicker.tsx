import { useQueryClient } from "@tanstack/react-query";
import { Eye } from "lucide-react";
import { useEffect, useState } from "react";
import { usePrincipals } from "@/hooks/useRlac";
import {
	getViewAsPrincipal,
	setActiveWorkspaceId,
	setViewAsPrincipal,
	subscribeViewAs,
} from "@/lib/viewAs";

/**
 * Dev-mode "view as" picker.
 *
 * Sits in the workspace header on RLAC-enabled views. Selecting a
 * principal sets the `x-view-as-principal` request header for every
 * subsequent API call — the backend honors it in dev mode and for
 * bootstrap operators. The selection is workspace-scoped and persists
 * in localStorage so reloads keep the demo state.
 *
 * On change, the picker invalidates every workspace-scoped TanStack
 * Query so the UI refreshes through the new principal's lens
 * (different document lists, different audit decisions, etc.).
 */
export function ViewAsPicker({ workspace }: { workspace: string }) {
	const principals = usePrincipals(workspace);
	const qc = useQueryClient();
	const [current, setCurrent] = useState<string | null>(() =>
		getViewAsPrincipal(),
	);

	useEffect(() => {
		setActiveWorkspaceId(workspace);
		setCurrent(getViewAsPrincipal());
		return () => {
			setActiveWorkspaceId(null);
		};
	}, [workspace]);

	useEffect(() => {
		const unsubscribe = subscribeViewAs((principal) => setCurrent(principal));
		return unsubscribe;
	}, []);

	const rows = principals.data ?? [];

	// When the picker mounts on a workspace where the user hasn't
	// picked a principal yet, default to the first one in the
	// alphabetically-sorted list. Keeps the select element's visible
	// value in sync with the stored value — the alternative is the
	// browser showing the first <option> while the backend still
	// thinks no principal is in play, which trips
	// `policy_principal_required` on every fetch.
	useEffect(() => {
		if (rows.length === 0) return;
		if (current !== null) return;
		const first = rows[0];
		if (!first) return;
		setViewAsPrincipal(first.principalId);
		qc.invalidateQueries({ queryKey: ["workspaces", workspace] });
	}, [rows, current, workspace, qc]);

	function onChange(value: string) {
		setViewAsPrincipal(value);
		// Invalidate workspace-scoped caches so the UI re-fetches
		// everything through the new principal's lens.
		qc.invalidateQueries({ queryKey: ["workspaces", workspace] });
	}

	if (rows.length === 0) return null;

	return (
		<div className="inline-flex items-center gap-2 rounded-full border border-amber-300 bg-amber-50 px-3 py-1 text-amber-900 text-xs dark:border-amber-700 dark:bg-amber-900/30 dark:text-amber-100">
			<Eye className="h-3.5 w-3.5" />
			<span className="font-medium">View as</span>
			<select
				value={current ?? rows[0]?.principalId ?? ""}
				onChange={(e) => onChange(e.target.value)}
				className="rounded border border-amber-300 bg-white px-1.5 py-0.5 font-mono text-[11px] text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100"
				aria-label="View as principal"
			>
				{rows.map((p) => (
					<option key={p.principalId} value={p.principalId}>
						{p.label ? `${p.label} (${p.principalId})` : p.principalId}
					</option>
				))}
			</select>
		</div>
	);
}
