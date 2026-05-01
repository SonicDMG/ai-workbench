import {
	ArrowUpRight,
	Database,
	Loader2,
	Pencil,
	Plus,
	RefreshCw,
	Sparkles,
	Trash2,
	Upload,
} from "lucide-react";
import { useMemo, useState } from "react";
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
import { useDocuments } from "@/hooks/useDocuments";
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
import { formatFileSize } from "@/lib/files";
import type { KnowledgeBaseRecord, RagDocumentRecord } from "@/lib/schemas";
import { formatDate } from "@/lib/utils";
import { CreateKnowledgeBaseDialog } from "./CreateKnowledgeBaseDialog";
import { DocumentStatusBadge } from "./DocumentStatusBadge";
import { EditKnowledgeBaseDialog } from "./EditKnowledgeBaseDialog";
import { FileTypeBadge } from "./FileTypeBadge";
import { IngestQueueDialog } from "./IngestQueueDialog";

interface ServiceLabels {
	readonly chunking: ReadonlyMap<string, string>;
	readonly embedding: ReadonlyMap<string, string>;
	readonly reranking: ReadonlyMap<string, string>;
}

/**
 * Workspace-scoped KB management + ingest trigger.
 *
 * Each row shows the KB, a status badge, document count, and two
 * actions: "Ingest" (opens the ingest dialog, which runs async +
 * polls) and delete. Rows are expandable to show the first 10
 * documents in the KB.
 */
