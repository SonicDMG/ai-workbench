import { Hash } from "lucide-react";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { formatFileSize } from "@/lib/files";
import type { DocumentRecord } from "@/lib/schemas";
import { formatDate } from "@/lib/utils";
import { DocumentStatusBadge } from "./DocumentStatusBadge";
import { FileTypeBadge } from "./FileTypeBadge";

/**
 * Read-only metadata view for one document. Opens from the catalog
 * explorer's row click. Shows everything the runtime persists on
 * `DocumentRecord` plus the failure message verbatim when the
 * document is in `failed` state.
 *
 * Re-ingest, delete, and chunk-preview affordances are deliberately
 * absent — they need bulk-doc API surface that hasn't shipped yet.
 */
export function DocumentDetailDialog({
	doc,
	onOpenChange,
}: {
	doc: DocumentRecord | null;
	onOpenChange: (open: boolean) => void;
}) {
	const open = doc !== null;
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
									{doc.sourceFilename ?? doc.documentUid}
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
							<KV label="Document UID" value={doc.documentUid} mono />
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
							<KV label="MD5" value={doc.md5Hash ?? "—"} mono />
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
												<dd className="text-slate-900 break-words">{v}</dd>
											</div>
										))}
									</dl>
								</div>
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
