import {
	AlertTriangle,
	CheckCircle2,
	CircleSlash,
	Loader2,
	X,
} from "lucide-react";
import { AstraCodeChip } from "@/components/astra/AstraCodeChip";
import { formatFileSize } from "@/lib/files";
import type { AstraQuerySnapshot } from "@/lib/schemas";
import { cn } from "@/lib/utils";
import { FileTypeBadge } from "./FileTypeBadge";

/**
 * Per-file lifecycle in the queue.
 *
 * - `queued`: dropped but not yet started
 * - `running`: ingest job in flight; poller wired up
 * - `succeeded`: ingest finished and produced chunks
 * - `failed`: ingest job (or read) errored
 * - `skipped`: server returned the dedup envelope — content hash matched
 *   an existing doc in the same KB and we re-used it without re-running
 *   the pipeline. Treated as a non-error terminal state.
 */
export type QueueStatus =
	| "queued"
	| "running"
	| "succeeded"
	| "failed"
	| "skipped";

export interface QueueItem {
	readonly id: string;
	readonly file: File;
	readonly relativePath: string;
	status: QueueStatus;
	jobId: string | null;
	processed: number;
	total: number | null;
	errorMessage: string | null;
	chunkCount: number | null;
	/** Astra Data API calls the runtime made (or is about to make)
	 * for this row. Populated when the ingest call returns —
	 * representative `insert_chunks` snapshot for Astra/HCD
	 * workspaces. Empty for non-Astra workspaces and for rows that
	 * short-circuited to `duplicate` (no pipeline ran). The chip is
	 * rendered inline in the row when the list is non-empty. */
	snapshots: readonly AstraQuerySnapshot[];
}

export function QueueRow({
	item,
	draining,
	onRemove,
}: {
	item: QueueItem;
	draining: boolean;
	onRemove: () => void;
}) {
	const percent =
		item.total && item.total > 0
			? Math.min(100, Math.round((item.processed / item.total) * 100))
			: null;
	return (
		<li className="flex items-start gap-3 px-3 py-2 text-sm">
			<StatusGlyph status={item.status} />
			<div className="min-w-0 flex-1">
				<div className="flex min-w-0 items-center gap-2">
					<FileTypeBadge
						sourceFilename={item.relativePath}
						className="shrink-0"
					/>
					<span
						className="truncate font-medium text-slate-900 dark:text-slate-100"
						title={item.relativePath}
					>
						{item.relativePath}
					</span>
				</div>
				<div className="mt-0.5 flex min-w-0 items-center gap-3 text-xs text-slate-500 dark:text-slate-400">
					<span>{formatFileSize(item.file.size)}</span>
					{item.status === "running" ? (
						<span className="tabular-nums">
							{item.processed}/{item.total ?? "?"} chunks
						</span>
					) : null}
					{item.status === "succeeded" && item.chunkCount !== null ? (
						<span>
							{item.chunkCount} chunk{item.chunkCount === 1 ? "" : "s"}
						</span>
					) : null}
					{item.status === "skipped" ? (
						<span className="text-slate-600 dark:text-slate-400">
							already ingested — content hash matched existing document
						</span>
					) : null}
					{item.status === "failed" && item.errorMessage ? (
						<span className="text-red-700 truncate dark:text-red-300">
							{item.errorMessage}
						</span>
					) : null}
					{item.snapshots.length > 0 &&
					(item.status === "running" || item.status === "succeeded") ? (
						<AstraCodeChip
							snapshots={item.snapshots}
							dialogTitle="Astra insertMany call"
							dialogDescription="The representative chunk-batch insert AI Workbench runs during ingest. The actual pipeline repeats this call once per chunk batch until the document is fully written."
							footer={`This call repeats for each batch of chunks the pipeline writes for '${item.relativePath}'.`}
							testId="ingest-queue-code-chip"
						/>
					) : null}
				</div>
				{percent !== null && item.status === "running" ? (
					<div className="mt-1.5 h-1 rounded-full bg-slate-200 overflow-hidden dark:bg-slate-700">
						<div
							className="h-full bg-[var(--color-brand-500)] transition-[width] duration-200"
							style={{ width: `${percent}%` }}
						/>
					</div>
				) : null}
			</div>
			{!draining && item.status === "queued" ? (
				<button
					type="button"
					onClick={onRemove}
					className="text-slate-400 hover:text-slate-700 dark:text-slate-500 dark:hover:text-slate-200"
					aria-label={`Remove ${item.relativePath}`}
				>
					<X className="h-4 w-4" />
				</button>
			) : null}
		</li>
	);
}

function StatusGlyph({ status }: { status: QueueStatus }) {
	const cls = "h-4 w-4 mt-0.5 shrink-0";
	switch (status) {
		case "queued":
			return (
				<div
					className={cn(
						cls,
						"rounded-full border border-slate-300 dark:border-slate-600",
					)}
				/>
			);
		case "running":
			return (
				<Loader2
					className={cn(cls, "animate-spin text-slate-500 dark:text-slate-400")}
				/>
			);
		case "succeeded":
			return <CheckCircle2 className={cn(cls, "text-emerald-600")} />;
		case "skipped":
			return (
				<CircleSlash
					className={cn(cls, "text-slate-500 dark:text-slate-400")}
				/>
			);
		case "failed":
			return <AlertTriangle className={cn(cls, "text-red-600")} />;
	}
}
