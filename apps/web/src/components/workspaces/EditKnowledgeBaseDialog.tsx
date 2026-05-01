import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect } from "react";
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
import { useUpdateKnowledgeBase } from "@/hooks/useKnowledgeBases";
import { useRerankingServices } from "@/hooks/useServices";
import { formatApiError } from "@/lib/api";
import type { KnowledgeBaseRecord } from "@/lib/schemas";

const FormSchema = z.object({
	name: z.string().min(1, "Name is required"),
	description: z.string().optional(),
	language: z.string().optional(),
	status: z.enum(["active", "draft", "deprecated"]),
	rerankingServiceId: z.string().optional(),
});
type FormInput = z.infer<typeof FormSchema>;

const NO_RERANKER = "_none_";

/**
 * Edit a knowledge base's metadata. Only fields that the API allows
 * to mutate are exposed: name, description, language, status, and an
 * optional reranker swap. Chunking and embedding bindings are
 * intentionally NOT editable — they define the underlying collection's
 * vector geometry and are immutable for the lifetime of the KB.
 */
export function EditKnowledgeBaseDialog({
	workspace,
	kb,
	onOpenChange,
}: {
	workspace: string;
	kb: KnowledgeBaseRecord | null;
	onOpenChange: (v: boolean) => void;
}) {
	const open = kb !== null;
	const update = useUpdateKnowledgeBase(workspace, kb?.knowledgeBaseId ?? "");
	const rerankings = useRerankingServices(open ? workspace : undefined);
	const reranks = rerankings.data ?? [];

	const form = useForm<FormInput>({
		resolver: zodResolver(FormSchema),
		defaultValues: {
			name: "",
			description: "",
			language: "",
			status: "active",
			rerankingServiceId: NO_RERANKER,
		},
	});

	// Reset whenever the dialog opens with a different KB so the form
	// reflects the row the user clicked, not stale state from the
	// previous open.
	useEffect(() => {
		if (kb) {
			form.reset({
				name: kb.name,
				description: kb.description ?? "",
				language: kb.language ?? "",
				status: kb.status,
				rerankingServiceId: kb.rerankingServiceId ?? NO_RERANKER,
			});
		}
	}, [kb, form]);

	function handleOpenChange(next: boolean): void {
		if (!next) {
			form.reset();
			update.reset();
		}
		onOpenChange(next);
	}

	async function onSubmit(values: FormInput): Promise<void> {
		if (!kb) return;
		try {
			const next = await update.mutateAsync({
				name: values.name,
				description: values.description?.trim() || null,
				language: values.language?.trim() || null,
				status: values.status,
				rerankingServiceId:
					values.rerankingServiceId && values.rerankingServiceId !== NO_RERANKER
						? values.rerankingServiceId
						: null,
			});
			toast.success(`Knowledge base '${next.name}' updated`);
			handleOpenChange(false);
		} catch (err) {
			toast.error("Couldn't update knowledge base", {
				description: formatApiError(err),
			});
		}
	}

	const errors = form.formState.errors;

	return (
		<Dialog open={open} onOpenChange={handleOpenChange}>
			<DialogContent className="max-w-lg">
				<DialogHeader>
					<DialogTitle>Edit knowledge base</DialogTitle>
					<DialogDescription>
						Update the name, description, language, status, or reranker. The
						chunking and embedding services that own this collection's vector
						geometry are immutable.
					</DialogDescription>
				</DialogHeader>

				<form
					onSubmit={form.handleSubmit(onSubmit)}
					className="flex flex-col gap-4"
				>
					<div className="flex flex-col gap-1.5">
						<FieldLabel htmlFor="kb-edit-name">Name</FieldLabel>
						<Input
							id="kb-edit-name"
							aria-invalid={errors.name ? true : undefined}
							{...form.register("name")}
						/>
						{errors.name ? (
							<p className="text-xs text-red-600">{errors.name.message}</p>
						) : null}
					</div>

					<div className="flex flex-col gap-1.5">
						<FieldLabel htmlFor="kb-edit-description">
							Description (optional)
						</FieldLabel>
						<Input id="kb-edit-description" {...form.register("description")} />
					</div>

					<div className="flex flex-col gap-1.5">
						<FieldLabel
							htmlFor="kb-edit-status"
							help="Mark a KB deprecated to flag it for cleanup without breaking existing references."
						>
							Status
						</FieldLabel>
						<Select
							value={form.watch("status")}
							onValueChange={(v) =>
								form.setValue("status", v as FormInput["status"])
							}
						>
							<SelectTrigger id="kb-edit-status">
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								<SelectItem value="active">active</SelectItem>
								<SelectItem value="draft">draft</SelectItem>
								<SelectItem value="deprecated">deprecated</SelectItem>
							</SelectContent>
						</Select>
					</div>

					<div className="flex flex-col gap-1.5">
						<FieldLabel
							htmlFor="kb-edit-rerank"
							help="Optional second-pass ranking applied after the vector search returns candidates."
						>
							Reranking service (optional)
						</FieldLabel>
						<Select
							value={form.watch("rerankingServiceId") ?? NO_RERANKER}
							onValueChange={(v) => form.setValue("rerankingServiceId", v)}
							disabled={rerankings.isLoading}
						>
							<SelectTrigger id="kb-edit-rerank">
								<SelectValue placeholder="No reranker" />
							</SelectTrigger>
							<SelectContent>
								<SelectItem value={NO_RERANKER}>No reranker</SelectItem>
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
						<FieldLabel htmlFor="kb-edit-lang">Language (optional)</FieldLabel>
						<Input id="kb-edit-lang" {...form.register("language")} />
					</div>

					<DialogFooter>
						<Button
							type="button"
							variant="ghost"
							onClick={() => handleOpenChange(false)}
							disabled={update.isPending}
						>
							Cancel
						</Button>
						<Button type="submit" variant="brand" disabled={update.isPending}>
							{update.isPending ? "Saving…" : "Save changes"}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}
