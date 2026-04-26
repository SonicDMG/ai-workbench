import {
	AlertTriangle,
	CheckCircle2,
	FolderOpen,
	Loader2,
	Plus,
	Upload,
	X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { useAsyncIngest, useJobPoller } from "@/hooks/useIngest";
import { formatApiError } from "@/lib/api";
import { extOf, formatFileSize } from "@/lib/files";
import type { CatalogRecord, JobRecord } from "@/lib/schemas";
import { cn } from "@/lib/utils";
import { FileTypeBadge } from "./FileTypeBadge";

/**
 * Multi-file / folder ingest queue.
 *
 * Drag-drop one or more files (or pick a folder via the directory
 * picker) and watch them ingest one at a time. Each row shows live
 * progress for the active file plus terminal status for everything
 * before it. Sequential ingest (rather than parallel) keeps the
 * runtime's embedding-provider rate limits predictable and the
 * progress UI legible — operators ingesting "all our docs at once"
 * don't tend to need parallelism, and a misbehaving file shouldn't
 * tank the others.
 *
 * Same readability and size guards as the single-file `IngestDialog`:
 * text-ish extensions only, 5 MB per file. Binaries get rejected
 * inline rather than silently dropped from the queue so the user
 * can fix the source set.
 */

const READABLE_EXTENSIONS = [
	".txt",
	".md",
	".markdown",
	".mdx",
	".rst",
	".json",
	".jsonl",
	".ndjson",
	".csv",
	".tsv",
	".log",
	".xml",
	".html",
	".htm",
	".yaml",
	".yml",
	".toml",
];
const MAX_BYTES = 5 * 1024 * 1024;

type QueueStatus = "queued" | "running" | "succeeded" | "failed";

interface QueueItem {
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

function isReadable(file: File): boolean {
	const name = file.name.toLowerCase();
	if (READABLE_EXTENSIONS.some((ext) => name.endsWith(ext))) return true;
	return (
		file.type.startsWith("text/") ||
		file.type === "application/json" ||
		file.type === "application/xml"
	);
}

export function IngestQueueDialog({
	workspace,
	catalog,
	open,
	onOpenChange,
}: {
	workspace: string;
	catalog: CatalogRecord;
	open: boolean;
	onOpenChange: (v: boolean) => void;
}) {
	const [items, setItems] = useState<QueueItem[]>([]);
	const [activeId, setActiveId] = useState<string | null>(null);
	const [draining, setDraining] = useState(false);
	const [dragActive, setDragActive] = useState(false);
	const fileInputRef = useRef<HTMLInputElement | null>(null);
	const folderInputRef = useRef<HTMLInputElement | null>(null);

	const ingest = useAsyncIngest(workspace, catalog.uid);
	// Drives only the *active* row's poller. Each row shows a live
	// snapshot from this hook while it's the head of the queue. We
	// derive the jobId from items+activeId synchronously each render
	// rather than holding it on its own state — keeps the queue and
	// the poller in lockstep without a redundant setState.
	const activeJobId = items.find((i) => i.id === activeId)?.jobId ?? null;
	const poll = useJobPoller(workspace, activeJobId ?? undefined);

	function close(): void {
		setItems([]);
		setActiveId(null);
		setDraining(false);
		setDragActive(false);
		onOpenChange(false);
	}

	function handleOpenChange(next: boolean): void {
		// Don't lose in-flight queue state if the user clicks outside while
		// draining — close button is the explicit out.
		if (!next && draining) return;
		if (!next) close();
		else onOpenChange(true);
	}

	const enqueue = useCallback((files: FileList | File[]): void => {
		const accepted: QueueItem[] = [];
		const rejected: { name: string; reason: string }[] = [];
		for (const file of Array.from(files)) {
			// `webkitRelativePath` is empty for plain file picks; non-empty
			// only for the directory picker (and drag-drop'd folders).
			const relative = file.webkitRelativePath || file.name;
			if (!isReadable(file)) {
				rejected.push({ name: relative, reason: "unsupported file type" });
				continue;
			}
			if (file.size > MAX_BYTES) {
				rejected.push({
					name: relative,
					reason: `${(file.size / 1024 / 1024).toFixed(1)} MB > ${MAX_BYTES / 1024 / 1024} MB cap`,
				});
				continue;
			}
			accepted.push({
				id: `${relative}-${file.size}-${file.lastModified}`,
				file,
				relativePath: relative,
				status: "queued",
				jobId: null,
				processed: 0,
				total: null,
				errorMessage: null,
				chunkCount: null,
			});
		}
		if (accepted.length > 0) {
			setItems((cur) => {
				// Skip duplicates (same id) so re-dropping a folder doesn't
				// double-queue.
				const have = new Set(cur.map((i) => i.id));
				return [...cur, ...accepted.filter((a) => !have.has(a.id))];
			});
		}
		if (rejected.length > 0) {
			toast.warning(
				`Skipped ${rejected.length} file${rejected.length === 1 ? "" : "s"}`,
				{
					description: rejected
						.slice(0, 6)
						.map((r) => `${r.name}: ${r.reason}`)
						.join("\n"),
				},
			);
		}
	}, []);

	function removeItem(id: string): void {
		setItems((cur) => cur.filter((i) => i.id !== id || i.status === "running"));
	}

	const updateItem = useCallback(
		(id: string, patch: Partial<QueueItem>): void => {
			setItems((cur) => cur.map((i) => (i.id === id ? { ...i, ...patch } : i)));
		},
		[],
	);

	// Drive the queue: when no item is active and there are pending
	// items, take the next one and kick its ingest. When the active
	// item terminates, advance.
	useEffect(() => {
		if (!draining) return;
		if (activeId !== null) return;
		const next = items.find((i) => i.status === "queued");
		if (!next) {
			setDraining(false);
			return;
		}
		(async () => {
			let text: string;
			try {
				text = await next.file.text();
			} catch (err) {
				updateItem(next.id, {
					status: "failed",
					errorMessage: err instanceof Error ? err.message : "read failed",
				});
				return;
			}
			try {
				const res = await ingest.mutateAsync({
					text,
					sourceFilename: next.relativePath,
					fileType: next.file.type || extOf(next.relativePath) || null,
					fileSize: next.file.size,
				});
				updateItem(next.id, {
					status: "running",
					jobId: res.job.jobId,
				});
				setActiveId(next.id);
			} catch (err) {
				updateItem(next.id, {
					status: "failed",
					errorMessage: formatApiError(err),
				});
			}
		})();
	}, [draining, activeId, items, ingest, updateItem]);

	// Wire the active poller's snapshot back into the queue row so the
	// table reflects live progress.
	//
	// Deps are deliberately limited to `[activeId, poll.data]`. We
	// **don't** depend on `activeItem` here (the object reference
	// churns every time `setItems` returns a new array), and we
	// **don't** depend on `updateItem` (its identity is stable from
	// `useCallback([])` but including it loses nothing). The body
	// mutates `items` via `setItems` — and is idempotent: when the
	// poll snapshot already matches the row, the updater returns the
	// same array reference so React doesn't re-render. Without the
	// idempotency, an active job in `running` state with non-changing
	// `processed`/`total` would loop: setItems → new item ref →
	// effect re-fires → setItems → loop, until React bails with
	// "Maximum update depth exceeded".
	useEffect(() => {
		if (!activeId || !poll.data) return;
		const job: JobRecord = poll.data;
		setItems((cur) => {
			const idx = cur.findIndex((i) => i.id === activeId);
			if (idx < 0) return cur;
			const prev = cur[idx] as QueueItem;
			const chunks =
				job.result && typeof job.result.chunks === "number"
					? job.result.chunks
					: null;
			const nextStatus: QueueItem["status"] =
				job.status === "succeeded"
					? "succeeded"
					: job.status === "failed"
						? "failed"
						: prev.status;
			const nextErr =
				job.status === "failed" ? job.errorMessage : prev.errorMessage;
			const nextChunks = job.status === "succeeded" ? chunks : prev.chunkCount;
			if (
				prev.processed === job.processed &&
				prev.total === job.total &&
				prev.status === nextStatus &&
				prev.errorMessage === nextErr &&
				prev.chunkCount === nextChunks
			) {
				return cur;
			}
			const next: QueueItem = {
				...prev,
				processed: job.processed,
				total: job.total,
				status: nextStatus,
				errorMessage: nextErr,
				chunkCount: nextChunks,
			};
			const arr = [...cur];
			arr[idx] = next;
			return arr;
		});
		if (job.status === "succeeded" || job.status === "failed") {
			setActiveId(null);
		}
	}, [activeId, poll.data]);

	function startDrain(): void {
		setDraining(true);
	}

	const counts = useMemo(() => {
		const c = { queued: 0, running: 0, succeeded: 0, failed: 0 };
		for (const i of items) c[i.status] += 1;
		return c;
	}, [items]);

	const allDone =
		items.length > 0 &&
		items.every((i) => i.status === "succeeded" || i.status === "failed");
	const anyQueued = counts.queued > 0;

	return (
		<Dialog open={open} onOpenChange={handleOpenChange}>
			<DialogContent className="max-w-2xl">
				<DialogHeader>
					<DialogTitle>Ingest into "{catalog.name}"</DialogTitle>
					<DialogDescription>
						Drop one or more files, or a folder. Each file becomes a separate
						document; ingests run sequentially through the bound vector store.
					</DialogDescription>
				</DialogHeader>

				{/* biome-ignore lint/a11y/noStaticElementInteractions: drop zone
				    is a pointer affordance; keyboard users get the in-zone
				    "browse" + "folder" buttons. */}
				<div
					onDragOver={(e) => {
						if (draining) return;
						e.preventDefault();
						setDragActive(true);
					}}
					onDragLeave={() => setDragActive(false)}
					onDrop={(e) => {
						if (draining) return;
						e.preventDefault();
						setDragActive(false);
						if (e.dataTransfer.files.length > 0) {
							enqueue(e.dataTransfer.files);
						}
					}}
					className={cn(
						"flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed p-5 text-sm transition-colors",
						dragActive
							? "border-[var(--color-brand-500)] bg-[var(--color-brand-50)]"
							: "border-slate-300 bg-slate-50",
						draining && "opacity-60",
					)}
				>
					<input
						ref={fileInputRef}
						type="file"
						multiple
						accept={READABLE_EXTENSIONS.join(",")}
						className="hidden"
						onChange={(e) => {
							if (e.target.files) enqueue(e.target.files);
							e.target.value = "";
						}}
					/>
					<input
						ref={folderInputRef}
						type="file"
						multiple
						className="hidden"
						// webkitdirectory is the cross-browser folder picker.
						// Not in stock React HTMLAttributes; cast escape hatch.
						{...({ webkitdirectory: "", directory: "" } as Record<
							string,
							string
						>)}
						onChange={(e) => {
							if (e.target.files) enqueue(e.target.files);
							e.target.value = "";
						}}
					/>

					<Upload className="h-5 w-5 text-slate-400" aria-hidden />
					<p className="text-slate-700">
						Drop files or a folder, or use a button below.
					</p>
					<div className="flex flex-wrap items-center gap-2">
						<Button
							type="button"
							variant="secondary"
							size="sm"
							onClick={() => fileInputRef.current?.click()}
							disabled={draining}
						>
							<Plus className="h-4 w-4" /> Files…
						</Button>
						<Button
							type="button"
							variant="secondary"
							size="sm"
							onClick={() => folderInputRef.current?.click()}
							disabled={draining}
						>
							<FolderOpen className="h-4 w-4" /> Folder…
						</Button>
					</div>
					<p className="text-xs text-slate-500">
						Text, Markdown, JSON, CSV, YAML, … up to {MAX_BYTES / 1024 / 1024}{" "}
						MB each.
					</p>
				</div>

				{items.length > 0 ? (
					<div className="flex flex-col gap-2">
						<div className="flex items-center justify-between text-xs text-slate-600">
							<span>
								{items.length} file{items.length === 1 ? "" : "s"} queued
								{counts.succeeded + counts.failed > 0
									? ` — ${counts.succeeded} done, ${counts.failed} failed`
									: ""}
							</span>
							{!draining && counts.queued > 0 ? (
								<button
									type="button"
									className="text-xs text-slate-500 hover:text-slate-900"
									onClick={() =>
										setItems((cur) => cur.filter((i) => i.status === "running"))
									}
								>
									Clear queue
								</button>
							) : null}
						</div>
						<div className="max-h-72 overflow-y-auto rounded-lg border border-slate-200">
							<ul className="divide-y divide-slate-100">
								{items.map((item) => (
									<QueueRow
										key={item.id}
										item={item}
										draining={draining}
										onRemove={() => removeItem(item.id)}
									/>
								))}
							</ul>
						</div>
					</div>
				) : null}

				<DialogFooter>
					<Button
						type="button"
						variant="ghost"
						onClick={close}
						disabled={draining}
					>
						{allDone ? "Close" : "Cancel"}
					</Button>
					<Button
						type="button"
						variant="brand"
						onClick={startDrain}
						disabled={draining || !anyQueued}
					>
						{draining ? (
							<>
								<Loader2 className="h-4 w-4 animate-spin" /> Ingesting…
							</>
						) : (
							`Start ingest (${counts.queued})`
						)}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

function QueueRow({
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
