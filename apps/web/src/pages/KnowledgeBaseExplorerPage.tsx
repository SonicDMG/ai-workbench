import { ArrowLeft, Database, RefreshCw, Trash2, Upload } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { AstraCodeChip } from "@/components/astra/AstraCodeChip";
import { ErrorState, LoadingState } from "@/components/common/states";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { DocumentDetailDialog } from "@/components/workspaces/DocumentDetailDialog";
import { DocumentTable } from "@/components/workspaces/DocumentTable";
import { EditDocumentDialog } from "@/components/workspaces/EditDocumentDialog";
import { FileTypeBadge } from "@/components/workspaces/FileTypeBadge";
import { IngestQueueDialog } from "@/components/workspaces/IngestQueueDialog";
import { ViewAsControl } from "@/components/workspaces/ViewAsControl";
import {
	useDeleteDocument,
	useDeleteDocuments,
	useDocuments,
} from "@/hooks/useDocuments";
import { useKnowledgeBase } from "@/hooks/useKnowledgeBases";
import { useWorkspace } from "@/hooks/useWorkspaces";
import { formatApiError } from "@/lib/api";
import { formatFileSize } from "@/lib/files";
import type {
	AstraQuerySnapshot,
	KnowledgeBaseRecord,
	RagDocumentRecord,
	Workspace,
} from "@/lib/schemas";

/**
 * Knowledge-base explorer — `/workspaces/:wid/knowledge-bases/:kbid`.
 * Shows the documents in one KB as a sortable, searchable table with
 * file-type badges, sizes, statuses, and an inline detail dialog.
 *
 * The "Ingest" button pops the multi-file / folder queue.
 */
