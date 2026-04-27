import { ArrowUpRight } from "lucide-react";
import { Link } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { Workspace } from "@/lib/schemas";
import { formatDate } from "@/lib/utils";
import { KindBadge } from "./KindBadge";

export function WorkspaceCard({ workspace }: { workspace: Workspace }) {
	return (
		<Card className="group card-lift relative border-[#e0e0e0] bg-white">
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
					<p className="text-xs text-slate-500 mt-1 font-mono truncate">
						{workspace.workspaceId}
					</p>
				</div>
				<div className="flex items-center gap-2 shrink-0">
					<KindBadge kind={workspace.kind} />
					<ArrowUpRight className="h-4 w-4 text-slate-400 transition-all group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-[var(--color-brand-600)]" />
				</div>
			</CardHeader>
			<CardContent>
				<dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
					<dt className="text-slate-500">Keyspace</dt>
					<dd className="text-slate-800 font-mono truncate">
						{workspace.keyspace ?? "—"}
					</dd>
					<dt className="text-slate-500">Created</dt>
					<dd className="text-slate-800">{formatDate(workspace.createdAt)}</dd>
					{workspace.url ? (
						<>
							<dt className="text-slate-500">Url</dt>
							<dd className="text-slate-800 font-mono truncate">
								{workspace.url}
							</dd>
						</>
					) : null}
				</dl>
			</CardContent>
		</Card>
	);
}
