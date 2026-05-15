import { Loader2, Upload } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
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
import { useUpdateDocument } from "@/hooks/useDocuments";
import { useAsyncIngestFile } from "@/hooks/useIngest";
import { useRlacEnabled } from "@/hooks/useRlac";
import { formatApiError } from "@/lib/api";
import { isIngestableFile } from "@/lib/files";
import type { RagDocumentRecord } from "@/lib/schemas";
import { cn } from "@/lib/utils";
import { VisibilityPicker } from "./VisibilityPicker";

/**
 * Edit a KB document's metadata + visibility, and optionally replace
 * its file contents.
 *
 * Two distinct flows live in this dialog, each with its own Save
 * button so the user understands what's about to happen:
 *
 *   1. **Metadata patch** — rename + change `visible_to`. Sends one
 *      PATCH. Fast, surgical, no chunks touched.
 *   2. **Replace file** — pick a new file from disk. Sends a
 *      multipart ingest with `overwriteOnNameConflict: true` so the
 *      existing chunks are dropped before the new file is chunked
 *      and embedded. The replacement gets a fresh `documentId` (the
 *      runtime can't keep the old id while swapping content) but
 *      the original filename + visibility carry over from whatever
 *      is staged in the form when Replace is clicked.
 *
 * The dialog deliberately does NOT collapse the two flows into one
 * "Save" button. A rename is cheap; re-embedding is expensive. The
 * user should opt into each.
 */
export function EditDocumentDialog({
	workspace,
	knowledgeBaseId,
	doc,
	onOpenChange,
}: {
	readonly workspace: string;
	readonly knowledgeBaseId: string;
	readonly doc: RagDocumentRecord | null;
	readonly onOpenChange: (open: boolean) => void;
}) {
	const open = doc !== null;
	const update = useUpdateDocument(workspace, knowledgeBaseId);
	const rlacEnabled = useRlacEnabled(workspace);
	const ingest = useAsyncIngestFile(workspace, knowledgeBaseId);

	const [name, setName] = useState<string>(doc?.sourceFilename ?? "");
	const [visibleTo, setVisibleTo] = useState<readonly string[] | null>(
		doc?.visibleTo ?? null,
	);
	const fileInputRef = useRef<HTMLInputElement | null>(null);
	const [replaceError, setReplaceError] = useState<string | null>(null);

	// Reset form state whenever the dialog's document changes (closing
	// → reopening on a different row should not show the previous
	// staged edits).
	const documentId = doc?.documentId;
	const sourceFilename = doc?.sourceFilename;
	const docVisibleTo = doc?.visibleTo;
	useEffect(() => {
		if (documentId) {
			setName(sourceFilename ?? "");
			setVisibleTo(docVisibleTo ?? null);
			setReplaceError(null);
		}
	}, [documentId, sourceFilename, docVisibleTo]);

	const metadataDirty = useMemo(() => {
		if (!doc) return false;
		if ((doc.sourceFilename ?? "") !== name) return true;
		const original = doc.visibleTo;
		const staged = visibleTo;
		if (original === null && staged === null) return false;
		if (original === null || staged === null) return true;
		if (original.length !== staged.length) return true;
		const a = [...original].sort();
		const b = [...staged].sort();
		return a.some((v, i) => v !== b[i]);
	}, [doc, name, visibleTo]);

	async function saveMetadata(): Promise<void> {
		if (!doc) return;
		try {
			await update.mutateAsync({
				documentId: doc.documentId,
				patch: {
					sourceFilename: name.length > 0 ? name : null,
					visibleTo,
				},
			});
			toast.success("Document updated");
			onOpenChange(false);
		} catch (err) {
			toast.error(`Couldn't save: ${formatApiError(err)}`);
		}
	}

	async function replaceWith(file: File): Promise<void> {
		if (!doc) return;
		if (!isIngestableFile(file)) {
			setReplaceError(
				`File "${file.name}" is not a supported type (${file.type || "unknown"}).`,
			);
			return;
		}
		setReplaceError(null);
		try {
			// Use the current staged name as the target filename so the
			// runtime's `overwriteOnNameConflict` lookup matches the
			// existing row. If the user typed a new name, that becomes
			// the new doc's filename in one shot.
			const targetName = name.length > 0 ? name : file.name;
			await ingest.mutateAsync({
				file,
				filename: targetName,
				overwriteOnNameConflict: true,
				...(visibleTo !== null && { visibleTo }),
			});
			toast.success("Document replaced");
			onOpenChange(false);
		} catch (err) {
			toast.error(`Couldn't replace: ${formatApiError(err)}`);
		}
	}

	const replacing = ingest.isPending;
	const saving = update.isPending;

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="max-w-lg">
				<DialogHeader>
					<DialogTitle>Edit document</DialogTitle>
					<DialogDescription>
						Rename, change visibility, or replace the file contents. Renaming
						and re-sharing are instant; replacing re-runs the chunk + embed
						pipeline.
					</DialogDescription>
				</DialogHeader>

				{doc ? (
					<div className="flex flex-col gap-4">
						<label className="flex flex-col gap-1 text-sm">
							<span className="font-medium text-slate-700 dark:text-slate-200">
								Name
							</span>
							<input
								type="text"
								value={name}
								onChange={(e) => setName(e.target.value)}
								className="rounded border border-slate-300 px-2 py-1 font-mono text-xs dark:border-slate-700 dark:bg-slate-900"
								placeholder="document.md"
								spellCheck={false}
							/>
							<span className="text-[11px] text-slate-500 dark:text-slate-400">
								The display name shown in the table. Used by name-collision
								detection on re-ingest.
							</span>
						</label>

						{rlacEnabled ? (
							<VisibilityPicker
								workspace={workspace}
								value={visibleTo}
								onChange={setVisibleTo}
							/>
						) : null}

						<div className="flex items-center justify-end gap-2 border-slate-200 border-t pt-3 dark:border-slate-700">
							<Button
								type="button"
								variant="brand"
								size="sm"
								onClick={saveMetadata}
								disabled={!metadataDirty || saving || replacing}
							>
								{saving ? "Saving…" : "Save changes"}
							</Button>
						</div>

						<div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-900/40">
							<div className="flex items-center justify-between gap-2">
								<div>
									<p className="font-medium text-slate-700 text-sm dark:text-slate-200">
										Replace contents
									</p>
									<p className="text-[11px] text-slate-500 dark:text-slate-400">
										Drops the existing chunks and re-runs the ingest pipeline
										against a new file. The document keeps its current name +
										visibility from the form above.
									</p>
								</div>
								<Button
									type="button"
									variant="secondary"
									size="sm"
									onClick={() => fileInputRef.current?.click()}
									disabled={replacing || saving}
								>
									{replacing ? (
										<>
											<Loader2 className="h-4 w-4 animate-spin" /> Replacing…
										</>
									) : (
										<>
											<Upload className="h-4 w-4" /> Replace…
										</>
									)}
								</Button>
								<input
									ref={fileInputRef}
									type="file"
									className="hidden"
									onChange={(e) => {
										const f = e.target.files?.[0];
										if (f) void replaceWith(f);
										// Reset so picking the same file twice still fires.
										e.target.value = "";
									}}
								/>
							</div>
							{replaceError ? (
								<p
									className={cn(
										"mt-2 rounded border border-red-200 bg-red-50 p-2 text-[11px] text-red-800",
										"dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-200",
									)}
								>
									{replaceError}
								</p>
							) : null}
						</div>
					</div>
				) : null}

				<DialogFooter>
					<Button
						type="button"
						variant="ghost"
						onClick={() => onOpenChange(false)}
					>
						Close
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
