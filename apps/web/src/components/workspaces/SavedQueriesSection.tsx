import { zodResolver } from "@hookform/resolvers/zod";
import { Play, Plus, Search, Trash2 } from "lucide-react";
import { useState } from "react";
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
import {
	useCreateSavedQuery,
	useDeleteSavedQuery,
	useRunSavedQuery,
	useSavedQueries,
} from "@/hooks/useSavedQueries";
import { formatApiError } from "@/lib/api";
import type { SavedQueryRecord, SearchHit } from "@/lib/schemas";

/**
 * Saved queries for one catalog. Lives inside the expanded Catalog
 * row under the document list. Mirrors the flow we already have for
 * vector-stores + documents: list + create + delete, with a per-row
 * "Run" button that fires the saved query against the catalog's
 * bound vector store.
 */
export function SavedQueriesSection({
	workspace,
	catalogUid,
}: {
	workspace: string;
	catalogUid: string;
}) {
	const list = useSavedQueries(workspace, catalogUid);
	const del = useDeleteSavedQuery(workspace, catalogUid);
	const run = useRunSavedQuery(workspace, catalogUid);
	const [createOpen, setCreateOpen] = useState(false);
	const [resultsFor, setResultsFor] = useState<SavedQueryRecord | null>(null);
	const [results, setResults] = useState<SearchHit[] | null>(null);

	if (list.isLoading) {
		return <p className="text-xs text-slate-500">Loading saved queries…</p>;
	}
	if (list.isError) {
		return (
			<p className="text-xs text-red-600">
				Couldn't load saved queries: {list.error.message}
			</p>
		);
	}
	const rows = list.data ?? [];

	async function handleRun(query: SavedQueryRecord): Promise<void> {
		try {
			const hits = await run.mutateAsync(query.queryUid);
			setResultsFor(query);
			setResults(hits);
		} catch (err) {
			toast.error("Couldn't run query", { description: formatApiError(err) });
		}
	}

	return (
		<div className="flex flex-col gap-2">
			<div className="flex items-center justify-between gap-2">
				<p className="text-xs font-medium uppercase tracking-wider text-slate-500">
					Saved queries
				</p>
				<Button
					variant="ghost"
					size="sm"
					onClick={() => setCreateOpen(true)}
					className="h-7 px-2"
				>
					<Plus className="h-3.5 w-3.5" /> Save
				</Button>
			</div>
			{rows.length === 0 ? (
				<p className="text-xs text-slate-500 pl-1">
					No saved queries yet — save a frequently-run query to replay it in one
					click.
				</p>
			) : (
				<div className="flex flex-col gap-1">
					{rows.map((q) => (
						<SavedQueryRow
							key={q.queryUid}
							query={q}
							running={run.isPending && resultsFor?.queryUid === q.queryUid}
							onRun={() => handleRun(q)}
							onDelete={async () => {
								try {
									await del.mutateAsync(q.queryUid);
									toast.success(`Deleted '${q.name}'`);
									if (resultsFor?.queryUid === q.queryUid) {
										setResultsFor(null);
										setResults(null);
									}
								} catch (err) {
									toast.error("Couldn't delete", {
										description: formatApiError(err),
									});
								}
							}}
						/>
					))}
				</div>
			)}

			<CreateSavedQueryDialog
				workspace={workspace}
				catalogUid={catalogUid}
				open={createOpen}
				onOpenChange={setCreateOpen}
			/>

			{resultsFor && results ? (
				<SavedQueryResultsDialog
					query={resultsFor}
					hits={results}
					onClose={() => {
						setResultsFor(null);
						setResults(null);
					}}
				/>
			) : null}
		</div>
	);
}

function SavedQueryRow({
	query,
	running,
	onRun,
	onDelete,
}: {
	query: SavedQueryRecord;
	running: boolean;
	onRun: () => void;
	onDelete: () => void;
}) {
	return (
		<div className="group flex items-center gap-2 rounded-md px-2 py-1.5 text-xs hover:bg-white">
			<Search className="h-3.5 w-3.5 shrink-0 text-slate-400" aria-hidden />
			<div className="min-w-0 flex-1">
				<span className="font-medium text-slate-800 truncate block">
					{query.name}
				</span>
				<span className="text-slate-500 truncate block">{query.text}</span>
			</div>
			<Button
				variant="ghost"
				size="sm"
				onClick={onRun}
				disabled={running}
				className="h-7 px-2 opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
				aria-label={`Run '${query.name}'`}
			>
				<Play className="h-3.5 w-3.5" />
				{running ? "Running…" : "Run"}
			</Button>
			<Button
				variant="ghost"
				size="sm"
				onClick={onDelete}
				className="h-7 px-2 opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
				aria-label={`Delete '${query.name}'`}
			>
				<Trash2 className="h-3.5 w-3.5 text-red-600" />
			</Button>
		</div>
	);
}

