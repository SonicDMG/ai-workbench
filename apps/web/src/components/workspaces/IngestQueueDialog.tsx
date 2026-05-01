import { Loader2 } from "lucide-react";
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
import { extOf, isReadableTextFile } from "@/lib/files";
import type { JobRecord, KnowledgeBaseRecord } from "@/lib/schemas";
import { IngestDropZone } from "./IngestDropZone";
import { type QueueItem, QueueRow } from "./IngestQueueRow";

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
 * Text-ish extensions only, 5 MB per file. Binaries get rejected inline
 * rather than silently dropped from the queue so the user can fix the
 * source set. The drop zone lives in {@link IngestDropZone}; the
 * per-file row + progress bar live in {@link QueueRow}.
 */

const MAX_BYTES = 5 * 1024 * 1024;

export function IngestQueueDialog({
	workspace,
	knowledgeBase,
	open,
	onOpenChange,
}: {
	workspace: string;
	knowledgeBase: KnowledgeBaseRecord;
	open: boolean;
	onOpenChange: (v: boolean) => void;
}) {
	const [items, setItems] = useState<QueueItem[]>([]);
	const [activeId, setActiveId] = useState<string | null>(null);
	const [draining, setDraining] = useState(false);

	const ingest = useAsyncIngest(workspace, knowledgeBase.knowledgeBaseId);
	// Drives only the *active* row's poller. Each row shows a live
	// snapshot from this hook while it's the head of the queue. We
	// derive the jobId from items+activeId synchronously each render
	// rather than holding it on its own state — keeps the queue and
	// the poller in lockstep without a redundant setState.
	const activeJobId = items.find((i) => i.id === activeId)?.jobId ?? null;
	const poll = useJobPoller(workspace, activeJobId ?? undefined);

	// Re-entry guard for the drain effect. `useMutation`'s return
	// object changes ref every time `isPending` flips; if `ingest`
	// were in the effect deps the drain effect would re-fire mid-
	// `await ingest.mutateAsync(...)` (between mutation start and
	// setActiveId) and double-kick the same file. The user-visible
	// symptom: eight duplicate Document rows for one upload, plus
	// React #185 ("Maximum update depth exceeded") once the
	// ricochet pile-up gets dense enough. The ref is set when an
	// async ingest is in flight and cleared when it terminates;
	// the effect bails fast while it's set.
	const kickInFlight = useRef(false);
	// Stable handle to `ingest.mutateAsync`. Tracking this through a
	// ref lets us drop `ingest` from the drain effect's deps (its
	// identity churns on every `isPending` flip; see above) without
	// referencing a stale closure. Per TanStack Query's contract the
	// underlying function is stable across renders, so a single
	// assign-on-render is enough.
	const ingestMutateAsyncRef = useRef(ingest.mutateAsync);
	ingestMutateAsyncRef.current = ingest.mutateAsync;

	function close(): void {
		setItems([]);
		setActiveId(null);
		setDraining(false);
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
			if (!isReadableTextFile(file)) {
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
	//
	// `ingest` is intentionally **not** in the deps. `useMutation`'s
	// return object changes ref every time `isPending` flips, which
	// would re-fire this effect mid-`await mutateAsync(...)` —
	// before we've reached `setActiveId(next.id)` — and cause the
	// effect to kick a second mutation for the same file. We
	// belt-and-suspenders that with the `kickInFlight` ref so even
	// if `items` churn during the await window re-fires the
	// effect, we won't re-enter the dispatch block.
	//
	// `mutateAsync` itself is a stable function across renders per
	// TanStack Query's contract, so closing over the latest
	// `ingest.mutateAsync` from any render is fine.
	useEffect(() => {
		if (!draining) return;
		if (activeId !== null) return;
		if (kickInFlight.current) return;
		const next = items.find((i) => i.status === "queued");
		if (!next) {
			setDraining(false);
			return;
		}
		kickInFlight.current = true;
		(async () => {
			try {
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
					const res = await ingestMutateAsyncRef.current({
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
			} finally {
				kickInFlight.current = false;
			}
		})();
	}, [draining, activeId, items, updateItem]);

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
					<DialogTitle>Ingest into "{knowledgeBase.name}"</DialogTitle>
					<DialogDescription>
						Drop one or more files, or a folder. Each file becomes a separate
						document; ingests run sequentially through the KB's bound chunking +
						embedding services.
					</DialogDescription>
				</DialogHeader>

				<IngestDropZone
					maxBytes={MAX_BYTES}
					disabled={draining}
					onFiles={enqueue}
				/>

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
