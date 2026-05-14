import { ArrowUpRight } from "lucide-react";
import { Link } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { Workspace } from "@/lib/schemas";
import { formatDate } from "@/lib/utils";
import { KindBadge } from "./KindBadge";

export function WorkspaceCard({ workspace }: { workspace: Workspace }) {
	return (
		<Card className="group card-lift relative min-w-0 border-[#e0e0e0] bg-white dark:border-slate-700 dark:bg-slate-900">
			<Link
				to={`/workspaces/${workspace.workspaceId}`}
				className="absolute inset-0 rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-500)]"
				aria-label={`Open workspace ${workspace.name}`}
			/>
			<CardHeader className="flex-row items-start justify-between gap-3">
				<div className="min-w-0">
					<CardTitle className="truncate transition-colors group-hover:text-[var(--color-brand-700)]">
						{workspace.name}
					</CardTitle>
					<p className="text-xs text-slate-500 mt-1 font-mono truncate dark:text-slate-400">
						{workspace.workspaceId}
					</p>
				</div>
				<div className="flex items-center gap-2 shrink-0">
					<KindBadge kind={workspace.kind} />
					<ArrowUpRight className="h-4 w-4 text-slate-400 transition-all group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-[var(--color-brand-600)] dark:text-slate-500" />
				</div>
			</CardHeader>
			<CardContent>
				<dl className="grid min-w-0 grid-cols-[minmax(5.5rem,auto)_minmax(0,1fr)] gap-x-4 gap-y-2 text-sm">
					<dt className="text-slate-500 dark:text-slate-400">Keyspace</dt>
					<dd className="text-slate-800 font-mono truncate dark:text-slate-300">
						{workspace.keyspace ?? "—"}
					</dd>
					<dt className="text-slate-500 dark:text-slate-400">Created</dt>
					<dd className="text-slate-800 dark:text-slate-300">
						{formatDate(workspace.createdAt)}
					</dd>
					{workspace.url ? (
						<>
							<dt className="text-slate-500 dark:text-slate-400">Url</dt>
							<dd className="text-slate-800 font-mono truncate dark:text-slate-300">
								{workspace.url}
							</dd>
						</>
					) : null}
				</dl>
			</CardContent>
		</Card>
	);
}
