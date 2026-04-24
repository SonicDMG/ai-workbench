import { zodResolver } from "@hookform/resolvers/zod";
import { AlertTriangle, CheckCircle2, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
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
		}
		onOpenChange(next);
	}

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
