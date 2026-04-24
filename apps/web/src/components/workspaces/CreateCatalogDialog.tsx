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
import { useCreateCatalog } from "@/hooks/useCatalogs";
import { useVectorStores } from "@/hooks/useVectorStores";
import { ApiError } from "@/lib/api";

const FormSchema = z.object({
	name: z.string().min(1, "Name is required"),
	description: z.string().optional(),
	vectorStore: z.string().uuid().or(z.literal("")).optional(),
});
type FormInput = z.infer<typeof FormSchema>;

/**
 * Create a catalog under a workspace. `vectorStore` binding is
 * optional at creation time — catalogs without a binding can still
 * hold documents but can't be searched or ingested into until one is
 * set. We surface the current workspace's vector stores in a picker
 * so the common case (bind at create) is a single click.
 */
export function CreateCatalogDialog({
	workspace,
	open,
	onOpenChange,
}: {
	workspace: string;
	open: boolean;
	onOpenChange: (v: boolean) => void;
}) {
	const create = useCreateCatalog(workspace);
	const vectorStores = useVectorStores(open ? workspace : undefined);
	const form = useForm<FormInput>({
		resolver: zodResolver(FormSchema),
		defaultValues: { name: "", description: "", vectorStore: "" },
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
				vectorStore: values.vectorStore ? values.vectorStore : null,
			});
			toast.success(`Catalog '${record.name}' created`);
			handleOpenChange(false);
		} catch (err) {
			const msg =
				err instanceof ApiError
					? `${err.code}: ${err.message}`
					: err instanceof Error
						? err.message
						: "Unknown error";
			toast.error("Couldn't create catalog", { description: msg });
		}
	}

	const errors = form.formState.errors;
	const stores = vectorStores.data ?? [];

	return (
		<Dialog open={open} onOpenChange={handleOpenChange}>
			<DialogContent className="max-w-lg">
				<DialogHeader>
					<DialogTitle>Create a catalog</DialogTitle>
					<DialogDescription>
						Catalogs are named buckets for documents. Each one binds to a vector
						store — that binding is what the ingest pipeline writes into and
						what catalog-scoped search reads from.
					</DialogDescription>
				</DialogHeader>

				<form
					onSubmit={form.handleSubmit(onSubmit)}
					className="flex flex-col gap-4"
				>
					<div className="flex flex-col gap-1.5">
						<Label htmlFor="cat-name">Name</Label>
						<Input
							id="cat-name"
							placeholder="support-kb"
							aria-invalid={errors.name ? true : undefined}
							{...form.register("name")}
						/>
						{errors.name ? (
							<p className="text-xs text-red-600">{errors.name.message}</p>
						) : null}
					</div>

					<div className="flex flex-col gap-1.5">
						<Label htmlFor="cat-description">Description (optional)</Label>
						<Input
							id="cat-description"
							placeholder="Customer support knowledge base"
							{...form.register("description")}
						/>
					</div>

					<div className="flex flex-col gap-1.5">
						<Label htmlFor="cat-vs">Vector store (optional)</Label>
						<Select
							value={form.watch("vectorStore") ?? ""}
							onValueChange={(v) => form.setValue("vectorStore", v)}
							disabled={vectorStores.isLoading}
						>
							<SelectTrigger id="cat-vs">
								<SelectValue
									placeholder={
										stores.length === 0
											? "No vector stores yet — create one first"
											: "Pick a vector store"
									}
								/>
							</SelectTrigger>
							<SelectContent>
								{stores.map((vs) => (
									<SelectItem key={vs.uid} value={vs.uid}>
										{vs.name}
										<span className="ml-2 text-xs text-slate-500">
											({vs.embedding.provider}:{vs.embedding.model})
										</span>
									</SelectItem>
								))}
							</SelectContent>
						</Select>
						<p className="text-xs text-slate-500">
							You can bind one later via the catalog's edit surface. Without a
							binding, the catalog can't be searched or ingested into.
						</p>
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
							{create.isPending ? "Creating…" : "Create catalog"}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}
