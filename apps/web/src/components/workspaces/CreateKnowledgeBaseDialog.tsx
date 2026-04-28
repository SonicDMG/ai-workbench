import { zodResolver } from "@hookform/resolvers/zod";
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
import { FieldLabel } from "@/components/ui/field-label";
import { Input } from "@/components/ui/input";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { useCreateKnowledgeBase } from "@/hooks/useKnowledgeBases";
import {
	useChunkingServices,
	useEmbeddingServices,
	useRerankingServices,
} from "@/hooks/useServices";
import { formatApiError } from "@/lib/api";

const FormSchema = z.object({
	name: z.string().min(1, "Name is required"),
	description: z.string().optional(),
	embeddingServiceId: z.string().uuid("Pick an embedding service"),
	chunkingServiceId: z.string().uuid("Pick a chunking service"),
	rerankingServiceId: z.string().uuid().or(z.literal("")).optional(),
	language: z.string().optional(),
});
type FormInput = z.infer<typeof FormSchema>;

/**
 * Create a knowledge base under a workspace. Embedding + chunking
 * services are required (the runtime won't auto-provision the
 * underlying vector collection without an embedding service to fix
 * its dimension); reranking is optional and can be added later.
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
	const form = useForm<FormInput>({
		resolver: zodResolver(FormSchema),
		defaultValues: {
			name: "",
			description: "",
			embeddingServiceId: "",
			chunkingServiceId: "",
			rerankingServiceId: "",
			language: "",
		},
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
			const record = await create.mutateAsync({
				name: values.name,
				description: values.description?.trim() || null,
				embeddingServiceId: values.embeddingServiceId,
				chunkingServiceId: values.chunkingServiceId,
				rerankingServiceId: values.rerankingServiceId
					? values.rerankingServiceId
					: null,
				language: values.language?.trim() || null,
			});
			toast.success(`Knowledge base '${record.name}' created`);
			handleOpenChange(false);
		} catch (err) {
			toast.error("Couldn't create knowledge base", {
				description: formatApiError(err),
			});
		}
	}

	const errors = form.formState.errors;
	const embs = embeddings.data ?? [];
	const chunks = chunkings.data ?? [];
	const reranks = rerankings.data ?? [];
	const blockedReason =
		embs.length === 0
			? "Create an embedding service first"
			: chunks.length === 0
				? "Create a chunking service first"
				: null;

	return (
		<Dialog open={open} onOpenChange={handleOpenChange}>
			<DialogContent className="max-w-lg">
				<DialogHeader>
					<DialogTitle>Create a knowledge base</DialogTitle>
					<DialogDescription>
						A KB owns an Astra collection plus the chunking, embedding, and
						(optionally) reranking services that produce its content.
					</DialogDescription>
				</DialogHeader>

				<form
					onSubmit={form.handleSubmit(onSubmit)}
					className="flex flex-col gap-4"
				>
					<div className="flex flex-col gap-1.5">
						<FieldLabel
							htmlFor="kb-name"
							help="The collection-facing name for this knowledge base, for example support-docs or product-catalog. Pick something stable and easy to recognize."
						>
							Name
						</FieldLabel>
						<Input
							id="kb-name"
							placeholder="support-docs"
							aria-invalid={errors.name ? true : undefined}
							{...form.register("name")}
						/>
						{errors.name ? (
							<p className="text-xs text-red-600">{errors.name.message}</p>
						) : null}
					</div>

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
							help="The model/service used to convert chunks and text queries into vectors. Its dimension determines the vector collection shape."
						>
							Embedding service
						</FieldLabel>
						<Select
							value={form.watch("embeddingServiceId") ?? ""}
							onValueChange={(v) => form.setValue("embeddingServiceId", v)}
							disabled={embeddings.isLoading || embs.length === 0}
						>
							<SelectTrigger id="kb-emb">
								<SelectValue
									placeholder={
										embs.length === 0
											? "No embedding services yet"
											: "Pick an embedding service"
									}
								/>
							</SelectTrigger>
							<SelectContent>
								{embs.map((s) => (
									<SelectItem
										key={s.embeddingServiceId}
										value={s.embeddingServiceId}
									>
										{s.name}
										<span className="ml-2 text-xs text-slate-500">
											({s.provider}:{s.modelName} / dim {s.embeddingDimension})
										</span>
									</SelectItem>
								))}
							</SelectContent>
						</Select>
						{errors.embeddingServiceId ? (
							<p className="text-xs text-red-600">
								{errors.embeddingServiceId.message}
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
										<span className="ml-2 text-xs text-slate-500">
											({s.engine})
										</span>
									</SelectItem>
								))}
							</SelectContent>
						</Select>
						{errors.chunkingServiceId ? (
							<p className="text-xs text-red-600">
								{errors.chunkingServiceId.message}
							</p>
						) : null}
					</div>

					<div className="flex flex-col gap-1.5">
						<FieldLabel
							htmlFor="kb-rerank"
							help="Optional second-pass ranking that can reorder retrieved matches after the vector search returns candidates."
						>
							Reranking service (optional)
						</FieldLabel>
						<Select
							value={form.watch("rerankingServiceId") ?? ""}
							onValueChange={(v) =>
								form.setValue("rerankingServiceId", v === "_none_" ? "" : v)
							}
							disabled={rerankings.isLoading}
						>
							<SelectTrigger id="kb-rerank">
								<SelectValue placeholder="No reranker" />
							</SelectTrigger>
							<SelectContent>
								<SelectItem value="_none_">No reranker</SelectItem>
								{reranks.map((s) => (
									<SelectItem
										key={s.rerankingServiceId}
										value={s.rerankingServiceId}
									>
										{s.name}
										<span className="ml-2 text-xs text-slate-500">
											({s.provider}:{s.modelName})
										</span>
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					</div>

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
						<p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
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
							{create.isPending ? "Creating…" : "Create knowledge base"}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}
