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
import { useAsyncIngestFile, useJobPoller } from "@/hooks/useIngest";
import { formatApiError } from "@/lib/api";
import { isIngestableFile } from "@/lib/files";
import type {
	JobRecord,
	KbIngestAsyncOrDuplicate,
	KnowledgeBaseRecord,
	RagDocumentRecord,
} from "@/lib/schemas";
import { IngestDropZone } from "./IngestDropZone";
import { NameConflictPrompt } from "./IngestNameConflictPrompt";
import { type QueueItem, QueueRow } from "./IngestQueueRow";

/**
 * The user's standing answer for name-conflict prompts in this
 * batch. `null` means "ask me each time"; `"overwrite"` /
 * `"skip"` means "apply this choice automatically to subsequent
 * conflicts." Set by the prompt dialog's "apply to all" checkbox
 * + a terminal action; cleared on dialog close (= queue reset).
 */
type ApplyToAll = "overwrite" | "skip" | null;

/**
 * State for the active name-conflict prompt. Holds enough context to
 * either continue the parked ingest with `overwriteOnNameConflict:
 * true` or drop the row as a user-skip. We keep a reference to the
 * original `File` rather than its bytes — File handles are stable in
 * memory and the multipart route re-reads them on each call, which
 * also means we transparently pick up any in-flight on-disk edits if
 * the user touched the file between the probe and the overwrite.
 */
interface PendingConflict {
	readonly itemId: string;
	readonly file: File;
	readonly existing: RagDocumentRecord;
}

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
 * Plain text plus PDF / DOCX, 25 MB per file. Anything else gets
 * rejected inline rather than silently dropped from the queue so
 * the user can fix the source set. PDF / DOCX bytes are extracted
 * server-side (native pdfjs-dist + mammoth by default; docling-serve
 * when `DOCLING_URL` is configured) before chunk + embed runs. The
 * drop zone lives in {@link IngestDropZone}; the per-file row +
 * progress bar live in {@link QueueRow}.
 */

