import { Database, Play, Plus, RefreshCw, Trash2 } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { ErrorState, LoadingState } from "@/components/common/states";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { useDeleteVectorStore, useVectorStores } from "@/hooks/useVectorStores";
import { formatApiError } from "@/lib/api";
import type { VectorStoreRecord } from "@/lib/schemas";
import { formatDate } from "@/lib/utils";
import { CreateVectorStoreDialog } from "./CreateVectorStoreDialog";

/**
 * Workspace-scoped vector-store management. Mirrors ApiKeysPanel —
 * list + create + delete, with a "Query in playground" shortcut on
 * each row that deep-links to `/playground` (user still picks the
 * workspace/store from the dropdowns there since the page doesn't
 * accept params yet; this is a nav hint, not a deep-link).
 */
export function VectorStoresPanel({ workspace }: { workspace: string }) {
	const list = useVectorStores(workspace);
	const del = useDeleteVectorStore(workspace);
	const [createOpen, setCreateOpen] = useState(false);
	const [toDelete, setToDelete] = useState<VectorStoreRecord | null>(null);

	if (list.isLoading) return <LoadingState label="Loading vector stores…" />;
	if (list.isError) {
		return (
			<ErrorState
				title="Couldn't load vector stores"
				message={list.error.message}
				actions={
					<Button variant="secondary" onClick={() => list.refetch()}>
						<RefreshCw className="h-4 w-4" /> Retry
					</Button>
				}
			/>
		);
	}

	const rows = list.data ?? [];

	return (
		<div className="flex flex-col gap-4">
			<div className="flex items-start justify-between gap-3 flex-wrap">
				<div>
					<p className="text-sm font-medium text-slate-900">Vector stores</p>
					<p className="text-xs text-slate-500 mt-0.5">
						{rows.length === 0
							? "No vector stores yet — create one to start indexing."
							: `${rows.length} vector store${rows.length === 1 ? "" : "s"} in this workspace.`}
					</p>
				</div>
				<Button variant="brand" size="sm" onClick={() => setCreateOpen(true)}>
					<Plus className="h-4 w-4" /> New vector store
				</Button>
			</div>

			{rows.length === 0 ? (
				<div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-6 text-sm text-slate-600">
					Vector stores are backed by a collection in the workspace's driver
					(Astra collections for Astra workspaces, in-process maps for mock
					workspaces). Create one, upsert vectors via the data plane or run a
					text query through the{" "}
					<Link
						to="/playground"
						className="text-[var(--color-brand-600)] underline underline-offset-2"
					>
						playground
					</Link>
					.
				</div>
			) : (
				<div className="overflow-hidden rounded-lg border border-slate-200">
					<table className="w-full text-sm">
						<thead className="bg-slate-50 text-left text-xs uppercase tracking-wider text-slate-500">
							<tr>
								<th className="px-4 py-2 font-medium">Name</th>
								<th className="px-4 py-2 font-medium">Dim</th>
								<th className="px-4 py-2 font-medium">Metric</th>
								<th className="px-4 py-2 font-medium">Embedding</th>
								<th className="px-4 py-2 font-medium">Created</th>
								<th className="px-4 py-2" />
							</tr>
						</thead>
						<tbody className="divide-y divide-slate-100">
							{rows.map((vs) => (
								<tr key={vs.uid} className="bg-white hover:bg-slate-50/60">
									<td className="px-4 py-2.5">
										<div className="flex items-center gap-2">
											<Database
												className="h-4 w-4 text-slate-400"
												aria-hidden
											/>
											<span className="font-medium text-slate-900">
												{vs.name}
											</span>
										</div>
									</td>
									<td className="px-4 py-2.5 font-mono text-xs text-slate-700">
										{vs.vectorDimension}
									</td>
									<td className="px-4 py-2.5 font-mono text-xs text-slate-700">
										{vs.vectorSimilarity}
									</td>
									<td className="px-4 py-2.5 text-xs text-slate-600">
										<span className="font-mono">
											{vs.embedding.provider}:{vs.embedding.model}
										</span>
									</td>
									<td className="px-4 py-2.5 text-xs text-slate-500">
										{formatDate(vs.createdAt)}
									</td>
									<td className="px-4 py-2.5 text-right">
										<div className="inline-flex items-center gap-1">
											<Button variant="ghost" size="sm" asChild>
												<Link to="/playground" aria-label="Query in playground">
													<Play className="h-4 w-4" />
													<span className="sr-only sm:not-sr-only">Query</span>
												</Link>
											</Button>
											<Button
												variant="ghost"
												size="sm"
												onClick={() => setToDelete(vs)}
												aria-label={`Delete ${vs.name}`}
											>
												<Trash2 className="h-4 w-4 text-red-600" />
											</Button>
										</div>
									</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
			)}

			<CreateVectorStoreDialog
				workspace={workspace}
				open={createOpen}
				onOpenChange={setCreateOpen}
			/>

			<DeleteVectorStoreDialog
				vectorStore={toDelete}
				submitting={del.isPending}
				onOpenChange={(o) => !o && setToDelete(null)}
				onConfirm={async () => {
					if (!toDelete) return;
					try {
						await del.mutateAsync(toDelete.uid);
						toast.success(`Vector store '${toDelete.name}' deleted`);
						setToDelete(null);
					} catch (err) {
						toast.error("Couldn't delete", {
							description: formatApiError(err),
						});
					}
				}}
			/>
		</div>
	);
}

/**
 * Destructive-delete dialog for vector stores.
 *
 * Drops the underlying collection server-side, so a typed-name
 * confirmation matches the workspace-delete pattern. Reuses the
 * existing Dialog primitive rather than DeleteDialog because the
 * workspace version is specialized for workspace fields.
 */
function DeleteVectorStoreDialog({
	vectorStore,
	submitting,
	onOpenChange,
	onConfirm,
}: {
	vectorStore: VectorStoreRecord | null;
	submitting: boolean;
	onOpenChange: (v: boolean) => void;
	onConfirm: () => void;
}) {
	const [confirm, setConfirm] = useState("");
	const open = vectorStore !== null;
	const expected = vectorStore?.name ?? "";
	const typed = confirm.trim() === expected && expected.length > 0;
	return (
		<Dialog
			open={open}
			onOpenChange={(o) => {
				onOpenChange(o);
				if (!o) setConfirm("");
			}}
		>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>Delete vector store</DialogTitle>
					<DialogDescription>
						This drops the underlying collection. Every upserted record is gone.
						Type <span className="font-mono">{expected}</span> to confirm.
					</DialogDescription>
				</DialogHeader>
				<input
					className="h-9 w-full rounded-md border border-slate-300 bg-white px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-500)]"
					value={confirm}
					onChange={(e) => setConfirm(e.target.value)}
					placeholder={expected}
				/>
				<DialogFooter>
					<Button
						variant="ghost"
						onClick={() => onOpenChange(false)}
						disabled={submitting}
					>
						Cancel
					</Button>
					<Button
						variant="destructive"
						onClick={onConfirm}
						disabled={submitting || !typed}
					>
						{submitting ? "Deleting…" : "Delete"}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
