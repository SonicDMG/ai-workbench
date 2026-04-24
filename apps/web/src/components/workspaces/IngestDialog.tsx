import { zodResolver } from "@hookform/resolvers/zod";
import { AlertTriangle, CheckCircle2, Loader2, Upload, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useAsyncIngest, useJobPoller } from "@/hooks/useIngest";
import { ApiError } from "@/lib/api";
import type { CatalogRecord } from "@/lib/schemas";

/**
 * Async-ingest flow — paste text, hit "Ingest", watch it progress to
 * `ready`. The dialog stays open through the pipeline so the user
 * sees the terminal state before closing.
 *
 * Form uses its own lightweight zod schema (rather than the runtime's
 * `IngestRequest`) because the UI collects text + filename only; chunker
 * tuning is an advanced concern that belongs on a future settings
 * page once we have usage data to guide the knobs.
 */

const FormSchema = z.object({
	text: z.string().min(1, "Content is required"),
	sourceFilename: z.string().optional(),
});
type FormInput = z.infer<typeof FormSchema>;

/** Text-ish file types we read directly into the textarea. PDFs,
 * docx, and other binary formats need server-side parsing and are
 * out of scope for this MVP — the backend expects plain text on
 * `/ingest`. */
const READABLE_EXTENSIONS = [
	".txt",
	".md",
	".markdown",
	".json",
	".csv",
	".tsv",
	".log",
	".rst",
	".xml",
	".html",
	".htm",
	".yaml",
	".yml",
];
/** Hard cap on file size. 5 MB is generous for text but keeps a
 * runaway upload from freezing the browser — the runtime's chunker
 * will cheerfully process a 5 MB document. */
const MAX_BYTES = 5 * 1024 * 1024;

function isReadable(file: File): boolean {
	const name = file.name.toLowerCase();
	if (READABLE_EXTENSIONS.some((ext) => name.endsWith(ext))) return true;
	// Fall back to the browser-reported MIME type. `text/*` is always
	// safe; other types (application/json, application/xml, …) we
	// pick out explicitly.
	return (
		file.type.startsWith("text/") ||
		file.type === "application/json" ||
		file.type === "application/xml"
	);
}