export function KnowledgeBasesPanel({ workspace }: { workspace: string }) {
	const list = useKnowledgeBases(workspace);
	const del = useDeleteKnowledgeBase(workspace);
	const chunkings = useChunkingServices(workspace);
	const embeddings = useEmbeddingServices(workspace);
	const rerankings = useRerankingServices(workspace);
	const [createOpen, setCreateOpen] = useState(false);
	const [toDelete, setToDelete] = useState<KnowledgeBaseRecord | null>(null);
	const [toEdit, setToEdit] = useState<KnowledgeBaseRecord | null>(null);
	const [ingestFor, setIngestFor] = useState<KnowledgeBaseRecord | null>(null);
	const [expanded, setExpanded] = useState<string | null>(null);

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
					<p className="text-sm font-medium text-slate-900">Knowledge bases</p>
					<p className="text-xs text-slate-500 mt-0.5">
						{rows.length === 0
							? "No knowledge bases yet — create one to start ingesting documents."
							: `${rows.length} knowledge base${rows.length === 1 ? "" : "s"} in this workspace.`}
					</p>
				</div>
				<Button variant="brand" size="sm" onClick={() => setCreateOpen(true)}>
					<Plus className="h-4 w-4" /> New knowledge base
				</Button>
			</div>

			{rows.length === 0 ? (
				<div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-6 text-sm text-slate-600">
					A knowledge base owns one Astra collection plus the chunking,
					embedding, and (optionally) reranking services that produce its
					content. Create the services first, then a KB that binds them.
				</div>
			) : (
				<div className="flex flex-col gap-2">
					{rows.map((kb) => (
						<KnowledgeBaseRow
							key={kb.knowledgeBaseId}
							workspace={workspace}
							kb={kb}
							services={serviceLabels}
							expanded={expanded === kb.knowledgeBaseId}
							onToggle={() =>
								setExpanded((cur) =>
									cur === kb.knowledgeBaseId ? null : kb.knowledgeBaseId,
								)
							}
							onIngest={() => setIngestFor(kb)}
							onEdit={() => setToEdit(kb)}
							onDelete={() => setToDelete(kb)}
						/>
					))}
				</div>
			)}

			<CreateKnowledgeBaseDialog
				workspace={workspace}
				open={createOpen}
				onOpenChange={setCreateOpen}
			/>

			<EditKnowledgeBaseDialog
				workspace={workspace}
				kb={toEdit}
				onOpenChange={(o) => !o && setToEdit(null)}
			/>

			{ingestFor ? (
				<IngestQueueDialog
					workspace={workspace}
					knowledgeBase={ingestFor}
					open={true}
					onOpenChange={(o) => !o && setIngestFor(null)}
				/>
			) : null}

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

function KnowledgeBaseRow({
	workspace,
	kb,
	services,
	expanded,
	onToggle,
	onIngest,
	onEdit,
	onDelete,
}: {
	workspace: string;
	kb: KnowledgeBaseRecord;
	services: ServiceLabels;
	expanded: boolean;
	onToggle: () => void;
	onIngest: () => void;
	onEdit: () => void;
	onDelete: () => void;
}) {
	const docs = useDocuments(
		expanded ? workspace : undefined,
		expanded ? kb.knowledgeBaseId : undefined,
	);

	const chunkingName = services.chunking.get(kb.chunkingServiceId);
	const embeddingName = services.embedding.get(kb.embeddingServiceId);
	const rerankingName = kb.rerankingServiceId
		? services.reranking.get(kb.rerankingServiceId)
		: null;

	return (
		<div className="rounded-lg border border-slate-200 bg-white">
			<div className="flex items-center gap-3 p-3">
				<button
					type="button"
					onClick={onToggle}
					className="flex min-w-0 flex-1 items-center gap-2 text-left"
					aria-expanded={expanded}
				>
					<Database className="h-4 w-4 shrink-0 text-slate-400" aria-hidden />
					<div className="min-w-0 flex-1">
						<div className="flex items-center gap-2 flex-wrap">
							<span className="font-medium text-slate-900 truncate">
								{kb.name}
							</span>
							<KbStatusBadge status={kb.status} />
						</div>
						{kb.description ? (
							<p className="text-xs text-slate-500 mt-0.5 truncate">
								{kb.description}
							</p>
						) : (
							<p className="text-xs text-slate-400 mt-0.5 font-mono truncate">
								{kb.knowledgeBaseId}
							</p>
						)}
						<div className="mt-1.5 flex flex-wrap items-center gap-1">
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
					<span className="text-xs text-slate-500 shrink-0">
						{formatDate(kb.createdAt)}
					</span>
				</button>
				<div className="shrink-0 flex items-center gap-1">
					<Button variant="secondary" size="sm" onClick={onIngest}>
						<Upload className="h-4 w-4" /> Ingest
					</Button>
					<Button variant="secondary" size="sm" asChild>
						<Link
							to={`/workspaces/${workspace}/knowledge-bases/${kb.knowledgeBaseId}/playground`}
							title="Open the playground for this knowledge base"
						>
							<Sparkles className="h-4 w-4" /> Playground
						</Link>
					</Button>
					<Button variant="ghost" size="sm" asChild>
						<Link
							to={`/workspaces/${workspace}/knowledge-bases/${kb.knowledgeBaseId}`}
							title="Open the knowledge-base explorer"
						>
							Open <ArrowUpRight className="h-3.5 w-3.5" />
						</Link>
					</Button>
					<Button
						variant="ghost"
						size="sm"
						onClick={onEdit}
						aria-label={`Edit ${kb.name}`}
						title={`Edit ${kb.name}`}
					>
						<Pencil className="h-4 w-4 text-slate-600" />
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
			</div>
			{expanded ? (
				<div className="border-t border-slate-100 bg-slate-50/50 p-3 flex flex-col gap-4">
					<div className="flex flex-col gap-2">
						<p className="text-xs font-medium uppercase tracking-wider text-slate-500">
							Documents
						</p>
						{docs.isLoading ? (
							<p className="text-xs text-slate-500 inline-flex items-center gap-2">
								<Loader2 className="h-3 w-3 animate-spin" /> Loading documents…
							</p>
						) : docs.isError ? (
							<p className="text-xs text-red-600">
								Couldn't load documents: {docs.error.message}
							</p>
						) : (docs.data?.length ?? 0) === 0 ? (
							<p className="text-xs text-slate-500">
								No documents yet. Click{" "}
								<span className="font-medium">Ingest</span> to add one.
							</p>
						) : (
							<DocumentList rows={docs.data ?? []} />
						)}
					</div>
				</div>
			) : null}
		</div>
	);
}

type ServiceKindKey = "chunking" | "embedding" | "reranking";

const SERVICE_CHIP_STYLES: Record<
	ServiceKindKey,
	{ label: string; className: string }
> = {
	chunking: {
		label: "chunking",
		className: "bg-sky-50 text-sky-700 border-sky-200",
	},
	embedding: {
		label: "embedding",
		className: "bg-emerald-50 text-emerald-700 border-emerald-200",
	},
	reranking: {
		label: "reranker",
		className: "bg-purple-50 text-purple-700 border-purple-200",
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
			className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium ${styles.className}`}
			title={tooltip}
		>
			<span className="opacity-70">{styles.label}</span>
			<span className="font-mono normal-case">{display}</span>
		</span>
	);
}

function KbStatusBadge({ status }: { status: KnowledgeBaseRecord["status"] }) {
	const styles: Record<KnowledgeBaseRecord["status"], string> = {
		active: "bg-emerald-50 text-emerald-700 border-emerald-200",
		draft: "bg-slate-50 text-slate-600 border-slate-200",
		deprecated: "bg-amber-50 text-amber-700 border-amber-200",
	};
	return (
		<span
			className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${styles[status]}`}
		>
			{status}
		</span>
	);
}

function DocumentList({ rows }: { rows: readonly RagDocumentRecord[] }) {
	const trimmed = rows.slice(0, 10);
	return (
		<div className="flex flex-col gap-1">
			{trimmed.map((d) => (
				<DocumentRow key={d.documentId} doc={d} />
			))}
			{rows.length > trimmed.length ? (
				<p className="text-xs text-slate-500 pl-6">
					+ {rows.length - trimmed.length} more
				</p>
			) : null}
		</div>
	);
}

function DocumentRow({ doc }: { doc: RagDocumentRecord }) {
	return (
		<div className="flex items-center gap-2 rounded-md px-2 py-1.5 text-xs hover:bg-white">
			<DocumentStatusBadge status={doc.status} />
			<FileTypeBadge
				sourceFilename={doc.sourceFilename}
				fileType={doc.fileType}
			/>
			<span className="min-w-0 truncate text-slate-700">
				{doc.sourceFilename ?? (
					<span className="font-mono text-slate-500">{doc.documentId}</span>
				)}
			</span>
			<span className="ml-auto flex shrink-0 items-center gap-3 text-slate-500 tabular-nums">
				<span>{formatFileSize(doc.fileSize)}</span>
				<span>
					{doc.chunkTotal !== null ? `${doc.chunkTotal} chunks` : "—"}
				</span>
			</span>
		</div>
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