const MAX_BYTES = 25 * 1024 * 1024;

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
	// Name-conflict prompt state. When `pendingConflict` is non-null,
	// the drain effect halts so the user can decide overwrite vs skip
	// in the modal. `applyToAll` carries the standing answer if the
	// user opted in to "apply to all" earlier in this batch.
	const [pendingConflict, setPendingConflict] =
		useState<PendingConflict | null>(null);
	const [applyToAll, setApplyToAll] = useState<ApplyToAll>(null);

	const ingest = useAsyncIngestFile(workspace, knowledgeBase.knowledgeBaseId);
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
		setPendingConflict(null);
		setApplyToAll(null);
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
			if (!isIngestableFile(file)) {
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
	// Issue a single multipart ingest call for one queue row. Returns
	// the union response so the caller can drive its own state machine
	// on duplicate / name_conflict / running. Lifted out of the drain
	// effect so the overwrite-prompt's "Overwrite" handler can re-use
	// it for the retry call (with the flag set) without copying the
	// payload assembly logic.
	const submitIngest = useCallback((item: QueueItem, overwrite: boolean) => {
		return ingestMutateAsyncRef.current({
			file: item.file,
			filename: item.relativePath,
			...(overwrite && { overwriteOnNameConflict: true }),
		});
	}, []);

	// Apply an ingest response to a queue row. Centralises the union
	// discrimination so the drain effect and the overwrite-retry
	// branch share one decoder. Returns the next state hint:
	//   - "advance"   → row reached a terminal state (duplicate /
	//                   user-skip / failure logged); drain to the
	//                   next item.
	//   - "running"   → ingest is in flight; wait on the poller.
	//   - "conflict"  → name_conflict that wasn't auto-resolved by
	//                   `applyToAll`; the caller surfaces the prompt.
	const applyIngestResponse = useCallback(
		(
			itemId: string,
			res: KbIngestAsyncOrDuplicate,
		):
			| "advance"
			| "running"
			| { kind: "conflict"; existing: RagDocumentRecord } => {
			if ("outcome" in res) {
				if (res.outcome === "duplicate") {
					updateItem(itemId, {
						status: "skipped",
						jobId: null,
						chunkCount: res.document.chunkTotal,
					});
					return "advance";
				}
				// `name_conflict`: caller decides whether to auto-apply
				// (applyToAll set) or surface the prompt.
				return { kind: "conflict", existing: res.document };
			}
			updateItem(itemId, {
				status: "running",
				jobId: res.job.jobId,
			});
			setActiveId(itemId);
			return "running";
		},
		[updateItem],
	);

	useEffect(() => {
		if (!draining) return;
		if (activeId !== null) return;
		if (kickInFlight.current) return;
		// Halt the drain while the user is being prompted on a
		// name conflict. The prompt's handlers re-enter the loop by
		// either marking the row terminal (Skip) or kicking a retry
		// ingest with `overwriteOnNameConflict: true` (Overwrite).
		if (pendingConflict !== null) return;
		const next = items.find((i) => i.status === "queued");
		if (!next) {
			setDraining(false);
			return;
		}
		kickInFlight.current = true;
		(async () => {
			try {
				try {
					// First-pass call never sets the overwrite flag — the
					// server's job is to detect the conflict and surface
					// it. Only the retry call after an explicit user
					// "Overwrite" sets it.
					const res = await submitIngest(next, false);
					const decision = applyIngestResponse(next.id, res);
					if (decision === "advance" || decision === "running") return;
					// Name conflict. If the user already picked a standing
					// answer earlier in this batch, apply it now without a
					// modal round-trip.
					if (applyToAll === "skip") {
						updateItem(next.id, {
							status: "skipped",
							jobId: null,
							chunkCount: decision.existing.chunkTotal,
						});
						return;
					}
					if (applyToAll === "overwrite") {
						const retry = await submitIngest(next, true);
						applyIngestResponse(next.id, retry);
						return;
					}
					// No standing answer → park the row and surface the
					// prompt. The handlers below pick it back up.
					setPendingConflict({
						itemId: next.id,
						file: next.file,
						existing: decision.existing,
					});
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
	}, [
		draining,
		activeId,
		items,
		updateItem,
		pendingConflict,
		applyToAll,
		submitIngest,
		applyIngestResponse,
	]);

	// Resolve a parked name-conflict the user just decided. Either
	// re-issues the ingest with the overwrite flag set, or marks the
	// row as user-skipped. `rememberChoice` propagates the decision to
	// any future name-conflicts in this batch via `applyToAll`.
	//
	// Critical: we set `kickInFlight = true` BEFORE clearing
	// `pendingConflict`. Without it, the drain effect fires the
	// instant `pendingConflict` flips to null — sees the same row
	// still in `queued` status (we haven't run the retry's status
	// update yet) — and submits a SECOND probe call. The result is
	// 3 mutation calls per conflict (probe → conflict, drain re-fire
	// → probe → conflict, retry → success) instead of 2.
	const resolveConflict = useCallback(
		async (
			choice: "overwrite" | "skip",
			rememberChoice: boolean,
		): Promise<void> => {
			if (!pendingConflict) return;
			const parked = pendingConflict;
			kickInFlight.current = true;
			setPendingConflict(null);
			if (rememberChoice) setApplyToAll(choice);
			try {
				if (choice === "skip") {
					updateItem(parked.itemId, {
						status: "skipped",
						jobId: null,
						chunkCount: parked.existing.chunkTotal,
					});
					return;
				}
				// Overwrite. Find the row in the current items snapshot;
				// fall back to a synthetic with the parked metadata if it
				// was removed (shouldn't happen — Remove is disabled while
				// draining).
				const row = items.find((i) => i.id === parked.itemId);
				if (!row) return;
				try {
					const retry = await submitIngest(row, true);
					applyIngestResponse(row.id, retry);
				} catch (err) {
					updateItem(row.id, {
						status: "failed",
						errorMessage: formatApiError(err),
					});
				}
			} finally {
				kickInFlight.current = false;
			}
		},
		[pendingConflict, items, submitIngest, applyIngestResponse, updateItem],
	);

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
		const c = { queued: 0, running: 0, succeeded: 0, skipped: 0, failed: 0 };
		for (const i of items) c[i.status] += 1;
		return c;
	}, [items]);

	const allDone =
		items.length > 0 &&
		items.every(
			(i) =>
				i.status === "succeeded" ||
				i.status === "failed" ||
				i.status === "skipped",
		);
	const anyQueued = counts.queued > 0;

	return (
		<>
			<Dialog open={open} onOpenChange={handleOpenChange}>
				<DialogContent className="max-w-2xl">
					<DialogHeader>
						<DialogTitle>Ingest into "{knowledgeBase.name}"</DialogTitle>
						<DialogDescription>
							Drop one or more files, or a folder. Each file becomes a separate
							document; ingests run sequentially through the KB's bound chunking
							+ embedding services.
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
									{counts.succeeded + counts.failed + counts.skipped > 0
										? ` — ${counts.succeeded} done${
												counts.skipped > 0 ? `, ${counts.skipped} skipped` : ""
											}${counts.failed > 0 ? `, ${counts.failed} failed` : ""}`
										: ""}
								</span>
								{!draining && counts.queued > 0 ? (
									<button
										type="button"
										className="text-xs text-slate-500 hover:text-slate-900"
										onClick={() =>
											setItems((cur) =>
												cur.filter((i) => i.status === "running"),
											)
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
			<NameConflictPrompt
				open={pendingConflict !== null}
				filename={
					pendingConflict
						? (items.find((i) => i.id === pendingConflict.itemId)
								?.relativePath ??
							pendingConflict.existing.sourceFilename ??
							"this file")
						: ""
				}
				existing={pendingConflict?.existing ?? null}
				onChoose={resolveConflict}
			/>
		</>
	);
}
