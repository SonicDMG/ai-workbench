import {
	AlertTriangle,
	CheckCircle2,
	FileText,
	FolderOpen,
	Loader2,
	Plus,
	RefreshCw,
	Trash2,
	Upload,
} from "lucide-react";
import { useState } from "react";
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
import { useCatalogs, useDeleteCatalog } from "@/hooks/useCatalogs";
import { useDocuments } from "@/hooks/useDocuments";
import { formatApiError } from "@/lib/api";
import type { CatalogRecord, DocumentRecord } from "@/lib/schemas";
import { formatDate } from "@/lib/utils";
import { CreateCatalogDialog } from "./CreateCatalogDialog";
import { IngestDialog } from "./IngestDialog";
import { SavedQueriesSection } from "./SavedQueriesSection";

/**
 * Workspace-scoped catalog management + ingest trigger.
 *
 * Each row shows the catalog, its bound vector store (if any), a
 * document count, and two actions: "Ingest" (opens the ingest
 * dialog, which runs async + polls) and delete.
 *
 * Rows are expandable to show the first 10 documents in the
 * catalog — useful for the post-ingest sanity check without
 * bouncing to another page.
 */
export function CatalogsPanel({ workspace }: { workspace: string }) {
	const list = useCatalogs(workspace);
	const del = useDeleteCatalog(workspace);
	const [createOpen, setCreateOpen] = useState(false);
	const [toDelete, setToDelete] = useState<CatalogRecord | null>(null);
	const [ingestFor, setIngestFor] = useState<CatalogRecord | null>(null);
	const [expanded, setExpanded] = useState<string | null>(null);

	if (list.isLoading) return <LoadingState label="Loading catalogs…" />;
	if (list.isError) {
		return (
			<ErrorState
				title="Couldn't load catalogs"
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
					<p className="text-sm font-medium text-slate-900">Catalogs</p>
					<p className="text-xs text-slate-500 mt-0.5">
						{rows.length === 0
							? "No catalogs yet — create one to start ingesting documents."
							: `${rows.length} catalog${rows.length === 1 ? "" : "s"} in this workspace.`}
					</p>
				</div>
				<Button variant="brand" size="sm" onClick={() => setCreateOpen(true)}>
					<Plus className="h-4 w-4" /> New catalog
				</Button>
			</div>

			{rows.length === 0 ? (
				<div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-6 text-sm text-slate-600">
					A catalog is a named group of documents bound to one vector store.
					Create a vector store first (above), then create a catalog that binds
					to it, then ingest documents.
				</div>
			) : (
				<div className="flex flex-col gap-2">
					{rows.map((cat) => (
						<CatalogRow
							key={cat.uid}
							workspace={workspace}
							catalog={cat}
							expanded={expanded === cat.uid}
							onToggle={() =>
								setExpanded((cur) => (cur === cat.uid ? null : cat.uid))
							}
							onIngest={() => setIngestFor(cat)}
							onDelete={() => setToDelete(cat)}
						/>
					))}
				</div>
			)}

			<CreateCatalogDialog
				workspace={workspace}
				open={createOpen}
				onOpenChange={setCreateOpen}
			/>

			{ingestFor ? (
				<IngestDialog
					workspace={workspace}
					catalog={ingestFor}
					open={true}
					onOpenChange={(o) => !o && setIngestFor(null)}
				/>
			) : null}

			<DeleteCatalogDialog
				catalog={toDelete}
				submitting={del.isPending}
				onOpenChange={(o) => !o && setToDelete(null)}
				onConfirm={async () => {
					if (!toDelete) return;
					try {
						await del.mutateAsync(toDelete.uid);
						toast.success(`Catalog '${toDelete.name}' deleted`);
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

function CatalogRow({
	workspace,
	catalog,
	expanded,
	onToggle,
	onIngest,
	onDelete,
}: {
	workspace: string;
	catalog: CatalogRecord;
	expanded: boolean;
	onToggle: () => void;
	onIngest: () => void;
	onDelete: () => void;
}) {
	// The documents query is expensive per-catalog; only fetch when
	// the row is expanded so the collapsed list stays cheap.
	const docs = useDocuments(
		expanded ? workspace : undefined,
		expanded ? catalog.uid : undefined,
	);
	const canIngest = catalog.vectorStore !== null;

	return (
		<div className="rounded-lg border border-slate-200 bg-white">
			<div className="flex items-center gap-3 p-3">
				<button
					type="button"
					onClick={onToggle}
					className="flex min-w-0 flex-1 items-center gap-2 text-left"
					aria-expanded={expanded}
				>
					<FolderOpen className="h-4 w-4 shrink-0 text-slate-400" aria-hidden />
					<div className="min-w-0 flex-1">
						<div className="flex items-center gap-2 flex-wrap">
							<span className="font-medium text-slate-900 truncate">
								{catalog.name}
							</span>
							{catalog.vectorStore ? (
								<span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-700 border border-emerald-200">
									bound
								</span>
							) : (
								<span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-700 border border-amber-200">
									unbound
								</span>
							)}
						</div>
						{catalog.description ? (
							<p className="text-xs text-slate-500 mt-0.5 truncate">
								{catalog.description}
							</p>
						) : (
							<p className="text-xs text-slate-400 mt-0.5 font-mono truncate">
								{catalog.uid}
							</p>
						)}
					</div>
					<span className="text-xs text-slate-500 shrink-0">
						{formatDate(catalog.createdAt)}
					</span>
				</button>
				<div className="shrink-0 flex items-center gap-1">
					<Button
						variant="secondary"
						size="sm"
						onClick={onIngest}
						disabled={!canIngest}
						title={
							canIngest
								? "Ingest a document into this catalog"
								: "Bind this catalog to a vector store first"
						}
					>
						<Upload className="h-4 w-4" /> Ingest
					</Button>
					<Button
						variant="ghost"
						size="sm"
						onClick={onDelete}
						aria-label={`Delete ${catalog.name}`}
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
					<SavedQueriesSection workspace={workspace} catalogId={catalog.uid} />
				</div>
			) : null}
		</div>
	);
}

function DocumentList({ rows }: { rows: readonly DocumentRecord[] }) {
	const trimmed = rows.slice(0, 10);
	return (
		<div className="flex flex-col gap-1">
			{trimmed.map((d) => (
				<DocumentRow key={d.documentUid} doc={d} />
			))}
			{rows.length > trimmed.length ? (
				<p className="text-xs text-slate-500 pl-6">
					+ {rows.length - trimmed.length} more
				</p>
			) : null}
		</div>
	);
}

function DocumentRow({ doc }: { doc: DocumentRecord }) {
	return (
		<div className="flex items-center gap-2 rounded-md px-2 py-1.5 text-xs hover:bg-white">
			<StatusIcon status={doc.status} />
			<FileText className="h-3.5 w-3.5 text-slate-400 shrink-0" aria-hidden />
			<span className="min-w-0 truncate text-slate-700">
				{doc.sourceFilename ?? (
					<span className="font-mono text-slate-500">{doc.documentUid}</span>
				)}
			</span>
			<span className="ml-auto text-slate-400 shrink-0">
				{doc.chunkTotal !== null ? `${doc.chunkTotal} chunks` : "—"}
			</span>
		</div>
	);
}

function StatusIcon({ status }: { status: DocumentRecord["status"] }) {
	const cls = "h-3.5 w-3.5 shrink-0";
	switch (status) {
		case "ready":
			return (
				<CheckCircle2
					className={`${cls} text-emerald-600`}
					aria-label="ready"
				/>
			);
		case "failed":
			return (
				<AlertTriangle className={`${cls} text-red-600`} aria-label="failed" />
			);
		case "writing":
		case "embedding":
		case "chunking":
		case "pending":
			return (
				<Loader2
					className={`${cls} animate-spin text-slate-500`}
					aria-label={status}
				/>
			);
	}
}

function DeleteCatalogDialog({
	catalog,
	submitting,
	onOpenChange,
	onConfirm,
}: {
	catalog: CatalogRecord | null;
	submitting: boolean;
	onOpenChange: (v: boolean) => void;
	onConfirm: () => void;
}) {
	const [confirm, setConfirm] = useState("");
	const open = catalog !== null;
	const expected = catalog?.name ?? "";
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
					<DialogTitle>Delete catalog</DialogTitle>
					<DialogDescription>
						Drops the catalog and every document it holds. The vector-store
						records they wrote stay in place — search simply can't reach them
						any more through this catalog. Type{" "}
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
