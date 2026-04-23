import { ArrowUpRight, ExternalLink } from "lucide-react";
import { Link } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { Workspace } from "@/lib/schemas";
import { formatDate } from "@/lib/utils";
import { KindBadge } from "./KindBadge";

export function WorkspaceCard({ workspace }: { workspace: Workspace }) {
	return (
		<Card className="group relative transition-shadow hover:shadow-md">
			<Link
				to={`/workspaces/${workspace.uid}`}
				className="absolute inset-0 rounded-xl focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-500)]"
				aria-label={`Open workspace ${workspace.name}`}
			/>
			<CardHeader className="flex-row items-start justify-between gap-3">
				<div className="min-w-0">
					<CardTitle className="truncate">{workspace.name}</CardTitle>
					<p className="text-xs text-zinc-500 mt-1 font-mono truncate">
						{workspace.uid}
					</p>
				</div>
				<div className="flex items-center gap-2 shrink-0">
					<KindBadge kind={workspace.kind} />
					<ArrowUpRight className="h-4 w-4 text-zinc-400 group-hover:text-zinc-900 transition-colors" />
				</div>
			</CardHeader>
			<CardContent>
				<dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
					<dt className="text-zinc-500">Keyspace</dt>
					<dd className="text-zinc-800 font-mono truncate">
						{workspace.keyspace ?? "—"}
					</dd>
					<dt className="text-zinc-500">Created</dt>
					<dd className="text-zinc-800">{formatDate(workspace.createdAt)}</dd>
					{workspace.url ? (
						<>
							<dt className="text-zinc-500">Console</dt>
							<dd className="text-zinc-800 truncate">
								<a
									href={workspace.url}
									target="_blank"
									rel="noreferrer"
									onClick={(e) => e.stopPropagation()}
									className="relative z-10 inline-flex items-center gap-1 text-[var(--color-brand-600)] hover:underline"
								>
									Open
									<ExternalLink className="h-3 w-3" />
								</a>
							</dd>
						</>
					) : null}
				</dl>
			</CardContent>
		</Card>
	);
}
