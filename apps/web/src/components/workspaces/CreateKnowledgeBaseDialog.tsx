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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
						<Label htmlFor="kb-name">Name</Label>
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
						<Label htmlFor="kb-description">Description (optional)</Label>
						<Input
							id="kb-description"
							placeholder="Customer support knowledge base"
							{...form.register("description")}
						/>
					</div>

					<div className="flex flex-col gap-1.5">
						<Label htmlFor="kb-emb">Embedding service</Label>
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
						<Label htmlFor="kb-chunk">Chunking service</Label>
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
						<Label htmlFor="kb-rerank">Reranking service (optional)</Label>
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
						<Label htmlFor="kb-lang">Language (optional)</Label>
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
