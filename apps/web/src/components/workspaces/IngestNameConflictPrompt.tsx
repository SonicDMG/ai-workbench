import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import type { RagDocumentRecord } from "@/lib/schemas";
import { formatDate } from "@/lib/utils";

interface NameConflictPromptProps {
	readonly open: boolean;
	readonly filename: string;
	readonly existing: RagDocumentRecord | null;
	readonly onChoose: (
		choice: "overwrite" | "skip",
		rememberChoice: boolean,
	) => void;
}

/**
 * Modal shown when an ingest's `sourceFilename` collides with an
 * existing document in the same KB and the content hash differs. The
 * user picks overwrite (cascade-deletes the old doc + chunks, then
 * re-ingests the new content) or skip (keeps the old doc, drops the
 * new file). The "apply to all" checkbox propagates the choice to
 * subsequent name-conflicts in the same drain pass — useful for
 * folder-level uploads where the user has already decided their
 * policy and doesn't want a per-file modal.
 *
 * Renders as a separate Radix Dialog Root so it can layer on top of
 * the IngestQueueDialog without interfering with its open state.
 */
export function NameConflictPrompt({
	open,
	filename,
	existing,
	onChoose,
}: NameConflictPromptProps) {
	const [rememberChoice, setRememberChoice] = useState(false);
	// `decided` flips true the moment the user clicks one of the
	// action buttons. Without it, Radix's `onOpenChange(false)` —
	// which fires when our parent flips `open` from true to false in
	// response to the choice — would re-call `onChoose("skip", ...)`
	// and double-resolve the conflict. With the ref we only treat a
	// close-without-decision as a Skip (X button / overlay click).
	const decided = useRef(false);

	useEffect(() => {
		// Reset whenever a fresh prompt opens. The dialog is
		// re-rendered with a new `existing` per conflict; the ref
		// would otherwise carry over from the previous prompt and
		// suppress the legitimate "click X to skip" path.
		if (open) decided.current = false;
	}, [open]);

	const choose = (next: "overwrite" | "skip", remember: boolean): void => {
		decided.current = true;
		onChoose(next, remember);
	};

	// `existing` flips to null on close; guard against the brief
	// render where Radix is animating out so we don't crash on the
	// helper text.
	const ingestedAt = existing?.ingestedAt ?? null;
	const chunkTotal = existing?.chunkTotal ?? null;

	return (
		<Dialog
			open={open}
			onOpenChange={(next) => {
				// Only treat a close as a Skip when the user hasn't
				// already picked a button — otherwise we double-resolve
				// the conflict (clicking Overwrite flips `open` to
				// false → Radix fires onOpenChange(false) → would re-
				// call onChoose). See the `decided` ref above.
				if (!next && !decided.current) onChoose("skip", false);
			}}
		>
			<DialogContent className="max-w-md">
				<DialogHeader>
					<DialogTitle>Replace "{filename}"?</DialogTitle>
					<DialogDescription>
						A document with the same name already exists in this knowledge base
						but has different content.
						{ingestedAt ? (
							<>
								{" "}
								The existing version was ingested {formatDate(ingestedAt)}
								{chunkTotal !== null
									? ` (${chunkTotal} chunk${chunkTotal === 1 ? "" : "s"})`
									: ""}
								.
							</>
						) : null}{" "}
						Overwriting deletes the existing chunks and re-ingests the new
						content; skipping keeps what's already there.
					</DialogDescription>
				</DialogHeader>

				<label className="flex items-center gap-2 text-sm text-slate-700">
					<input
						type="checkbox"
						className="h-4 w-4 rounded border-slate-300 text-[var(--color-brand-600)] focus:ring-[var(--color-brand-500)]"
						checked={rememberChoice}
						onChange={(e) => setRememberChoice(e.target.checked)}
					/>
					Apply this choice to other name conflicts in this batch
				</label>

				<DialogFooter>
					<Button
						type="button"
						variant="ghost"
						onClick={() => choose("skip", rememberChoice)}
					>
						Skip
					</Button>
					<Button
						type="button"
						variant="brand"
						onClick={() => choose("overwrite", rememberChoice)}
					>
						Overwrite
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
