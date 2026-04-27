import type { UseQueryResult } from "@tanstack/react-query";
import { Hash, Loader2 } from "lucide-react";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { useDocumentChunks } from "@/hooks/useDocuments";
import { formatFileSize } from "@/lib/files";
import type { DocumentChunk, RagDocumentRecord } from "@/lib/schemas";
import { formatDate } from "@/lib/utils";
import { DocumentStatusBadge } from "./DocumentStatusBadge";
import { FileTypeBadge } from "./FileTypeBadge";

/**
 * Read-only metadata view for one KB document. Opens from the
 * KB-explorer's row click. Shows everything the runtime persists on
 * `RagDocumentRecord` plus the failure message verbatim when the
 * document is in `failed` state.
 */
export function DocumentDetailDialog({
	workspace,
	knowledgeBaseUid,
	doc,
	onOpenChange,
}: {
	workspace: string;
	knowledgeBaseUid: string;
	doc: RagDocumentRecord | null;
	onOpenChange: (open: boolean) => void;
}) {
	const open = doc !== null;
	const chunks = useDocumentChunks(
		workspace,
		knowledgeBaseUid,
		doc?.documentId,
		{ enabled: open && doc?.status === "ready" },
	);
	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="max-w-2xl">
				<DialogHeader>
					<DialogTitle className="flex items-center gap-2 break-all">
						{doc ? (
							<>
								<FileTypeBadge
									sourceFilename={doc.sourceFilename}
									fileType={doc.fileType}
								/>
								<span className="text-base">
									{doc.sourceFilename ?? doc.documentId}
								</span>
							</>
						) : (
							"Document"
						)}
					</DialogTitle>
					<DialogDescription>
						Read-only view. Re-ingest by uploading the file again — chunk IDs
						are deterministic so the upsert is idempotent.
					</DialogDescription>
				</DialogHeader>

				{doc ? (
					<div className="flex flex-col gap-4 text-sm">
						<div className="flex flex-wrap items-center gap-3">
							<DocumentStatusBadge status={doc.status} />
							<span className="text-slate-500 text-xs">
								Ingested{" "}
								{doc.ingestedAt ? formatDate(doc.ingestedAt) : "(pending)"}
							</span>
							<span className="text-slate-500 text-xs">
								Updated {formatDate(doc.updatedAt)}
							</span>
						</div>

						{doc.status === "failed" && doc.errorMessage ? (
							<div className="rounded-md border border-red-200 bg-red-50 p-3 text-xs text-red-900">
								<p className="font-medium mb-1">Error</p>
								<p className="font-mono break-words whitespace-pre-wrap">
									{doc.errorMessage}
								</p>
							</div>
						) : null}

						<div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3">
							<KV label="Document UID" value={doc.documentId} mono />
							<KV label="Source ID" value={doc.sourceDocId ?? "—"} mono />
							<KV
								label="Size"
								value={formatFileSize(doc.fileSize)}
								icon={<Hash className="h-3 w-3 text-slate-400" aria-hidden />}
							/>
							<KV
								label="Chunks"
								value={doc.chunkTotal !== null ? String(doc.chunkTotal) : "—"}
							/>
							<KV label="MIME / type" value={doc.fileType ?? "—"} mono />
							<KV label="Content hash" value={doc.contentHash ?? "—"} mono />
						</div>

						{Object.keys(doc.metadata).length > 0 ? (
							<div className="flex flex-col gap-1.5">
								<p className="text-xs font-medium uppercase tracking-wider text-slate-500">
									Metadata
								</p>
								<div className="rounded-md border border-slate-200 bg-slate-50 p-3 text-xs font-mono">
									<dl className="grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1">
										{Object.entries(doc.metadata).map(([k, v]) => (
											<div key={k} className="contents">
												<dt className="text-slate-500">{k}</dt>
												<dd className="text-slate-900 break-words">
													{String(v)}
												</dd>
											</div>
										))}
									</dl>
								</div>
							</div>
						) : null}

						{doc.status === "ready" ? (
							<div className="flex flex-col gap-1.5">
								<p className="text-xs font-medium uppercase tracking-wider text-slate-500">
									Chunks
									{chunks.data ? (
										<span className="ml-2 text-slate-400">
											({chunks.data.length})
										</span>
									) : null}
								</p>
								<ChunksList query={chunks} />
							</div>
						) : null}
					</div>
				) : null}
			</DialogContent>
		</Dialog>
	);
}

function KV({
	label,
	value,
	mono,
	icon,
}: {
	label: string;
	value: string;
	mono?: boolean;
	icon?: React.ReactNode;
}) {
	return (
		<div className="flex flex-col gap-0.5">
			<span className="text-[10px] font-medium uppercase tracking-wider text-slate-500 inline-flex items-center gap-1">
				{icon}
				{label}
			</span>
			<span className={mono ? "font-mono text-xs break-all" : "text-slate-900"}>
				{value}
			</span>
		</div>
	);
}

function ChunksList({
	query,
}: {
	query: UseQueryResult<DocumentChunk[], Error>;
}) {
	if (query.isLoading) {
		return (
			<p className="inline-flex items-center gap-2 text-xs text-slate-500">
				<Loader2 className="h-3 w-3 animate-spin" /> Loading chunks…
			</p>
		);
	}
	if (query.isError) {
		return (
			<p className="text-xs text-red-700">
				Couldn't load chunks: {query.error.message}
			</p>
		);
	}
	const chunks = query.data ?? [];
	if (chunks.length === 0) {
		return (
			<p className="text-xs text-slate-500">
				No chunks under this document. (Drivers without `listRecords` return 501
				here — the runtime falls back to the empty list.)
			</p>
		);
	}
	return (
		<ol className="flex flex-col gap-1.5 max-h-72 overflow-y-auto rounded-md border border-slate-200 bg-white p-2">
			{chunks.map((c) => (
				<li
					key={c.id}
					className="rounded-md border border-slate-100 bg-slate-50 p-2 text-xs"
				>
					<div className="flex items-baseline gap-2">
						<span className="rounded-full bg-slate-200 px-1.5 py-0.5 text-[10px] font-medium text-slate-700 tabular-nums">
							#{c.chunkIndex ?? "—"}
						</span>
						<span className="font-mono text-[10px] text-slate-400 truncate">
							{c.id}
						</span>
					</div>
					{c.text ? (
						<p className="mt-1 whitespace-pre-wrap break-words text-slate-700 leading-snug">
							{c.text}
						</p>
					) : (
						<p className="mt-1 text-slate-400 italic">
							(text not stored — older ingest, before the chunkText payload key
							landed)
						</p>
					)}
				</li>
			))}
		</ol>
	);
}