export function IngestDialog({
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
	const ingest = useAsyncIngest(workspace, catalog.uid);
	const [jobId, setJobId] = useState<string | null>(null);
	const poll = useJobPoller(workspace, jobId ?? undefined);
	const [droppedFile, setDroppedFile] = useState<File | null>(null);
	const [dragActive, setDragActive] = useState(false);
	const fileInputRef = useRef<HTMLInputElement | null>(null);

	const form = useForm<FormInput>({
		resolver: zodResolver(FormSchema),
		defaultValues: { text: "", sourceFilename: "" },
	});

	// Reset internal state when the dialog closes so the next open
	// starts fresh.
	function handleOpenChange(next: boolean): void {
		if (!next) {
			form.reset();
			ingest.reset();
			setJobId(null);
			setDroppedFile(null);
			setDragActive(false);
		}
		onOpenChange(next);
	}

	const consumeFile = useCallback(
		async (file: File): Promise<void> => {
			if (!isReadable(file)) {
				toast.error("Unsupported file type", {
					description: `${file.name} isn't a text file. Upload one of: ${READABLE_EXTENSIONS.join(", ")}.`,
				});
				return;
			}
			if (file.size > MAX_BYTES) {
				toast.error("File too large", {
					description: `${file.name} is ${(file.size / 1024 / 1024).toFixed(1)} MB; max is ${MAX_BYTES / 1024 / 1024} MB.`,
				});
				return;
			}
			try {
				const text = await file.text();
				form.setValue("text", text, {
					shouldValidate: true,
					shouldDirty: true,
				});
				if (!form.getValues("sourceFilename")) {
					form.setValue("sourceFilename", file.name, { shouldDirty: true });
				}
				setDroppedFile(file);
			} catch (err) {
				toast.error("Couldn't read file", {
					description: err instanceof Error ? err.message : "Unknown error",
				});
			}
		},
		[form],
	);

	// Surface terminal errors as toasts once, without blocking the
	// dialog (the user may want to read the failure in-place before
	// closing).
	const terminalStatus = poll.data?.status;
	useEffect(() => {
		if (terminalStatus === "failed" && poll.data?.errorMessage) {
			toast.error("Ingest failed", { description: poll.data.errorMessage });
		}
	}, [terminalStatus, poll.data?.errorMessage]);

	async function onSubmit(values: FormInput) {
		try {
			const res = await ingest.mutateAsync({
				text: values.text,
				sourceFilename: values.sourceFilename?.trim() || null,
			});
			setJobId(res.job.jobId);
		} catch (err) {
			const msg =
				err instanceof ApiError
					? `${err.code}: ${err.message}`
					: err instanceof Error
						? err.message
						: "Unknown error";
			toast.error("Couldn't start ingest", { description: msg });
		}
	}

	const job = poll.data;
	const inFlight = Boolean(
		jobId && (!job || job.status === "pending" || job.status === "running"),
	);
	const succeeded = job?.status === "succeeded";
	const failed = job?.status === "failed";
	const chunkCount =
		job?.result && typeof job.result.chunks === "number"
			? job.result.chunks
			: null;
	const progressPercent =
		job?.total && job.total > 0
			? Math.min(100, Math.round((job.processed / job.total) * 100))
			: null;

	return (
		<Dialog open={open} onOpenChange={handleOpenChange}>
			<DialogContent className="max-w-xl">
				<DialogHeader>
					<DialogTitle>Ingest into “{catalog.name}”</DialogTitle>
					<DialogDescription>
						Chunks the text, embeds each chunk through the bound vector store,
						and registers a document row. Runs asynchronously — the dialog shows
						progress.
					</DialogDescription>
				</DialogHeader>

				{/* Form stays visible even after submit so the user can see what
				    they sent next to the progress readout. Disabled while a job
				    is in flight. */}
				<form
					onSubmit={form.handleSubmit(onSubmit)}
					className="flex flex-col gap-4"
				>
					{/* biome-ignore lint/a11y/noStaticElementInteractions: drop
					    zone is a pointer affordance; keyboard users get the
					    in-zone "browse" button. */}
					<div
						onDragOver={(e) => {
							if (inFlight || succeeded) return;
							e.preventDefault();
							setDragActive(true);
						}}
						onDragLeave={() => setDragActive(false)}
						onDrop={(e) => {
							if (inFlight || succeeded) return;
							e.preventDefault();
							setDragActive(false);
							const file = e.dataTransfer.files?.[0];
							if (file) void consumeFile(file);
						}}
						className={`relative flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed p-4 text-sm transition-colors ${
							dragActive
								? "border-[var(--color-brand-500)] bg-[var(--color-brand-50)]"
								: "border-slate-300 bg-slate-50"
						} ${inFlight || succeeded ? "opacity-60" : ""}`}
					>
						<input
							ref={fileInputRef}
							type="file"
							accept={READABLE_EXTENSIONS.join(",")}
							className="hidden"
							onChange={(e) => {
								const file = e.target.files?.[0];
								if (file) void consumeFile(file);
								e.target.value = "";
							}}
						/>
						{droppedFile ? (
							<div className="flex items-center gap-2 text-slate-700">
								<Upload className="h-4 w-4 text-slate-500" aria-hidden />
								<span className="font-mono text-xs">{droppedFile.name}</span>
								<span className="text-xs text-slate-500">
									({(droppedFile.size / 1024).toFixed(1)} KB)
								</span>
								<button
									type="button"
									onClick={() => {
										setDroppedFile(null);
										form.setValue("text", "", { shouldValidate: true });
									}}
									className="text-slate-400 hover:text-slate-600"
									aria-label="Clear uploaded file"
									disabled={inFlight || succeeded}
								>
									<X className="h-3.5 w-3.5" />
								</button>
							</div>
						) : (
							<>
								<Upload className="h-5 w-5 text-slate-400" aria-hidden />
								<p className="text-slate-600">
									Drop a text file here or{" "}
									<button
										type="button"
										onClick={() => fileInputRef.current?.click()}
										className="font-medium text-[var(--color-brand-700)] hover:underline"
										disabled={inFlight || succeeded}
									>
										browse
									</button>
								</p>
								<p className="text-xs text-slate-500">
									Text, Markdown, JSON, CSV, YAML, … up to{" "}
									{MAX_BYTES / 1024 / 1024} MB
								</p>
							</>
						)}
					</div>
					<div className="flex flex-col gap-1.5">
						<Label htmlFor="ingest-filename">Source filename (optional)</Label>
						<Input
							id="ingest-filename"
							placeholder="docs/onboarding.md"
							disabled={inFlight || succeeded}
							{...form.register("sourceFilename")}
						/>
						<p className="text-xs text-slate-500">
							Stored on the Document row for provenance. Not used by the
							chunker.
						</p>
					</div>
					<div className="flex flex-col gap-1.5">
						<Label htmlFor="ingest-text">Content</Label>
						<Textarea
							id="ingest-text"
							placeholder="Paste Markdown, plain text, …"
							rows={10}
							disabled={inFlight || succeeded}
							aria-invalid={form.formState.errors.text ? true : undefined}
							{...form.register("text")}
						/>
						{form.formState.errors.text ? (
							<p className="text-xs text-red-600">
								{form.formState.errors.text.message}
							</p>
						) : (
							<p className="text-xs text-slate-500">
								The runtime chunks on paragraph / sentence boundaries with
								sensible defaults. Per-catalog chunker tuning comes later.
							</p>
						)}
					</div>

					{job ? (
						<JobProgress
							status={job.status}
							processed={job.processed}
							total={job.total}
							percent={progressPercent}
							chunkCount={chunkCount}
							errorMessage={job.errorMessage}
						/>
					) : null}

					<DialogFooter>
						<Button
							type="button"
							variant="ghost"
							onClick={() => handleOpenChange(false)}
							disabled={ingest.isPending}
						>
							{succeeded || failed ? "Close" : "Cancel"}
						</Button>
						{!succeeded ? (
							<Button
								type="submit"
								variant="brand"
								disabled={inFlight || ingest.isPending}
							>
								{inFlight ? (
									<>
										<Loader2 className="h-4 w-4 animate-spin" /> Ingesting…
									</>
								) : failed ? (
									"Retry ingest"
								) : (
									"Ingest"
								)}
							</Button>
						) : null}
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}

function JobProgress({
	status,
	processed,
	total,
	percent,
	chunkCount,
	errorMessage,
}: {
	status: "pending" | "running" | "succeeded" | "failed";
	processed: number;
	total: number | null;
	percent: number | null;
	chunkCount: number | null;
	errorMessage: string | null;
}) {
	if (status === "succeeded") {
		return (
			<div className="flex items-start gap-2 rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm">
				<CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0 text-emerald-600" />
				<div>
					<p className="font-medium text-emerald-900">Ingest succeeded</p>
					<p className="text-emerald-800 text-xs mt-0.5">
						{chunkCount !== null
							? `${chunkCount} chunk${chunkCount === 1 ? "" : "s"} embedded and upserted.`
							: "Document is ready."}
					</p>
				</div>
			</div>
		);
	}
	if (status === "failed") {
		return (
			<div className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 p-3 text-sm">
				<AlertTriangle className="h-4 w-4 mt-0.5 shrink-0 text-red-600" />
				<div>
					<p className="font-medium text-red-900">Ingest failed</p>
					<p className="text-red-800 text-xs mt-0.5 font-mono break-words">
						{errorMessage ?? "Unknown error"}
					</p>
				</div>
			</div>
		);
	}
	return (
		<div className="rounded-md border border-slate-200 bg-slate-50 p-3 text-sm">
			<div className="flex items-center gap-2">
				<Loader2 className="h-4 w-4 animate-spin text-slate-500" />
				<p className="text-slate-900 font-medium">
					{status === "pending" ? "Queued" : "Running"}
				</p>
				<span className="text-xs text-slate-500">
					{total !== null
						? `${processed} / ${total} chunks`
						: `${processed} chunks processed`}
				</span>
			</div>
			{percent !== null ? (
				<div className="mt-2 h-1.5 rounded-full bg-slate-200 overflow-hidden">
					<div
						className="h-full bg-[var(--color-brand-500)] transition-[width] duration-200"
						style={{ width: `${percent}%` }}
					/>
				</div>
			) : null}
		</div>
	);
}
