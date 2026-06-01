import { ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useUpdateWorkspace } from "@/hooks/useWorkspaces";
import { formatApiError } from "@/lib/api";
import type { Workspace } from "@/lib/schemas";

/**
 * RLAC master switch (0.5.0 P4). Flips `workspace.rlacEnabled`. Enabling
 * triggers the runtime's flip-on bootstrap (a default `admin` principal,
 * a `["*"]` visibility backfill on un-tagged documents, and a chunk
 * re-tag) so the workspace stays usable immediately — surfaced in the
 * success toast. The server is the authoritative gate; this card only
 * drives the toggle.
 */
export function AccessControlCard({ workspace }: { workspace: Workspace }) {
	const update = useUpdateWorkspace(workspace.workspaceId);
	const enabled = workspace.rlacEnabled;

	async function toggle() {
		const next = !enabled;
		try {
			await update.mutateAsync({ rlacEnabled: next });
			if (next) {
				toast.success("Row-level access control enabled", {
					description:
						"Created a default admin principal and tagged existing documents. Model who sees what under Principals.",
				});
			} else {
				toast.success("Row-level access control disabled", {
					description: "Every workspace member can read every document again.",
				});
			}
		} catch (err) {
			toast.error("Couldn't change access control", {
				description: formatApiError(err),
			});
		}
	}

	return (
		<div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
			<div className="flex min-w-0 items-start gap-3">
				<span
					className={
						enabled
							? "mt-0.5 inline-flex shrink-0 items-center rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200"
							: "mt-0.5 inline-flex shrink-0 items-center rounded-full bg-slate-200 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-600 dark:bg-slate-700 dark:text-slate-300"
					}
				>
					{enabled ? "Enabled" : "Disabled"}
				</span>
				<p className="min-w-0 text-sm leading-relaxed text-slate-600 dark:text-slate-400">
					{enabled
						? "Every knowledge-base read — REST, chunk listing, and agent retrieval — is filtered by each document's visibility list. Manage who sees what under Principals below."
						: "Off — every workspace member reads every document. Enable to filter reads by per-document visibility (a default admin principal is created and existing documents are tagged so you're not locked out)."}
				</p>
			</div>
			<Button
				variant={enabled ? "secondary" : "brand"}
				onClick={toggle}
				disabled={update.isPending}
				className="shrink-0 justify-center"
			>
				<ShieldCheck className="h-4 w-4" />
				{update.isPending
					? "Saving…"
					: enabled
						? "Disable RLAC"
						: "Enable RLAC"}
			</Button>
		</div>
	);
}
