import { ArrowLeft, Database, RefreshCw, Sparkles, Upload } from "lucide-react";
import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { toast } from "sonner";
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
import { FileTypeBadge } from "@/components/workspaces/FileTypeBadge";
import { IngestQueueDialog } from "@/components/workspaces/IngestQueueDialog";
import { useDeleteDocument, useDocuments } from "@/hooks/useDocuments";
import { useKnowledgeBase } from "@/hooks/useKnowledgeBases";
import { useWorkspace } from "@/hooks/useWorkspaces";
import { formatApiError } from "@/lib/api";
import { formatFileSize } from "@/lib/files";
import type { RagDocumentRecord } from "@/lib/schemas";

/**
 * Knowledge-base explorer — `/workspaces/:wid/knowledge-bases/:kbid`.
 * Shows the documents in one KB as a sortable, searchable table with
 * file-type badges, sizes, statuses, and an inline detail dialog.
 *
 * The "Ingest" button pops the multi-file / folder queue.
 */
export function KnowledgeBaseExplorerPage() {
	const params = useParams<{
		workspaceUid: string;
		knowledgeBaseUid: string;
	}>();
	const workspaceUid = params.workspaceUid;
	const knowledgeBaseUid = params.knowledgeBaseUid;

	const ws = useWorkspace(workspaceUid);
	const kb = useKnowledgeBase(workspaceUid, knowledgeBaseUid);
	const docs = useDocuments(workspaceUid, knowledgeBaseUid);

	const [ingestOpen, setIngestOpen] = useState(false);
	const [detail, setDetail] = useState<RagDocumentRecord | null>(null);
	const [toDelete, setToDelete] = useState<RagDocumentRecord | null>(null);
	const deleteDoc = useDeleteDocument(
		workspaceUid ?? "",
		knowledgeBaseUid ?? "",
	);

	if (!workspaceUid || !knowledgeBaseUid) {
		return (
			<ErrorState
				title="Invalid URL"
				message="Missing workspace or knowledge-base UID."
			/>
		);
	}

	if (ws.isLoading || kb.isLoading) {
		return <LoadingState label="Loading knowledge base…" />;
	}
	if (ws.isError) {
		return (
			<ErrorState title="Couldn't load workspace" message={ws.error.message} />
		);
	}
	if (kb.isError || !kb.data) {
		return (
			<div className="mx-auto max-w-3xl px-6 py-10">
				<ErrorState
					title="Knowledge base not found"
					message={
						kb.error?.message ??
						`No knowledge base ${knowledgeBaseUid} in this workspace.`
					}
					actions={
						<Button variant="secondary" asChild>
							<Link to={`/workspaces/${workspaceUid}`}>
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
					to={`/workspaces/${workspaceUid}`}
					className="inline-flex items-center gap-1 text-sm text-slate-600 hover:text-slate-900 w-max"
				>
					<ArrowLeft className="h-4 w-4" />
					{ws.data?.name ?? "Workspace"}
				</Link>
				<div className="flex flex-wrap items-start justify-between gap-3">
					<div className="flex items-start gap-3">
						<Database className="h-7 w-7 text-slate-400 mt-1" aria-hidden />
						<div>
							<h1 className="text-2xl font-semibold text-slate-900">
								{knowledgeBase.name}
							</h1>
							{knowledgeBase.description ? (
								<p className="text-sm text-slate-600">
									{knowledgeBase.description}
								</p>
							) : (
								<p className="text-xs text-slate-500 font-mono">
									{knowledgeBase.knowledgeBaseId}
								</p>
							)}
						</div>
					</div>
					<div className="flex items-center gap-2">
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
						>
							<Upload className="h-4 w-4" /> Ingest
						</Button>
						<Button variant="brand" size="sm" asChild>
							<Link
								to={`/workspaces/${workspaceUid}/knowledge-bases/${knowledgeBaseUid}/playground`}
							>
								<Sparkles className="h-4 w-4" /> Playground
							</Link>
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
							message={docs.error.message}
							actions={
								<Button variant="secondary" onClick={() => docs.refetch()}>
									<RefreshCw className="h-4 w-4" /> Retry
								</Button>
							}
						/>
					) : (
						<DocumentTable
							docs={docs.data ?? []}
							onSelect={(d) => setDetail(d)}
							onDelete={(d) => setToDelete(d)}
							deletingDocumentId={
								deleteDoc.isPending ? (deleteDoc.variables ?? null) : null
							}
						/>
					)}
				</CardContent>
			</Card>

			<IngestQueueDialog
				workspace={workspaceUid}
				knowledgeBase={knowledgeBase}
				open={ingestOpen}
				onOpenChange={setIngestOpen}
			/>
			<DocumentDetailDialog
				workspace={workspaceUid}
				knowledgeBaseUid={knowledgeBase.knowledgeBaseId}
				doc={detail}
				onOpenChange={(o) => !o && setDetail(null)}
			/>

			<DeleteDocumentDialog
				doc={toDelete}
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

function DeleteDocumentDialog({
	doc,
	submitting,
	onOpenChange,
	onConfirm,
}: {
	doc: RagDocumentRecord | null;
	submitting: boolean;
	onOpenChange: (open: boolean) => void;
	onConfirm: () => void;
}) {
	const open = doc !== null;
	const chunkCount = doc?.chunkTotal ?? 0;
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
					<div className="flex items-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm">
						<FileTypeBadge
							sourceFilename={doc.sourceFilename}
							fileType={doc.fileType}
						/>
						<span className="font-medium text-slate-900 truncate">
							{doc.sourceFilename ?? doc.documentId}
						</span>
						<span className="ml-auto text-xs text-slate-500 tabular-nums">
							{formatFileSize(doc.fileSize)}
						</span>
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