const FormSchema = z.object({
	name: z.string().min(1, "Name is required"),
	description: z.string().optional(),
	text: z.string().min(1, "Query text is required"),
	topK: z.number().int().positive().max(1000).optional(),
});
type FormInput = z.infer<typeof FormSchema>;

function CreateSavedQueryDialog({
	workspace,
	catalogUid,
	open,
	onOpenChange,
}: {
	workspace: string;
	catalogUid: string;
	open: boolean;
	onOpenChange: (v: boolean) => void;
}) {
	const create = useCreateSavedQuery(workspace, catalogUid);
	const form = useForm<FormInput>({
		resolver: zodResolver(FormSchema),
		defaultValues: { name: "", description: "", text: "", topK: 10 },
	});

	function handleOpenChange(next: boolean): void {
		if (!next) {
			form.reset();
			create.reset();
		}
		onOpenChange(next);
	}

	async function onSubmit(values: FormInput) {
		try {
			await create.mutateAsync({
				name: values.name,
				description: values.description?.trim() || null,
				text: values.text,
				topK: values.topK ?? null,
			});
			toast.success(`Saved query '${values.name}'`);
			handleOpenChange(false);
		} catch (err) {
			toast.error("Couldn't save query", { description: formatApiError(err) });
		}
	}

	const errors = form.formState.errors;

	return (
		<Dialog open={open} onOpenChange={handleOpenChange}>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>Save a query</DialogTitle>
					<DialogDescription>
						Catalog-scoped. Runs through the catalog's bound vector store via
						the same search path — the saved filter can't escape the catalog.
					</DialogDescription>
				</DialogHeader>
				<form
					onSubmit={form.handleSubmit(onSubmit)}
					className="flex flex-col gap-3"
				>
					<div className="flex flex-col gap-1.5">
						<Label htmlFor="sq-name">Name</Label>
						<Input
							id="sq-name"
							placeholder="refunds"
							aria-invalid={errors.name ? true : undefined}
							{...form.register("name")}
						/>
						{errors.name ? (
							<p className="text-xs text-red-600">{errors.name.message}</p>
						) : null}
					</div>
					<div className="flex flex-col gap-1.5">
						<Label htmlFor="sq-description">Description (optional)</Label>
						<Input
							id="sq-description"
							placeholder="Common refund questions"
							{...form.register("description")}
						/>
					</div>
					<div className="flex flex-col gap-1.5">
						<Label htmlFor="sq-text">Query text</Label>
						<Textarea
							id="sq-text"
							rows={3}
							placeholder="How do refunds work?"
							aria-invalid={errors.text ? true : undefined}
							{...form.register("text")}
						/>
						{errors.text ? (
							<p className="text-xs text-red-600">{errors.text.message}</p>
						) : null}
					</div>
					<div className="flex flex-col gap-1.5">
						<Label htmlFor="sq-topk">Top-K</Label>
						<Input
							id="sq-topk"
							type="number"
							min={1}
							max={1000}
							{...form.register("topK", { valueAsNumber: true })}
						/>
					</div>
					<DialogFooter>
						<Button
							type="button"
							variant="ghost"
							onClick={() => handleOpenChange(false)}
							disabled={create.isPending}
						>
							Cancel
						</Button>
						<Button type="submit" variant="brand" disabled={create.isPending}>
							{create.isPending ? "Saving…" : "Save query"}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}

function SavedQueryResultsDialog({
	query,
	hits,
	onClose,
}: {
	query: SavedQueryRecord;
	hits: SearchHit[];
	onClose: () => void;
}) {
	return (
		<Dialog open={true} onOpenChange={(o) => !o && onClose()}>
			<DialogContent className="max-w-2xl">
				<DialogHeader>
					<DialogTitle>
						“{query.name}” · {hits.length} hits
					</DialogTitle>
					<DialogDescription>
						Query: <span className="font-mono text-xs">{query.text}</span>
					</DialogDescription>
				</DialogHeader>
				{hits.length === 0 ? (
					<p className="text-sm text-slate-500">
						No matches in this catalog. Ingest some documents or tune the
						filter.
					</p>
				) : (
					<div className="flex flex-col gap-2 max-h-[50vh] overflow-y-auto">
						{hits.map((h) => (
							<div
								key={h.id}
								className="rounded-md border border-slate-200 bg-slate-50/60 p-3 text-xs"
							>
								<div className="flex items-baseline justify-between gap-3">
									<span className="font-mono text-slate-700 truncate">
										{h.id}
									</span>
									<span className="text-slate-500 shrink-0">
										score {h.score.toFixed(4)}
									</span>
								</div>
								{h.payload ? (
									<pre className="mt-2 text-[11px] text-slate-600 whitespace-pre-wrap break-all">
										{JSON.stringify(h.payload, null, 2)}
									</pre>
								) : null}
							</div>
						))}
					</div>
				)}
				<DialogFooter>
					<Button variant="secondary" onClick={onClose}>
						Close
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
