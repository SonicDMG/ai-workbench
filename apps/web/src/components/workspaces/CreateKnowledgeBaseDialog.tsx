import { zodResolver } from "@hookform/resolvers/zod";
import { useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { AstraCodeChip } from "@/components/astra/AstraCodeChip";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { FieldLabel } from "@/components/ui/field-label";
import { Input } from "@/components/ui/input";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import {
	useAdoptableCollections,
	useCreateKnowledgeBase,
} from "@/hooks/useKnowledgeBases";
import {
	useChunkingServices,
	useEmbeddingServices,
	useRerankingServices,
} from "@/hooks/useServices";
import { formatApiError } from "@/lib/api";
import type {
	AdoptableCollection,
	EmbeddingServiceRecord,
	KnowledgeBaseCreateResponse,
} from "@/lib/schemas";
import { RerankingServiceField } from "./RerankingServiceField";

type Mode = "create" | "attach";

// Mirrors the server-side KB-name rule (Astra collection-name regex):
// starts with a letter, then letters/digits/underscores, max 48 chars.
// In create mode this *is* the underlying collection name, so the
// constraint is enforced both client- and server-side.
const KB_NAME_REGEX = /^[A-Za-z][A-Za-z0-9_]{0,47}$/;

const FormSchema = z
	.object({
		mode: z.enum(["create", "attach"]),
		// Required in create mode (typed by the user, doubles as the
		// collection name). In attach mode it's auto-populated from the
		// chosen collection on submit and the field isn't shown.
		name: z.string().optional(),
		description: z.string().optional(),
		embeddingServiceId: z.string().uuid("Pick an embedding service"),
		chunkingServiceId: z.string().uuid("Pick a chunking service"),
		rerankingServiceId: z.string().uuid().or(z.literal("")).optional(),
		language: z.string().optional(),
		vectorCollection: z.string().optional(),
	})
	.superRefine((v, ctx) => {
		if (v.mode === "attach") {
			if (!v.vectorCollection) {
				ctx.addIssue({
					code: z.ZodIssueCode.custom,
					path: ["vectorCollection"],
					message: "Pick an existing collection to attach",
				});
			}
		} else {
			if (!v.name || v.name.length === 0) {
				ctx.addIssue({
					code: z.ZodIssueCode.custom,
					path: ["name"],
					message: "Name is required",
				});
			} else if (!KB_NAME_REGEX.test(v.name)) {
				ctx.addIssue({
					code: z.ZodIssueCode.custom,
					path: ["name"],
					message:
						"Use letters, digits, and underscores only (start with a letter, max 48 chars)",
				});
			}
		}
	});
type FormInput = z.infer<typeof FormSchema>;

/**
 * Decide whether an embedding service is compatible with a target
 * collection. Compatibility = same vector dimension AND, if the
 * collection was created with an Astra `$vectorize` service, the same
 * provider/model. We surface this as a filter on the embedding
 * dropdown so the user can't pick a service that would fail backend
 * validation on submit.
 *
 * Exported for unit testing — the dialog itself uses it via the
 * filtered-list memo.
 */
export function isCompatible(
	collection: AdoptableCollection,
	emb: EmbeddingServiceRecord,
): boolean {
	if (collection.vectorDimension !== emb.embeddingDimension) return false;
	if (
		collection.vectorService &&
		(collection.vectorService.provider !== emb.provider ||
			collection.vectorService.modelName !== emb.modelName)
	) {
		return false;
	}
	return true;
}

/**
 * Create a knowledge base under a workspace, either by provisioning a
 * fresh Astra collection (default) or by attaching to a pre-existing
 * one. In attach mode the embedding-service dropdown is filtered to
 * services whose dimension (and `$vectorize` provider/model when set)
 * matches the chosen collection — the runtime would reject mismatches
 * at create time, this just surfaces compatibility upfront.
 */
export function CreateKnowledgeBaseDialog({
	workspace,
	open,
	onOpenChange,
}: {
	workspace: string;
	open: boolean;
	onOpenChange: (v: boolean) => void;
}) {
	const create = useCreateKnowledgeBase(workspace);
	const embeddings = useEmbeddingServices(open ? workspace : undefined);
	const chunkings = useChunkingServices(open ? workspace : undefined);
	const rerankings = useRerankingServices(open ? workspace : undefined);
	const adoptable = useAdoptableCollections(open ? workspace : undefined);
	// On successful create, swap the dialog from form-mode to
	// success-mode (showing the actual Data API call the runtime made +
	// a Done button) instead of auto-closing. Cleared when the dialog
	// closes via `handleOpenChange`.
	const [created, setCreated] = useState<KnowledgeBaseCreateResponse | null>(
		null,
	);
	const form = useForm<FormInput>({
		resolver: zodResolver(FormSchema),
		defaultValues: {
			mode: "create",
			name: "",
			description: "",
			embeddingServiceId: "",
			chunkingServiceId: "",
			rerankingServiceId: "",
			language: "",
			vectorCollection: "",
		},
	});

	const mode = form.watch("mode") as Mode;
	const selectedCollectionName = form.watch("vectorCollection") ?? "";
	const cols = useMemo(() => adoptable.data ?? [], [adoptable.data]);
	const selectedCollection = useMemo(
		() => cols.find((c) => c.name === selectedCollectionName) ?? null,
		[cols, selectedCollectionName],
	);

	const allEmbeddings: readonly EmbeddingServiceRecord[] =
		embeddings.data ?? [];
	const compatibleEmbeddings = useMemo(() => {
		if (mode !== "attach" || !selectedCollection) return allEmbeddings;
		return allEmbeddings.filter((e) => isCompatible(selectedCollection, e));
	}, [allEmbeddings, mode, selectedCollection]);

	function handleOpenChange(next: boolean): void {
		if (!next) {
			form.reset();
			create.reset();
			setCreated(null);
		}
		onOpenChange(next);
	}

	function handleModeChange(next: Mode): void {
		form.setValue("mode", next);
		form.setValue("vectorCollection", "");
		// Re-checking compat after mode change — clear the embedding
		// pick so the user re-picks from the (possibly-filtered) list.
		form.setValue("embeddingServiceId", "");
	}

	function handleCollectionChange(name: string): void {
		form.setValue("vectorCollection", name);
		const next = cols.find((c) => c.name === name);
		const current = form.getValues("embeddingServiceId");
		const stillOk =
			next &&
			allEmbeddings.find(
				(e) => e.embeddingServiceId === current && isCompatible(next, e),
			);
		if (!stillOk) form.setValue("embeddingServiceId", "");
	}

	async function onSubmit(values: FormInput): Promise<void> {
		try {
			// In attach mode the KB takes the existing collection's name —
			// there's no separate display name to disambiguate them.
			const resolvedName =
				values.mode === "attach"
					? (values.vectorCollection ?? "")
					: (values.name ?? "");
			const response = await create.mutateAsync({
				name: resolvedName,
				description: values.description?.trim() || null,
				embeddingServiceId: values.embeddingServiceId,
				chunkingServiceId: values.chunkingServiceId,
				rerankingServiceId: values.rerankingServiceId
					? values.rerankingServiceId
					: null,
				language: values.language?.trim() || null,
				attach: values.mode === "attach",
				vectorCollection:
					values.mode === "attach" ? (values.vectorCollection ?? null) : null,
			});
			toast.success(
				values.mode === "attach"
					? `Attached to '${response.vectorCollection}'`
					: `Knowledge base '${response.name}' created`,
			);
			// Swap to the success state so the user can inspect the Data
			// API call before the dialog goes away. For attach mode and
			// non-Astra workspaces `astraQueries` is empty, in which case
			// the success state still renders but the chip is hidden.
			setCreated(response);
		} catch (err) {
			toast.error(
				values.mode === "attach"
					? "Couldn't attach knowledge base"
					: "Couldn't create knowledge base",
				{ description: formatApiError(err) },
			);
		}
	}

	const errors = form.formState.errors;
	const chunks = chunkings.data ?? [];
	const reranks = rerankings.data ?? [];
	const selectableCollections = cols.filter((c) => !c.attached);
	const blockedReason =
		mode === "attach"
			? selectableCollections.length === 0 && !adoptable.isLoading
				? "No unattached collections found in this workspace's data plane"
				: chunks.length === 0
					? "Create a chunking service first"
					: null
			: allEmbeddings.length === 0
				? "Create an embedding service first"
				: chunks.length === 0
					? "Create a chunking service first"
					: null;

	const embeddingPlaceholder =
		mode === "attach" && !selectedCollection
			? "Pick a collection first"
			: compatibleEmbeddings.length === 0
				? mode === "attach"
					? "No compatible embedding service for this collection"
					: "No embedding services yet"
				: "Pick an embedding service";

	if (created) {
		return (
			<Dialog open={open} onOpenChange={handleOpenChange}>
				<DialogContent className="max-w-lg">
					<DialogHeader>
						<DialogTitle>
							{created.owned
								? `Knowledge base '${created.name}' created`
								: `Attached to '${created.vectorCollection}'`}
						</DialogTitle>
						<DialogDescription>
							{created.owned
								? "The runtime provisioned a fresh Astra collection and bound it to this KB. The exact Data API call is available below."
								: "The KB now reads from the existing collection. No data-plane writes were made."}
						</DialogDescription>
					</DialogHeader>

					<div className="flex flex-col gap-3">
						<dl className="grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1 text-xs text-slate-600 dark:text-slate-400">
							<dt className="font-medium">Collection</dt>
							<dd className="font-mono">{created.vectorCollection}</dd>
							<dt className="font-medium">Owned</dt>
							<dd>{created.owned ? "yes" : "no (attached)"}</dd>
						</dl>
						{created.astraQueries.length > 0 ? (
							<div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
								<span>View the call AI Workbench made:</span>
								<AstraCodeChip
									snapshots={created.astraQueries}
									dialogTitle="Astra createCollection call"
									dialogDescription={`The exact Data API call the runtime made to provision '${created.vectorCollection}'.`}
									testId="kb-create-result-code-chip"
								/>
							</div>
						) : null}
					</div>

					<DialogFooter>
						<Button
							type="button"
							variant="brand"
							onClick={() => handleOpenChange(false)}
						>
							Done
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		);
	}

	return (
		<Dialog open={open} onOpenChange={handleOpenChange}>
			<DialogContent className="max-w-lg">
				<DialogHeader>
					<DialogTitle>Create a knowledge base</DialogTitle>
					<DialogDescription>
						A KB owns an Astra collection plus the chunking, embedding, and
						(optionally) reranking services that produce its content. You can
						also attach an existing collection instead of creating a new one.
					</DialogDescription>
				</DialogHeader>

				<form
					onSubmit={form.handleSubmit(onSubmit)}
					className="flex flex-col gap-4"
				>
					<div
						className="grid grid-cols-2 gap-2 rounded-md border bg-slate-50 p-1 dark:border-slate-700 dark:bg-slate-800"
						role="tablist"
						aria-label="Knowledge base creation mode"
					>
						<button
							type="button"
							role="tab"
							aria-selected={mode === "create"}
							onClick={() => handleModeChange("create")}
							className={`rounded px-3 py-2 text-sm transition ${
								mode === "create"
									? "bg-white shadow-sm font-medium dark:bg-slate-900 dark:text-slate-100"
									: "text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100"
							}`}
						>
							Create new collection
						</button>
						<button
							type="button"
							role="tab"
							aria-selected={mode === "attach"}
							onClick={() => handleModeChange("attach")}
							className={`rounded px-3 py-2 text-sm transition ${
								mode === "attach"
									? "bg-white shadow-sm font-medium dark:bg-slate-900 dark:text-slate-100"
									: "text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100"
							}`}
						>
							Attach existing
						</button>
					</div>

					{mode === "attach" ? (
						<div className="flex flex-col gap-1.5">
							<FieldLabel
								htmlFor="kb-collection"
								help="Pick a collection that already exists in this workspace's Astra database. The KB will read and write into that collection without provisioning a new one — its name doubles as the KB name."
							>
								Existing collection
							</FieldLabel>
							<Select
								value={selectedCollectionName}
								onValueChange={handleCollectionChange}
								disabled={
									adoptable.isLoading || selectableCollections.length === 0
								}
							>
								<SelectTrigger id="kb-collection">
									<SelectValue
										placeholder={
											adoptable.isLoading
												? "Loading collections…"
												: selectableCollections.length === 0
													? "None available"
													: "Pick a collection"
										}
									/>
								</SelectTrigger>
								<SelectContent>
									{selectableCollections.map((c) => (
										<SelectItem key={c.name} value={c.name}>
											{c.name}
											<span className="ml-2 text-xs text-slate-500 dark:text-slate-400">
												(dim {c.vectorDimension} / {c.vectorSimilarity}
												{c.vectorService
													? ` / vectorize: ${c.vectorService.provider}:${c.vectorService.modelName}`
													: ""}
												)
											</span>
										</SelectItem>
									))}
								</SelectContent>
							</Select>
							{errors.vectorCollection ? (
								<p className="text-xs text-red-600 dark:text-red-400">
									{errors.vectorCollection.message}
								</p>
							) : null}
							{cols.some((c) => c.attached) ? (
								<p className="text-xs text-slate-500 dark:text-slate-400">
									{cols.filter((c) => c.attached).length} collection
									{cols.filter((c) => c.attached).length === 1 ? "" : "s"}{" "}
									already attached to a KB and hidden.
								</p>
							) : null}
						</div>
					) : (
						<div className="flex flex-col gap-1.5">
							<FieldLabel
								htmlFor="kb-name"
								help="Doubles as the underlying Astra collection name, so it cannot be changed later. Letters, digits, and underscores only — start with a letter, max 48 chars."
							>
								Name
							</FieldLabel>
							<Input
								id="kb-name"
								placeholder="support_docs"
								aria-invalid={errors.name ? true : undefined}
								{...form.register("name")}
							/>
							{errors.name ? (
								<p className="text-xs text-red-600 dark:text-red-400">
									{errors.name.message}
								</p>
							) : null}
						</div>
					)}

					<div className="flex flex-col gap-1.5">
						<FieldLabel
							htmlFor="kb-description"
							help="Optional context for teammates. It does not affect ingestion or retrieval."
						>
							Description (optional)
						</FieldLabel>
						<Input
							id="kb-description"
							placeholder="Customer support knowledge base"
							{...form.register("description")}
						/>
					</div>

					<div className="flex flex-col gap-1.5">
						<FieldLabel
							htmlFor="kb-emb"
							help={
								mode === "attach"
									? "Only embedding services whose vector dimension (and Astra vectorize service, if set) match the chosen collection are shown."
									: "The model/service used to convert chunks and text queries into vectors. Its dimension determines the vector collection shape."
							}
						>
							Embedding service
						</FieldLabel>
						<Select
							value={form.watch("embeddingServiceId") ?? ""}
							onValueChange={(v) => form.setValue("embeddingServiceId", v)}
							disabled={
								embeddings.isLoading ||
								compatibleEmbeddings.length === 0 ||
								(mode === "attach" && !selectedCollection)
							}
						>
							<SelectTrigger id="kb-emb">
								<SelectValue placeholder={embeddingPlaceholder} />
							</SelectTrigger>
							<SelectContent>
								{compatibleEmbeddings.map((s) => (
									<SelectItem
										key={s.embeddingServiceId}
										value={s.embeddingServiceId}
									>
										{s.name}
										<span className="ml-2 text-xs text-slate-500 dark:text-slate-400">
											({s.provider}:{s.modelName} / dim {s.embeddingDimension})
										</span>
									</SelectItem>
								))}
							</SelectContent>
						</Select>
						{errors.embeddingServiceId ? (
							<p className="text-xs text-red-600 dark:text-red-400">
								{errors.embeddingServiceId.message}
							</p>
						) : null}
						{mode === "attach" &&
						selectedCollection &&
						compatibleEmbeddings.length === 0 ? (
							<p className="text-xs text-amber-700 dark:text-amber-300">
								No existing embedding service matches this collection (dim{" "}
								{selectedCollection.vectorDimension}
								{selectedCollection.vectorService
									? `, vectorize ${selectedCollection.vectorService.provider}:${selectedCollection.vectorService.modelName}`
									: ""}
								). Create one in Services first.
							</p>
						) : null}
					</div>

					<div className="flex flex-col gap-1.5">
						<FieldLabel
							htmlFor="kb-chunk"
							help="Controls how documents are split before embedding. Smaller chunks improve precision; larger chunks preserve more surrounding context."
						>
							Chunking service
						</FieldLabel>
						<Select
							value={form.watch("chunkingServiceId") ?? ""}
							onValueChange={(v) => form.setValue("chunkingServiceId", v)}
							disabled={chunkings.isLoading || chunks.length === 0}
						>
							<SelectTrigger id="kb-chunk">
								<SelectValue
									placeholder={
										chunks.length === 0
											? "No chunking services yet"
											: "Pick a chunking service"
									}
								/>
							</SelectTrigger>
							<SelectContent>
								{chunks.map((s) => (
									<SelectItem
										key={s.chunkingServiceId}
										value={s.chunkingServiceId}
									>
										{s.name}
										<span className="ml-2 text-xs text-slate-500 dark:text-slate-400">
											({s.engine})
										</span>
									</SelectItem>
								))}
							</SelectContent>
						</Select>
						{errors.chunkingServiceId ? (
							<p className="text-xs text-red-600 dark:text-red-400">
								{errors.chunkingServiceId.message}
							</p>
						) : null}
					</div>

					<RerankingServiceField
						id="kb-rerank"
						value={form.watch("rerankingServiceId") || null}
						onChange={(v) => form.setValue("rerankingServiceId", v ?? "")}
						services={reranks}
						disabled={rerankings.isLoading}
					/>

					<div className="flex flex-col gap-1.5">
						<FieldLabel
							htmlFor="kb-lang"
							help="Optional language hint such as en or multi. Leave it empty when the corpus is mixed or unknown."
						>
							Language (optional)
						</FieldLabel>
						<Input
							id="kb-lang"
							placeholder="en"
							{...form.register("language")}
						/>
					</div>

					{blockedReason ? (
						<p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-200">
							{blockedReason}.
						</p>
					) : null}

					<DialogFooter>
						<Button
							type="button"
							variant="ghost"
							onClick={() => handleOpenChange(false)}
							disabled={create.isPending}
						>
							Cancel
						</Button>
						<Button
							type="submit"
							variant="brand"
							disabled={create.isPending || blockedReason !== null}
						>
							{create.isPending
								? mode === "attach"
									? "Attaching…"
									: "Creating…"
								: mode === "attach"
									? "Attach knowledge base"
									: "Create knowledge base"}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}
