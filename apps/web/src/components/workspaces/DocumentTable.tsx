import {
	ChevronDown,
	ChevronsUpDown,
	ChevronUp,
	Search,
	Trash2,
} from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatFileSize } from "@/lib/files";
import type { DocumentRecord, DocumentStatus } from "@/lib/schemas";
import { cn, formatDate } from "@/lib/utils";
import { DocumentStatusBadge } from "./DocumentStatusBadge";
import { FileTypeBadge } from "./FileTypeBadge";

type SortKey = "name" | "size" | "chunks" | "ingestedAt" | "status";
type SortDir = "asc" | "desc";

const STATUS_ORDER: Record<DocumentStatus, number> = {
	failed: 0,
	pending: 1,
	writing: 2,
	chunking: 3,
	embedding: 4,
	ready: 5,
};

/**
 * Catalog explorer table — sortable column heads, an inline search
 * over filename / source-doc-id, and a clickable row that opens the
 * document detail drawer. Empty states for the no-docs and
 * no-matches cases keep the page from looking broken before the
 * user has ingested anything.
 */
export function DocumentTable({
	docs,
	onSelect,
	onDelete,
	deletingDocumentId,
}: {
	docs: readonly DocumentRecord[];
	onSelect?: (doc: DocumentRecord) => void;
	/** When provided, a trash button renders on each row that calls
	 * back to the parent (which usually pops a confirm dialog). */
	onDelete?: (doc: DocumentRecord) => void;
	/** documentUid currently being deleted — disables that row's
	 * trash button to prevent double-clicks during the round trip. */
	deletingDocumentId?: string | null;
}) {
	const [sortKey, setSortKey] = useState<SortKey>("ingestedAt");
	const [sortDir, setSortDir] = useState<SortDir>("desc");
	const [filter, setFilter] = useState("");

	const filtered = useMemo(() => {
		const q = filter.trim().toLowerCase();
		if (!q) return docs;
		return docs.filter(
			(d) =>
				(d.sourceFilename ?? "").toLowerCase().includes(q) ||
				(d.sourceDocId ?? "").toLowerCase().includes(q) ||
				d.documentUid.toLowerCase().includes(q),
		);
	}, [docs, filter]);

	const sorted = useMemo(() => {
		const copy = [...filtered];
		copy.sort((a, b) => compare(a, b, sortKey));
		return sortDir === "asc" ? copy : copy.reverse();
	}, [filtered, sortKey, sortDir]);

	function toggleSort(key: SortKey): void {
		if (sortKey === key) {
			setSortDir((d) => (d === "asc" ? "desc" : "asc"));
		} else {
			setSortKey(key);
			// Names sort A→Z by default; everything else newest/largest first.
			setSortDir(key === "name" ? "asc" : "desc");
		}
	}

	if (docs.length === 0) {
		return (
			<div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-6 text-sm text-slate-600">
				No documents yet. Use <span className="font-medium">Ingest</span> to add
				one (or several — multi-file and folder upload are supported).
			</div>
		);
	}

	return (
		<div className="flex flex-col gap-3">
			<div className="relative max-w-xs">
				<Search
					className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400"
					aria-hidden
				/>
				<Input
					value={filter}
					onChange={(e) => setFilter(e.target.value)}
					placeholder="Filter by filename / source id…"
					className="pl-8 h-8 text-sm"
					aria-label="Filter documents"
				/>
			</div>

			<div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
				<table className="min-w-full text-sm">
					<thead className="bg-slate-50 text-xs font-medium text-slate-600">
						<tr>
							<SortHead
								active={sortKey === "name"}
								dir={sortDir}
								onClick={() => toggleSort("name")}
							>
								Name
							</SortHead>
							<th className="px-3 py-2 text-left font-medium w-16">Type</th>
							<SortHead
								active={sortKey === "size"}
								dir={sortDir}
								onClick={() => toggleSort("size")}
								className="w-24"
							>
								Size
							</SortHead>
							<SortHead
								active={sortKey === "chunks"}
								dir={sortDir}
								onClick={() => toggleSort("chunks")}
								className="w-20"
							>
								Chunks
							</SortHead>
							<SortHead
								active={sortKey === "status"}
								dir={sortDir}
								onClick={() => toggleSort("status")}
								className="w-28"
							>
								Status
							</SortHead>
							<SortHead
								active={sortKey === "ingestedAt"}
								dir={sortDir}
								onClick={() => toggleSort("ingestedAt")}
								className="w-40"
							>
								Ingested
							</SortHead>
							{onDelete ? <th className="w-12 px-3 py-2" /> : null}
						</tr>
					</thead>
					<tbody>
						{sorted.length === 0 ? (
							<tr>
								<td
									colSpan={onDelete ? 7 : 6}
									className="px-3 py-6 text-center text-xs text-slate-500"
								>
									No documents match “{filter}”.
								</td>
							</tr>
						) : (
							sorted.map((d) => (
								<tr
									key={d.documentUid}
									onClick={() => onSelect?.(d)}
									className={cn(
										"border-t border-slate-100",
										onSelect &&
											"cursor-pointer transition-colors hover:bg-slate-50",
									)}
								>
									<td className="px-3 py-2 max-w-0">
										<div className="truncate font-medium text-slate-900">
											{d.sourceFilename ?? (
												<span className="font-mono text-slate-500">
													{d.documentUid}
												</span>
											)}
										</div>
										{d.sourceDocId ? (
											<div className="truncate font-mono text-[11px] text-slate-500">
												{d.sourceDocId}
											</div>
										) : null}
									</td>
									<td className="px-3 py-2">
										<FileTypeBadge
											sourceFilename={d.sourceFilename}
											fileType={d.fileType}
										/>
									</td>
									<td className="px-3 py-2 tabular-nums text-slate-700">
										{formatFileSize(d.fileSize)}
									</td>
									<td className="px-3 py-2 tabular-nums text-slate-700">
										{d.chunkTotal ?? "—"}
									</td>
									<td className="px-3 py-2">
										<DocumentStatusBadge status={d.status} />
									</td>
									<td className="px-3 py-2 text-slate-600 text-xs">
										{d.ingestedAt
											? formatDate(d.ingestedAt)
											: formatDate(d.updatedAt)}
									</td>
									{onDelete ? (
										<td className="px-3 py-2 text-right">
											<Button
												variant="ghost"
												size="sm"
												disabled={deletingDocumentId === d.documentUid}
												onClick={(e) => {
													// Stop the row-level click that opens the
													// detail dialog — destructive actions
													// shouldn't pop a metadata view at the same
													// time.
													e.stopPropagation();
													onDelete(d);
												}}
												aria-label={`Delete ${d.sourceFilename ?? d.documentUid}`}
											>
												<Trash2 className="h-4 w-4 text-red-600" />
											</Button>
										</td>
									) : null}
								</tr>
							))
						)}
					</tbody>
				</table>
			</div>
			<p className="text-xs text-slate-500">
				{sorted.length === docs.length
					? `${docs.length} document${docs.length === 1 ? "" : "s"}`
					: `${sorted.length} of ${docs.length} document${docs.length === 1 ? "" : "s"}`}
			</p>
		</div>
	);
}

