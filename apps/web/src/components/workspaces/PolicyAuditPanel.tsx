import { RefreshCw, ScrollText } from "lucide-react";
import {
	EmptyState,
	ErrorState,
	LoadingState,
} from "@/components/common/states";
import { Button } from "@/components/ui/button";
import { usePolicyAudit } from "@/hooks/useRlac";
import { formatApiError } from "@/lib/api";
import type { PolicyAuditEntry } from "@/lib/schemas";
import { formatDate } from "@/lib/utils";

/**
 * Read-only RLAC policy-audit log (0.5.0 P4): the most-recent decisions
 * the enforcer made (allow / deny / filter), newest first. Useful for
 * answering "why can't principal X see document Y?" without reading
 * server logs.
 */
export function PolicyAuditPanel({ workspace }: { workspace: string }) {
	const audit = usePolicyAudit(workspace);

	if (audit.isLoading) return <LoadingState label="Loading policy audit…" />;
	if (audit.isError)
		return (
			<ErrorState
				title="Couldn't load policy audit"
				message={formatApiError(audit.error)}
			/>
		);

	const rows = audit.data ?? [];

	return (
		<div className="flex flex-col gap-3">
			<div className="flex items-center justify-end">
				<Button
					variant="secondary"
					onClick={() => audit.refetch()}
					disabled={audit.isFetching}
				>
					<RefreshCw
						className={`h-4 w-4 ${audit.isFetching ? "animate-spin" : ""}`}
					/>
					Refresh
				</Button>
			</div>

			{rows.length === 0 ? (
				<EmptyState
					icon={<ScrollText className="h-8 w-8" />}
					title="No decisions recorded yet"
					description="Policy decisions appear here as principals read documents, search, and chat under RLAC."
				/>
			) : (
				<div className="overflow-x-auto">
					<table className="w-full text-left text-sm">
						<thead className="border-slate-200 border-b text-xs text-slate-500 uppercase tracking-wide dark:border-slate-700 dark:text-slate-400">
							<tr>
								<th className="pb-2 pr-3">When</th>
								<th className="pb-2 pr-3">Principal</th>
								<th className="pb-2 pr-3">Action</th>
								<th className="pb-2 pr-3">Decision</th>
								<th className="pb-2 pr-3">Resource</th>
							</tr>
						</thead>
						<tbody>
							{rows.map((r) => (
								<tr
									key={r.decisionId}
									className="border-slate-200 border-b last:border-b-0 dark:border-slate-800"
								>
									<td className="py-2 pr-3 whitespace-nowrap text-xs text-slate-500 dark:text-slate-400">
										{formatDate(r.ts)}
									</td>
									<td className="py-2 pr-3 font-mono text-xs text-slate-700 dark:text-slate-200">
										{r.principalId ?? (
											<span className="italic text-slate-400 dark:text-slate-500">
												none
											</span>
										)}
									</td>
									<td className="py-2 pr-3 text-slate-600 dark:text-slate-400">
										{r.action}
									</td>
									<td className="py-2 pr-3">
										<DecisionBadge decision={r.decision} />
									</td>
									<td className="py-2 pr-3 font-mono text-xs text-slate-500 dark:text-slate-400">
										<span
											className="block max-w-[16rem] truncate"
											title={r.reason}
										>
											{r.resourceId}
										</span>
									</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
			)}
		</div>
	);
}

function DecisionBadge({
	decision,
}: {
	decision: PolicyAuditEntry["decision"];
}) {
	const cls =
		decision === "allow"
			? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200"
			: decision === "deny"
				? "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200"
				: "bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-200";
	return (
		<span
			className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${cls}`}
		>
			{decision}
		</span>
	);
}