export function KnowledgeBaseExplorerPage() {
	const params = useParams<{
		workspaceId: string;
		knowledgeBaseId: string;
	}>();
	const workspaceId = params.workspaceId;
	const knowledgeBaseId = params.knowledgeBaseId;

	const ws = useWorkspace(workspaceId);
	const kb = useKnowledgeBase(workspaceId, knowledgeBaseId);
	const docs = useDocuments(workspaceId, knowledgeBaseId);

	const [ingestOpen, setIngestOpen] = useState(false);
	const [detail, setDetail] = useState<RagDocumentRecord | null>(null);
	const [toEdit, setToEdit] = useState<RagDocumentRecord | null>(null);
	const [toDelete, setToDelete] = useState<RagDocumentRecord | null>(null);
	const deleteDoc = useDeleteDocument(workspaceId ?? "", knowledgeBaseId ?? "");
	// Bulk selection (#359): checkbox state lives here so the table
	// stays presentational and the delete button + confirm dialog can
	// share it. Cleared after a bulk delete completes.
	const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(
		new Set(),
	);
	const [bulkConfirmOpen, setBulkConfirmOpen] = useState(false);
	const deleteDocs = useDeleteDocuments(
		workspaceId ?? "",
		knowledgeBaseId ?? "",
	);

	// Deep-link from chat citations: `?document=<id>&chunk=<id>` lands
	// here, auto-opens the matching document detail dialog, and the
	// dialog scrolls + highlights the cited chunk on its own.
	const [searchParams, setSearchParams] = useSearchParams();
	const wantedDocumentId = searchParams.get("document");
	const wantedChunkId = searchParams.get("chunk");
	useEffect(() => {
		if (!wantedDocumentId) return;
		if (detail?.documentId === wantedDocumentId) return;
		const match = (docs.data ?? []).find(
			(d) => d.documentId === wantedDocumentId,
		);
		if (match) setDetail(match);
	}, [wantedDocumentId, docs.data, detail?.documentId]);

	// Prune the selection when the document list changes (refetch,
	// single delete, ingest) so stale ids can't linger in the set and
	// inflate the "Delete selected (N)" count.
	useEffect(() => {
		if (!docs.data) return;
		const present = new Set(docs.data.map((d) => d.documentId));
		setSelectedIds((cur) => {
			const next = new Set([...cur].filter((id) => present.has(id)));
			return next.size === cur.size ? cur : next;
		});
	}, [docs.data]);

	const onDetailOpenChange = (open: boolean) => {
		if (open) return;
		setDetail(null);
		// Strip the deep-link query when the user dismisses the dialog
		// so a back-button-then-reopen doesn't re-trigger the auto-open.
		if (wantedDocumentId || wantedChunkId) {
			const next = new URLSearchParams(searchParams);
			next.delete("document");
			next.delete("chunk");
			setSearchParams(next, { replace: true });
		}
	};

	if (!workspaceId || !knowledgeBaseId) {
		return (
			<ErrorState
				title="Invalid URL"
				message="Missing workspace or knowledge-base ID."
			/>
		);
	}

	if (ws.isLoading || kb.isLoading) {
		return <LoadingState label="Loading knowledge base…" />;
	}
	if (ws.isError) {
		return (
			<ErrorState
				title="Couldn't load workspace"
				message={formatApiError(ws.error)}
			/>
		);
	}
	if (kb.isError || !kb.data) {
		return (
			<div className="mx-auto max-w-3xl px-6 py-10">
				<ErrorState
					title="Knowledge base not found"
					message={
						kb.isError
							? formatApiError(kb.error)
							: `No knowledge base ${knowledgeBaseId} in this workspace.`
					}
					actions={
						<Button variant="secondary" asChild>
							<Link to={`/workspaces/${workspaceId}`}>
								<ArrowLeft className="h-4 w-4" /> Back to workspace
							</Link>
						</Button>
					}
				/>
			</div>
		);
	}

	const knowledgeBase = kb.data;

	return (
		<div className="mx-auto flex max-w-5xl flex-col gap-6 px-6 py-8">
			<header className="flex flex-col gap-2">
				<Link
					to={`/workspaces/${workspaceId}`}
					className="inline-flex items-center gap-1 text-sm text-slate-600 hover:text-slate-900 w-max dark:text-slate-400 dark:hover:text-slate-100"
				>
					<ArrowLeft className="h-4 w-4" />
					{ws.data?.name ?? "Workspace"}
				</Link>
				<div className="flex flex-wrap items-start justify-between gap-3">
					<div className="flex items-start gap-3">
						<Database
							className="h-7 w-7 text-slate-400 mt-1 dark:text-slate-500"
							aria-hidden
						/>
						<div>
							<h1 className="text-2xl font-semibold text-slate-900 dark:text-slate-100">
								{knowledgeBase.name}
							</h1>
							{knowledgeBase.description ? (
								<p className="text-sm text-slate-600 dark:text-slate-400">
									{knowledgeBase.description}
								</p>
							) : (
								<p className="text-xs text-slate-500 font-mono dark:text-slate-400">
									{knowledgeBase.knowledgeBaseId}
								</p>
							)}
						</div>
					</div>
					<div className="flex items-center gap-2">
						<ViewAsControl
							workspaceId={workspaceId}
							rlacEnabled={Boolean(ws.data?.rlacEnabled)}
						/>
						<Button
							variant="secondary"
							size="sm"
							onClick={() => docs.refetch()}
						>
							<RefreshCw className="h-4 w-4" /> Refresh
						</Button>
						<Button
							variant="brand"
							size="sm"
							onClick={() => setIngestOpen(true)}
							title="Upload one or more files into this knowledge base. Files are deduped by content hash and chunked + embedded automatically."
						>
							<Upload className="h-4 w-4" /> Ingest
						</Button>
					</div>
				</div>
			</header>

			<Card>
				<CardHeader>
					<CardTitle>Documents</CardTitle>
					<CardDescription>
						Each row is one uploaded file. Click a row to see the chunks the
						runtime extracted, plus full metadata and any error message if the
						ingest failed.
					</CardDescription>
				</CardHeader>
				<CardContent>
					{docs.isLoading ? (
						<LoadingState label="Loading documents…" />
					) : docs.isError ? (
						<ErrorState
							title="Couldn't load documents"
							message={formatApiError(docs.error)}
							actions={
								<Button variant="secondary" onClick={() => docs.refetch()}>
									<RefreshCw className="h-4 w-4" /> Retry
								</Button>
							}
						/>
					) : (
						<div className="flex flex-col gap-3">
							{selectedIds.size > 0 ? (
								<div className="flex items-center justify-between rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800">
									<span className="text-slate-700 dark:text-slate-300">
										{selectedIds.size} document
										{selectedIds.size === 1 ? "" : "s"} selected
									</span>
									<div className="flex items-center gap-2">
										<Button
											variant="ghost"
											size="sm"
											onClick={() => setSelectedIds(new Set())}
											disabled={deleteDocs.isPending}
										>
											Clear selection
										</Button>
										<Button
											variant="destructive"
											size="sm"
											onClick={() => setBulkConfirmOpen(true)}
											disabled={deleteDocs.isPending}
										>
											<Trash2 className="h-4 w-4" /> Delete selected (
											{selectedIds.size})
										</Button>
									</div>
								</div>
							) : null}
							<DocumentTable
								docs={docs.data ?? []}
								onSelect={(d) => setDetail(d)}
								onEdit={(d) => setToEdit(d)}
								onDelete={(d) => setToDelete(d)}
								deletingDocumentId={
									deleteDoc.isPending ? (deleteDoc.variables ?? null) : null
								}
								selectedIds={selectedIds}
								onSelectionChange={setSelectedIds}
							/>
						</div>
					)}
				</CardContent>
			</Card>

			<IngestQueueDialog
				workspace={workspaceId}
				knowledgeBase={knowledgeBase}
				open={ingestOpen}
				onOpenChange={setIngestOpen}
			/>
			<DocumentDetailDialog
				workspace={workspaceId}
				knowledgeBaseId={knowledgeBase.knowledgeBaseId}
				doc={detail}
				highlightChunkId={wantedChunkId}
				onOpenChange={onDetailOpenChange}
			/>

			<EditDocumentDialog
				workspace={workspaceId}
				knowledgeBaseId={knowledgeBase.knowledgeBaseId}
				doc={toEdit}
				onOpenChange={(open) => {
					if (!open) setToEdit(null);
				}}
			/>

			<BulkDeleteDocumentsDialog
				open={bulkConfirmOpen}
				count={selectedIds.size}
				submitting={deleteDocs.isPending}
				onOpenChange={(o) => {
					if (!deleteDocs.isPending) setBulkConfirmOpen(o);
				}}
				onConfirm={async () => {
					// The server caps each call at 100 ids; page bigger
					// selections client-side so "select all" on a large KB
					// still works in one confirm.
					const ids = [...selectedIds];
					const deleted: string[] = [];
					const failed: { documentId: string; message: string }[] = [];
					try {
						for (let i = 0; i < ids.length; i += 100) {
							const res = await deleteDocs.mutateAsync(ids.slice(i, i + 100));
							deleted.push(...res.deleted);
							failed.push(...res.failed);
						}
					} catch (err) {
						toast.error("Couldn't delete the selection", {
							description: formatApiError(err),
						});
						return;
					}
					if (failed.length > 0) {
						toast.warning(
							`Deleted ${deleted.length} of ${ids.length} documents`,
							{
								description: failed
									.slice(0, 5)
									.map((f) => `${f.documentId}: ${f.message}`)
									.join("\n"),
							},
						);
					} else {
						toast.success(
							`Deleted ${deleted.length} document${deleted.length === 1 ? "" : "s"}`,
							{
								description:
									"Documents and their chunks were removed from the knowledge base.",
							},
						);
					}
					setSelectedIds(new Set());
					setBulkConfirmOpen(false);
				}}
			/>

			<DeleteDocumentDialog
				doc={toDelete}
				workspace={ws.data ?? null}
				knowledgeBase={kb.data ?? null}
				submitting={deleteDoc.isPending}
				onOpenChange={(o) => !o && setToDelete(null)}
				onConfirm={async () => {
					if (!toDelete) return;
					try {
						await deleteDoc.mutateAsync(toDelete.documentId);
						toast.success(
							`Deleted '${toDelete.sourceFilename ?? toDelete.documentId}'`,
							{
								description:
									"Document and its chunks were removed from the knowledge base.",
							},
						);
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
 * Build the preview snapshot for the `deleteMany({ documentId })`
 * call the runtime will execute when the user confirms. Returns
 * `[]` for non-Astra workspaces (no Data API call to render), for
 * KBs without a bound collection name, and when any required input
 * is missing — the chip simply doesn't render in those cases.
 *
 * Preview-mode: the snapshot is built client-side from data the
 * page already has, before the DELETE endpoint is called. The
 * server doesn't echo back the actual call (the endpoint returns
 * 204 No Content) because preview-on-confirm is the highest-leverage
 * placement for destructive ops — users get to see what's about to
 * happen, not what happened.
 */
function previewDeleteSnapshots(args: {
	readonly workspace: Workspace | null;
	readonly knowledgeBase: KnowledgeBaseRecord | null;
	readonly doc: RagDocumentRecord | null;
}): AstraQuerySnapshot[] {
	const { workspace, knowledgeBase, doc } = args;
	if (!workspace || !knowledgeBase || !doc) return [];
	if (workspace.kind !== "astra" && workspace.kind !== "hcd") return [];
	if (!knowledgeBase.vectorCollection) return [];
	return [
		{
			kind: "delete_by_document",
			knowledgeBaseId: knowledgeBase.knowledgeBaseId,
			kbName: knowledgeBase.name,
			collection: knowledgeBase.vectorCollection,
			keyspace: workspace.keyspace,
			filter: { documentId: doc.documentId },
		},
	];
}

/**
 * Confirm dialog for the bulk path (#359). Mirrors the single-delete
 * dialog's framing but speaks in counts: each selected document runs
 * the same chunk-cascade the single DELETE does, server-side and
 * best-effort (per-document failures are reported, not batch-fatal).
 */
function BulkDeleteDocumentsDialog({
	open,
	count,
	submitting,
	onOpenChange,
	onConfirm,
}: {
	open: boolean;
	count: number;
	submitting: boolean;
	onOpenChange: (open: boolean) => void;
	onConfirm: () => void;
}) {
	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>
						Delete {count} document{count === 1 ? "" : "s"}
					</DialogTitle>
					<DialogDescription>
						Removes each selected document row{" "}
						<strong>and all of its chunks</strong> from the KB's vector
						collection. The original files are not deleted from your computer;
						re-uploading them will re-create the documents.
					</DialogDescription>
				</DialogHeader>
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
						disabled={submitting || count === 0}
					>
						{submitting
							? "Deleting…"
							: `Delete ${count} document${count === 1 ? "" : "s"}`}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

function DeleteDocumentDialog({
	doc,
	workspace,
	knowledgeBase,
	submitting,
	onOpenChange,
	onConfirm,
}: {
	doc: RagDocumentRecord | null;
	workspace: Workspace | null;
	knowledgeBase: KnowledgeBaseRecord | null;
	submitting: boolean;
	onOpenChange: (open: boolean) => void;
	onConfirm: () => void;
}) {
	const open = doc !== null;
	const chunkCount = doc?.chunkTotal ?? 0;
	const snapshots = previewDeleteSnapshots({ workspace, knowledgeBase, doc });
	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>Delete document</DialogTitle>
					<DialogDescription>
						Removes the document row{" "}
						<strong>
							and its{" "}
							{chunkCount === 0
								? "chunks"
								: `${chunkCount} chunk${chunkCount === 1 ? "" : "s"}`}
						</strong>{" "}
						from the KB's vector collection. The original file is not deleted
						from your computer; re-uploading it will re-create the document.
					</DialogDescription>
				</DialogHeader>

				{doc ? (
					<div className="flex items-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800">
						<FileTypeBadge
							sourceFilename={doc.sourceFilename}
							fileType={doc.fileType}
						/>
						<span className="font-medium text-slate-900 truncate dark:text-slate-100">
							{doc.sourceFilename ?? doc.documentId}
						</span>
						<span className="ml-auto text-xs text-slate-500 tabular-nums dark:text-slate-400">
							{formatFileSize(doc.fileSize)}
						</span>
					</div>
				) : null}

				{snapshots.length > 0 ? (
					<div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
						<span>See the Data API call this will run:</span>
						<AstraCodeChip
							snapshots={snapshots}
							variant="preview"
							dialogTitle="Astra deleteMany call (preview)"
							dialogDescription={`The cascade delete AI Workbench will run against ${knowledgeBase?.vectorCollection ?? "this collection"} when you confirm. Tokens and endpoint URLs are read from $ASTRA_DB_* env vars in the snippet.`}
							testId="document-delete-preview-chip"
						/>
					</div>
				) : null}

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
						disabled={submitting}
					>
						{submitting ? "Deleting…" : "Delete"}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
