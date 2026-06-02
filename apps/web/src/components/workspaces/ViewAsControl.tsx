import * as SelectPrimitive from "@radix-ui/react-select";
import { useQueryClient } from "@tanstack/react-query";
import { UserCog } from "lucide-react";
import { useSyncExternalStore } from "react";
import {
	SelectContent,
	SelectGroup,
	SelectItem,
	SelectLabel,
} from "@/components/ui/select";
import { usePrincipals } from "@/hooks/useRlac";
import { getAuthToken } from "@/lib/authToken";
import { keys } from "@/lib/query";
import { cn } from "@/lib/utils";
import {
	DEFAULT_VIEW_AS_PRINCIPAL,
	getViewAs,
	setViewAs,
	subscribe,
} from "@/lib/viewAs";

/**
 * Discreet "view as principal" affordance for RLAC.
 *
 * A single icon button that lives in a page's action row. It only
 * renders in the posture where the `x-view-as-principal` header is the
 * request's identity — RLAC enabled *and* no bearer token (the
 * auth-disabled / local quickstart). In token deployments the backend
 * derives the principal from the token and ignores the header, so the
 * control would be misleading and stays hidden.
 *
 * Defaults to the bootstrap `admin` principal (sees every document), so
 * the common case is a quiet, muted icon. Picking a different principal
 * turns it into an amber chip naming who you're impersonating — a
 * standing reminder that the document list is now filtered. Switching
 * invalidates the workspace's queries so tables refetch under the new
 * identity.
 */
export function ViewAsControl({
	workspaceId,
	rlacEnabled,
}: {
	workspaceId: string;
	rlacEnabled: boolean;
}) {
	const qc = useQueryClient();
	const current = useSyncExternalStore(
		subscribe,
		() => getViewAs(workspaceId) ?? DEFAULT_VIEW_AS_PRINCIPAL,
		() => DEFAULT_VIEW_AS_PRINCIPAL,
	);
	const hasToken = Boolean(getAuthToken());

	// Only fetch principals when the control is actually shown.
	const active = rlacEnabled && !hasToken;
	const principals = usePrincipals(workspaceId, active);

	if (!active) return null;

	const impersonating = current !== DEFAULT_VIEW_AS_PRINCIPAL;

	// Admin default first, then every other principal. Keep the current
	// selection in the list even if its record has since disappeared, so
	// the Select always has a value to display.
	const others = (principals.data ?? [])
		.map((p) => p.principalId)
		.filter((id) => id !== DEFAULT_VIEW_AS_PRINCIPAL);
	const optionIds = [DEFAULT_VIEW_AS_PRINCIPAL, ...others];
	if (impersonating && !optionIds.includes(current)) optionIds.push(current);

	function onChange(next: string) {
		setViewAs(workspaceId, next);
		// Every read re-issues with the new header; refetch workspace-scoped
		// queries (documents, chunks, …) so the UI reflects the new identity.
		qc.invalidateQueries({ queryKey: keys.workspaces.detail(workspaceId) });
	}

	const labelFor = (id: string) => {
		const record = principals.data?.find((p) => p.principalId === id);
		return record?.label ? `${record.label} (${id})` : id;
	};

	return (
		<SelectPrimitive.Root value={current} onValueChange={onChange}>
			<SelectPrimitive.Trigger asChild>
				<button
					type="button"
					aria-label={
						impersonating
							? `Viewing as principal "${current}". Click to change.`
							: "Viewing as admin (sees all documents). Click to view as another principal."
					}
					title={
						impersonating
							? `Viewing as "${current}" — the document list is filtered to what this principal can see.`
							: "Viewing as admin — you see every document. Click to view the knowledge base as another principal."
					}
					className={cn(
						"inline-flex h-9 items-center gap-1.5 rounded-md px-2.5 text-sm transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-500)]",
						impersonating
							? "border border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-700/60 dark:bg-amber-900/30 dark:text-amber-200"
							: "border border-transparent text-slate-500 hover:bg-slate-100 hover:text-slate-700 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200",
					)}
				>
					<UserCog className="h-4 w-4 shrink-0" aria-hidden />
					{impersonating ? (
						<span className="max-w-[12ch] truncate font-medium">{current}</span>
					) : null}
				</button>
			</SelectPrimitive.Trigger>
			<SelectContent align="end">
				<SelectGroup>
					<SelectLabel>View knowledge base as</SelectLabel>
					{optionIds.map((id) => (
						<SelectItem key={id} value={id}>
							{id === DEFAULT_VIEW_AS_PRINCIPAL
								? "admin · default (sees all)"
								: labelFor(id)}
						</SelectItem>
					))}
				</SelectGroup>
			</SelectContent>
		</SelectPrimitive.Root>
	);
}
