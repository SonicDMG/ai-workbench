import { Database, Pencil, RefreshCw, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import {
	EmptyState,
	ErrorState,
	LoadingState,
} from "@/components/common/states";
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
	useDeleteKnowledgeBase,
	useKnowledgeBases,
} from "@/hooks/useKnowledgeBases";
import {
	useChunkingServices,
	useEmbeddingServices,
	useRerankingServices,
} from "@/hooks/useServices";
import { formatApiError } from "@/lib/api";
import type { KnowledgeBaseRecord } from "@/lib/schemas";
import { EditKnowledgeBaseDialog } from "./EditKnowledgeBaseDialog";

interface ServiceLabels {
	readonly chunking: ReadonlyMap<string, string>;
	readonly embedding: ReadonlyMap<string, string>;
	readonly reranking: ReadonlyMap<string, string>;
}

/**
 * Workspace-scoped KB management.
 *
 * Each card links to the KB explorer page, where ingest and document-list
 * workflows live with the full KB context.
 */
export function KnowledgeBasesPanel({ workspace }: { workspace: string }) {
	const list = useKnowledgeBases(workspace);
	const del = useDeleteKnowledgeBase(workspace);
	const chunkings = useChunkingServices(workspace);
	const embeddings = useEmbeddingServices(workspace);
	const rerankings = useRerankingServices(workspace);
	const [toDelete, setToDelete] = useState<KnowledgeBaseRecord | null>(null);
	const [toEdit, setToEdit] = useState<KnowledgeBaseRecord | null>(null);

	const serviceLabels = useMemo<ServiceLabels>(
		() => ({
			chunking: new Map(
				(chunkings.data ?? []).map((s) => [s.chunkingServiceId, s.name]),
			),
			embedding: new Map(
				(embeddings.data ?? []).map((s) => [s.embeddingServiceId, s.name]),
			),
			reranking: new Map(
				(rerankings.data ?? []).map((s) => [s.rerankingServiceId, s.name]),
			),
		}),
		[chunkings.data, embeddings.data, rerankings.data],
	);

	if (list.isLoading) return <LoadingState label="Loading knowledge bases…" />;
	if (list.isError) {
		return (
			<ErrorState
				title="Couldn't load knowledge bases"
				message={formatApiError(list.error)}
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
			{rows.length === 0 ? (
				<EmptyState
					icon={<Database className="h-8 w-8" />}
					title="No knowledge bases yet"
					description="A knowledge base owns one Astra collection plus the chunking, embedding, and (optionally) reranking services that produce its content. Pick those when you create the KB — service definitions live under Settings."
				/>
			) : (
				<ul className="grid grid-cols-1 gap-3 md:grid-cols-2">
					{rows.map((kb) => (
						<KnowledgeBaseCard
							key={kb.knowledgeBaseId}
							workspace={workspace}
							kb={kb}
							services={serviceLabels}
							onEdit={() => setToEdit(kb)}
							onDelete={() => setToDelete(kb)}
						/>
					))}
				</ul>
			)}

			<EditKnowledgeBaseDialog
				workspace={workspace}
				kb={toEdit}
				onOpenChange={(o) => !o && setToEdit(null)}
			/>

			<DeleteKnowledgeBaseDialog
				kb={toDelete}
				submitting={del.isPending}
				onOpenChange={(o) => !o && setToDelete(null)}
				onConfirm={async () => {
					if (!toDelete) return;
					try {
						await del.mutateAsync(toDelete.knowledgeBaseId);
						toast.success(`Knowledge base '${toDelete.name}' deleted`);
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

function KnowledgeBaseCard({
	workspace,
	kb,
	services,
	onEdit,
	onDelete,
}: {
	workspace: string;
	kb: KnowledgeBaseRecord;
	services: ServiceLabels;
	onEdit: () => void;
	onDelete: () => void;
}) {
	const chunkingName = services.chunking.get(kb.chunkingServiceId);
	const embeddingName = services.embedding.get(kb.embeddingServiceId);
	const rerankingName = kb.rerankingServiceId
		? services.reranking.get(kb.rerankingServiceId)
		: null;

	const detailPath = `/workspaces/${workspace}/knowledge-bases/${kb.knowledgeBaseId}`;
	return (
		<li className="group relative min-w-0 rounded-lg border border-slate-200 bg-white p-4 shadow-sm transition-colors hover:border-slate-300 dark:border-slate-700 dark:bg-slate-900 dark:hover:border-slate-600">
			{/*
			 * Primary action — the whole card opens the explorer. Edit/delete
			 * live above the link layer so mutating controls don't navigate.
			 */}
			<Link
				to={detailPath}
				aria-label={`Open ${kb.name}`}
				className="absolute inset-0 z-10 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-500)]"
			/>
			<div className="pointer-events-none flex h-full min-w-0 flex-col gap-4 pr-16">
				<div className="flex items-start gap-3">
					<div
						aria-hidden="true"
						className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400"
					>
						<Database className="h-5 w-5" />
					</div>
					<div className="min-w-0 flex-1">
						<div className="flex min-w-0 flex-wrap items-center gap-2">
							<span className="min-w-0 max-w-full truncate text-sm font-semibold text-slate-900 dark:text-slate-100">
								{kb.name}
							</span>
							<KbStatusBadge status={kb.status} />
						</div>
						{kb.description ? (
							<p className="mt-1 line-clamp-2 text-xs leading-5 text-slate-500 dark:text-slate-400">
								{kb.description}
							</p>
						) : (
							<p className="mt-1 truncate font-mono text-xs text-slate-400 dark:text-slate-500">
								{kb.knowledgeBaseId}
							</p>
						)}
					</div>
				</div>
				<div className="mt-auto flex flex-wrap items-center gap-1">
					<ServiceChip
						kind="chunking"
						name={chunkingName}
						id={kb.chunkingServiceId}
					/>
					<ServiceChip
						kind="embedding"
						name={embeddingName}
						id={kb.embeddingServiceId}
					/>
					{kb.rerankingServiceId ? (
						<ServiceChip
							kind="reranking"
							name={rerankingName}
							id={kb.rerankingServiceId}
						/>
					) : null}
				</div>
			</div>
			<div className="absolute right-3 top-3 z-20 flex shrink-0 items-center gap-1">
				<Button
					variant="ghost"
					size="sm"
					onClick={onEdit}
					aria-label={`Edit ${kb.name}`}
					title={`Edit ${kb.name}`}
				>
					<Pencil className="h-4 w-4 text-slate-600 dark:text-slate-400" />
				</Button>
				<Button
					variant="ghost"
					size="sm"
					onClick={onDelete}
					aria-label={`Delete ${kb.name}`}
				>
					<Trash2 className="h-4 w-4 text-red-600" />
				</Button>
			</div>
		</li>
	);
}

type ServiceKindKey = "chunking" | "embedding" | "reranking";

const SERVICE_CHIP_STYLES: Record<
	ServiceKindKey,
	{ label: string; className: string }
> = {
	chunking: {
		label: "chunking",
		className:
			"bg-sky-50 text-sky-700 border-sky-200 dark:bg-sky-950/40 dark:text-sky-300 dark:border-sky-900/50",
	},
	embedding: {
		label: "embedding",
		className:
			"bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-900/50",
	},
	reranking: {
		label: "reranker",
		className:
			"bg-purple-50 text-purple-700 border-purple-200 dark:bg-purple-950/40 dark:text-purple-300 dark:border-purple-900/50",
	},
};

function ServiceChip({
	kind,
	name,
	id,
}: {
	kind: ServiceKindKey;
	name: string | null | undefined;
	id: string;
}) {
	const styles = SERVICE_CHIP_STYLES[kind];
	const display = name ?? id.slice(0, 8);
	const tooltip = name ? `${styles.label}: ${name}` : `${styles.label}: ${id}`;
	return (
		<span
			className={`inline-flex max-w-full items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium ${styles.className}`}
			title={tooltip}
		>
			<span className="opacity-70">{styles.label}</span>
			<span className="truncate font-mono normal-case">{display}</span>
		</span>
	);
}

function KbStatusBadge({ status }: { status: KnowledgeBaseRecord["status"] }) {
	const styles: Record<KnowledgeBaseRecord["status"], string> = {
		active:
			"bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-900/50",
		draft:
			"bg-slate-50 text-slate-600 border-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:border-slate-700",
		deprecated:
			"bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-900/50",
	};
	return (
		<span
			className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${styles[status]}`}
		>
			{status}
		</span>
	);
}

function DeleteKnowledgeBaseDialog({
	kb,
	submitting,
	onOpenChange,
	onConfirm,
}: {
	kb: KnowledgeBaseRecord | null;
	submitting: boolean;
	onOpenChange: (v: boolean) => void;
	onConfirm: () => void;
}) {
	const [confirm, setConfirm] = useState("");
	const open = kb !== null;
	const expected = kb?.name ?? "";
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
					<DialogTitle>Delete knowledge base</DialogTitle>
					<DialogDescription>
						Drops the KB, every document it holds, and the underlying Astra
						collection. The bound services stay in place. Type{" "}
						<span className="font-mono">{expected}</span> to confirm.
					</DialogDescription>
				</DialogHeader>
				<input
					className="h-9 w-full rounded-md border border-slate-300 bg-white px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-500)] dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 dark:placeholder:text-slate-500"
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
