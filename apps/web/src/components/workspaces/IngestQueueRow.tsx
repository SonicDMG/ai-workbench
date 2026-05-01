import { AlertTriangle, CheckCircle2, Loader2, X } from "lucide-react";
import { formatFileSize } from "@/lib/files";
import { cn } from "@/lib/utils";
import { FileTypeBadge } from "./FileTypeBadge";

export type QueueStatus = "queued" | "running" | "succeeded" | "failed";

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
				<div className="flex items-center gap-2">
					<FileTypeBadge sourceFilename={item.relativePath} />
					<span className="truncate font-medium text-slate-900">
						{item.relativePath}
					</span>
				</div>
				<div className="mt-0.5 flex items-center gap-3 text-xs text-slate-500">
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
					{item.status === "failed" && item.errorMessage ? (
						<span className="text-red-700 truncate">{item.errorMessage}</span>
					) : null}
				</div>
				{percent !== null && item.status === "running" ? (
					<div className="mt-1.5 h-1 rounded-full bg-slate-200 overflow-hidden">
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
					className="text-slate-400 hover:text-slate-700"
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
				<div className={cn(cls, "rounded-full border border-slate-300")} />
			);
		case "running":
			return <Loader2 className={cn(cls, "animate-spin text-slate-500")} />;
		case "succeeded":
			return <CheckCircle2 className={cn(cls, "text-emerald-600")} />;
		case "failed":
			return <AlertTriangle className={cn(cls, "text-red-600")} />;
	}
}
