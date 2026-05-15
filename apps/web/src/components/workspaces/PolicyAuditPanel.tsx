import { ScrollText } from "lucide-react";
import { ErrorState, LoadingState } from "@/components/common/states";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { usePolicyAudit } from "@/hooks/useRlac";
import { formatDate } from "@/lib/utils";

/**
 * Workspace-level audit panel — surfaces the policy-decision log
 * emitted by the route-layer enforcer. Drives the demo's "show that
 * compliance can see who saw what" narrative.
 */
export function PolicyAuditPanel({ workspace }: { workspace: string }) {
	const audit = usePolicyAudit(workspace, { limit: 50 });

	if (audit.isLoading) return <LoadingState label="Loading audit log…" />;
	if (audit.isError)
		return (
			<ErrorState
				title="Couldn't load audit log"
				message={audit.error.message}
			/>
		);

	const rows = audit.data ?? [];

	return (
		<Card className="overflow-hidden shadow-sm">
			<CardHeader className="flex flex-row items-start gap-3 space-y-0 bg-slate-50/70 p-4 dark:bg-slate-900/60">
				<div className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-200">
					<ScrollText className="h-4 w-4" />
				</div>
				<div>
					<CardTitle className="text-base">Policy audit</CardTitle>
					<p className="mt-1 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
						Append-only log of policy decisions. Refreshes every five seconds.
						{rows.length === 0
							? " No decisions recorded yet."
							: ` Most recent ${rows.length}.`}
					</p>
				</div>
			</CardHeader>
			<CardContent className="p-4 pt-3">
				{rows.length === 0 ? (
					<div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-6 text-center text-sm text-slate-500 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-400">
						No policy decisions recorded yet. Enable a KB policy and exercise a
						list/get to see decisions land here.
					</div>
				) : (
					<div className="max-h-72 overflow-auto rounded border border-slate-200 dark:border-slate-700">
						<table className="w-full text-left text-xs">
							<thead className="sticky top-0 z-10 bg-slate-50 text-[10px] text-slate-500 uppercase tracking-wide dark:bg-slate-800 dark:text-slate-400">
								<tr className="border-slate-200 border-b dark:border-slate-700">
									<th className="px-2 py-1.5 font-medium">When</th>
									<th className="px-2 py-1.5 font-medium">Principal</th>
									<th className="px-2 py-1.5 font-medium">Action</th>
									<th className="px-2 py-1.5 font-medium">Decision</th>
									<th className="px-2 py-1.5 font-medium">Resource</th>
									<th className="px-2 py-1.5 font-medium">Reason</th>
								</tr>
							</thead>
							<tbody>
								{rows.map((r) => (
									<tr
										key={r.decisionId}
										className="border-slate-100 border-b last:border-b-0 dark:border-slate-800"
									>
										<td className="px-2 py-1 font-mono text-[10px] text-slate-500 dark:text-slate-400 whitespace-nowrap">
											{formatDate(r.ts)}
										</td>
										<td className="px-2 py-1 font-mono text-[11px] text-slate-700 dark:text-slate-200 whitespace-nowrap">
											{r.principalId ?? (
												<span className="text-slate-400">&lt;none&gt;</span>
											)}
										</td>
										<td className="px-2 py-1 text-slate-700 dark:text-slate-200 whitespace-nowrap">
											{r.action}
										</td>
										<td className="px-2 py-1">
											<DecisionBadge decision={r.decision} />
										</td>
										<td className="px-2 py-1 font-mono text-[10px] text-slate-500 dark:text-slate-400 whitespace-nowrap">
											{r.resourceId === "*" ? (
												<span className="text-slate-400">list</span>
											) : (
												`${r.resourceId.slice(0, 8)}…`
											)}
										</td>
										<td className="px-2 py-1 text-slate-700 dark:text-slate-200">
											{r.reason}
										</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
				)}
			</CardContent>
		</Card>
	);
}

function DecisionBadge({
	decision,
}: {
	decision: "allow" | "deny" | "filter";
}) {
	if (decision === "allow") {
		return (
			<span className="rounded bg-green-100 px-1.5 py-0.5 text-[10px] text-green-800 uppercase tracking-wide dark:bg-green-900/40 dark:text-green-300">
				allow
			</span>
		);
	}
	if (decision === "deny") {
		return (
			<span className="rounded bg-red-100 px-1.5 py-0.5 text-[10px] text-red-800 uppercase tracking-wide dark:bg-red-900/40 dark:text-red-300">
				deny
			</span>
		);
	}
	return (
		<span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] text-amber-800 uppercase tracking-wide dark:bg-amber-900/40 dark:text-amber-300">
			filter
		</span>
	);
}
