import { CheckCircle2, Database, Info, Loader2, RefreshCw } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import {
	useAdoptCollection,
	useDiscoverableCollections,
} from "@/hooks/useVectorStores";
import { formatApiError } from "@/lib/api";

/**
 * Lists collections that already exist in the workspace's data plane
 * but aren't yet wrapped in a workbench descriptor, and lets the user
 * adopt them with a single click. The route layer pulls the live
 * collection's vector / lexical / rerank options off the data plane,
 * so the resulting descriptor mirrors reality — no re-provisioning
 * round trip.
 *
 * Empty for `mock` workspaces (the driver has no notion of "external
 * collections"). For Astra workspaces this is how operators bring a
 * pre-existing keyspace under workbench management — handy for
 * collections created by another tool, by hand, or by an older
 * workbench install whose control-plane state was lost.
 */
export function AdoptCollectionDialog({
	workspace,
	open,
	onOpenChange,
}: {
	workspace: string;
	open: boolean;
	onOpenChange: (v: boolean) => void;
}) {
	const list = useDiscoverableCollections(workspace, { enabled: open });
	const adopt = useAdoptCollection(workspace);
	const [adopting, setAdopting] = useState<string | null>(null);

	async function onAdopt(name: string): Promise<void> {
		setAdopting(name);
		try {
			await adopt.mutateAsync(name);
			toast.success(`Adopted '${name}'`, {
				description:
					"A descriptor now wraps the existing collection — search and ingest endpoints can address it.",
			});
		} catch (err) {
			toast.error(`Couldn't adopt '${name}'`, {
				description: formatApiError(err),
			});
		} finally {
			setAdopting(null);
		}
	}

	const rows = list.data ?? [];

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="max-w-2xl">
				<DialogHeader>
					<DialogTitle>Adopt existing collections</DialogTitle>
					<DialogDescription>
						Collections found in this workspace's data plane that don't yet have
						a workbench descriptor. Click <strong>Adopt</strong> to wrap one —
						its vector, lexical, and rerank options are read off the live
						collection so nothing is reprovisioned.
					</DialogDescription>
				</DialogHeader>

				<div className="flex items-center justify-end">
					<Button
						variant="ghost"
						size="sm"
						onClick={() => list.refetch()}
						disabled={list.isFetching}
					>
						<RefreshCw
							className={`h-4 w-4 ${list.isFetching ? "animate-spin" : ""}`}
						/>{" "}
						Refresh
					</Button>
				</div>

				{list.isLoading ? (
					<p className="inline-flex items-center gap-2 text-sm text-slate-600">
						<Loader2 className="h-4 w-4 animate-spin" /> Scanning data plane…
					</p>
				) : list.isError ? (
					<div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-900">
						<p className="font-medium">Couldn't list collections</p>
						<p className="text-xs mt-0.5">{list.error.message}</p>
					</div>
				) : rows.length === 0 ? (
					<div className="rounded-md border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
						<p className="inline-flex items-center gap-2 font-medium text-slate-700">
							<Info className="h-4 w-4 text-slate-400" /> Nothing to adopt
						</p>
						<p className="text-xs mt-1">
							Either every collection in this data plane is already wrapped, or
							the workspace's driver doesn't expose external collections (the
							mock driver, for instance). Mock workspaces always look empty here
							— that's by design.
						</p>
					</div>
				) : (
					<div className="overflow-hidden rounded-lg border border-slate-200">
						<table className="w-full text-sm">
							<thead className="bg-slate-50 text-left text-xs uppercase tracking-wider text-slate-500">
								<tr>
									<th className="px-3 py-2 font-medium">Name</th>
									<th className="px-3 py-2 font-medium">Dim</th>
									<th className="px-3 py-2 font-medium">Metric</th>
									<th className="px-3 py-2 font-medium">Embedding</th>
									<th className="px-3 py-2 font-medium">Lanes</th>
									<th className="px-3 py-2" />
								</tr>
							</thead>
							<tbody className="divide-y divide-slate-100">
								{rows.map((row) => {
									const isAdopting = adopting === row.name;
									return (
										<tr key={row.name} className="bg-white">
											<td className="px-3 py-2.5">
												<div className="flex items-center gap-2">
													<Database
														className="h-3.5 w-3.5 text-slate-400"
														aria-hidden
													/>
													<span className="font-mono text-xs text-slate-900">
														{row.name}
													</span>
												</div>
											</td>
											<td className="px-3 py-2.5 tabular-nums">
												{row.vectorDimension}
											</td>
											<td className="px-3 py-2.5 text-slate-600">
												{row.vectorSimilarity}
											</td>
											<td className="px-3 py-2.5 text-slate-600">
												{row.embedding ? (
													<span
														title={`${row.embedding.provider}:${row.embedding.model}`}
													>
														{row.embedding.provider}
													</span>
												) : (
													<span className="text-slate-400">none (BYO)</span>
												)}
											</td>
											<td className="px-3 py-2.5">
												<div className="flex items-center gap-1.5 text-[10px]">
													{row.lexicalEnabled ? (
														<span className="rounded-full border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-emerald-700">
															lexical
														</span>
													) : null}
													{row.rerankEnabled ? (
														<span className="rounded-full border border-violet-200 bg-violet-50 px-1.5 py-0.5 text-violet-700">
															rerank
														</span>
													) : null}
													{!row.lexicalEnabled && !row.rerankEnabled ? (
														<span className="text-slate-400">—</span>
													) : null}
												</div>
											</td>
											<td className="px-3 py-2.5 text-right">
												<Button
													variant="brand"
													size="sm"
													onClick={() => onAdopt(row.name)}
													disabled={isAdopting || adopt.isPending}
												>
													{isAdopting ? (
														<>
															<Loader2 className="h-3.5 w-3.5 animate-spin" />{" "}
															Adopting…
														</>
													) : (
														<>
															<CheckCircle2 className="h-3.5 w-3.5" /> Adopt
														</>
													)}
												</Button>
											</td>
										</tr>
									);
								})}
							</tbody>
						</table>
					</div>
				)}

				<DialogFooter>
					<Button variant="ghost" onClick={() => onOpenChange(false)}>
						Close
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