function compare(a: DocumentRecord, b: DocumentRecord, key: SortKey): number {
	switch (key) {
		case "name": {
			const an = a.sourceFilename ?? a.documentUid;
			const bn = b.sourceFilename ?? b.documentUid;
			return an.localeCompare(bn, undefined, { sensitivity: "base" });
		}
		case "size":
			return (a.fileSize ?? -1) - (b.fileSize ?? -1);
		case "chunks":
			return (a.chunkTotal ?? -1) - (b.chunkTotal ?? -1);
		case "ingestedAt": {
			const at = a.ingestedAt ?? a.updatedAt;
			const bt = b.ingestedAt ?? b.updatedAt;
			return new Date(at).getTime() - new Date(bt).getTime();
		}
		case "status":
			return STATUS_ORDER[a.status] - STATUS_ORDER[b.status];
	}
}

function SortHead({
	active,
	dir,
	onClick,
	className,
	children,
}: {
	active: boolean;
	dir: SortDir;
	onClick: () => void;
	className?: string;
	children: React.ReactNode;
}) {
	const Icon = active
		? dir === "asc"
			? ChevronUp
			: ChevronDown
		: ChevronsUpDown;
	return (
		<th className={cn("px-3 py-2 text-left font-medium", className)}>
			<button
				type="button"
				onClick={onClick}
				className={cn(
					"inline-flex items-center gap-1 hover:text-slate-900",
					active ? "text-slate-900" : "text-slate-600",
				)}
			>
				{children}
				<Icon className="h-3 w-3" aria-hidden />
			</button>
		</th>
	);
}
