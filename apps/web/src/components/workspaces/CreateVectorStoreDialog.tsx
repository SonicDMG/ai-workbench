import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect } from "react";
import { useForm } from "react-hook-form";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { useCreateVectorStore } from "@/hooks/useVectorStores";
import { ApiError } from "@/lib/api";
import {
	type CreateVectorStoreInput,
	CreateVectorStoreInputSchema,
} from "@/lib/schemas";

/**
 * Create-vector-store dialog.
 *
 * Mirrors the shape of `CreateApiKeyDialog`: react-hook-form + zod
 * resolver, a single-shot mutation, toast on success/error. The
 * embedding block has sensible defaults for OpenAI
 * text-embedding-3-small because that's what most people are using;
 * operators who want a different provider change three fields.
 *
 * `dimension` is mirrored onto `embedding.dimension` at submit —
 * the runtime accepts both but rejects mismatch, and we'd rather
 * not make users type 1536 twice.
 */
export function CreateVectorStoreDialog({
	workspace,
	open,
	onOpenChange,
}: {
	workspace: string;
	open: boolean;
	onOpenChange: (v: boolean) => void;
}) {
	const create = useCreateVectorStore(workspace);
	const form = useForm<CreateVectorStoreInput>({
		resolver: zodResolver(CreateVectorStoreInputSchema),
		defaultValues: {
			name: "",
			vectorDimension: 1536,
			vectorSimilarity: "cosine",
			embedding: {
				provider: "openai",
				model: "text-embedding-3-small",
				endpoint: null,
				dimension: 1536,
				secretRef: "env:OPENAI_API_KEY",
			},
		},
	});

	useEffect(() => {
		if (!open) {
			form.reset();
			create.reset();
		}
	}, [open, form, create]);

	async function onSubmit(values: CreateVectorStoreInput) {
		// Keep the outer + embedding dimension in lock-step at submit
		// time so the backend doesn't 400 on mismatch when the user
		// only edited the top-level field.
		const normalized: CreateVectorStoreInput = {
			...values,
			embedding: { ...values.embedding, dimension: values.vectorDimension },
		};
		try {
			const vs = await create.mutateAsync(normalized);
			toast.success(`Vector store '${vs.name}' created`);
			onOpenChange(false);
		} catch (err) {
			const msg =
				err instanceof ApiError
					? `${err.code}: ${err.message}`
					: err instanceof Error
						? err.message
						: "Unknown error";
			toast.error("Couldn't create vector store", { description: msg });
		}
	}

	const errors = form.formState.errors;

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="max-w-xl">
				<DialogHeader>
					<DialogTitle>Create a vector store</DialogTitle>
					<DialogDescription>
						Provisions the descriptor and the underlying collection. If
						collection provisioning fails (wrong credentials, endpoint
						unreachable, …) the descriptor is rolled back so the two stores
						never drift.
					</DialogDescription>
				</DialogHeader>

				<form
					onSubmit={form.handleSubmit(onSubmit)}
					className="flex flex-col gap-4"
				>
					<div className="grid gap-4 sm:grid-cols-2">
						<div className="flex flex-col gap-1.5">
							<Label htmlFor="vs-name">Name</Label>
							<Input
								id="vs-name"
								placeholder="products"
								aria-invalid={errors.name ? true : undefined}
								{...form.register("name")}
							/>
							{errors.name ? (
								<p className="text-xs text-red-600">{errors.name.message}</p>
							) : (
								<p className="text-xs text-slate-500">
									Becomes the collection name in Astra (alphanumeric only).
								</p>
							)}
						</div>
						<div className="flex flex-col gap-1.5">
							<Label htmlFor="vs-similarity">Similarity metric</Label>
							<Select
								value={form.watch("vectorSimilarity")}
								onValueChange={(v) =>
									form.setValue(
										"vectorSimilarity",
										v as CreateVectorStoreInput["vectorSimilarity"],
									)
								}
							>
								<SelectTrigger id="vs-similarity">
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="cosine">cosine</SelectItem>
									<SelectItem value="dot">dot</SelectItem>
									<SelectItem value="euclidean">euclidean</SelectItem>
								</SelectContent>
							</Select>
						</div>
					</div>

					<div className="flex flex-col gap-1.5">
						<Label htmlFor="vs-dim">Vector dimension</Label>
						<Input
							id="vs-dim"
							type="number"
							min={1}
							aria-invalid={errors.vectorDimension ? true : undefined}
							{...form.register("vectorDimension", { valueAsNumber: true })}
						/>
						{errors.vectorDimension ? (
							<p className="text-xs text-red-600">
								{errors.vectorDimension.message}
							</p>
						) : (
							<p className="text-xs text-slate-500">
								Must match the embedding provider's output
								(text-embedding-3-small = 1536, cohere-embed-english-v3 = 1024,
								…).
							</p>
						)}
					</div>

					<div className="flex flex-col gap-3 rounded-lg border border-slate-200 bg-slate-50/60 p-4">
						<p className="text-sm font-medium text-slate-900">Embedding</p>
						<p className="text-xs text-slate-500 -mt-2">
							Declares the provider the runtime will embed against (or that
							Astra will run server-side via vectorize when the provider is
							supported). Leave as OpenAI if unsure.
						</p>

						<div className="grid gap-3 sm:grid-cols-2">
							<div className="flex flex-col gap-1.5">
								<Label htmlFor="vs-provider">Provider</Label>
								<Input
									id="vs-provider"
									placeholder="openai"
									aria-invalid={errors.embedding?.provider ? true : undefined}
									{...form.register("embedding.provider")}
								/>
								{errors.embedding?.provider ? (
									<p className="text-xs text-red-600">
										{errors.embedding.provider.message}
									</p>
								) : null}
							</div>
							<div className="flex flex-col gap-1.5">
								<Label htmlFor="vs-model">Model</Label>
								<Input
									id="vs-model"
									placeholder="text-embedding-3-small"
									aria-invalid={errors.embedding?.model ? true : undefined}
									{...form.register("embedding.model")}
								/>
								{errors.embedding?.model ? (
									<p className="text-xs text-red-600">
										{errors.embedding.model.message}
									</p>
								) : null}
							</div>
						</div>

						<div className="flex flex-col gap-1.5">
							<Label htmlFor="vs-secret">Secret ref</Label>
							<Input
								id="vs-secret"
								placeholder="env:OPENAI_API_KEY"
								aria-invalid={errors.embedding?.secretRef ? true : undefined}
								{...form.register("embedding.secretRef")}
							/>
							{errors.embedding?.secretRef ? (
								<p className="text-xs text-red-600">
									{errors.embedding.secretRef.message}
								</p>
							) : (
								<p className="text-xs text-slate-500">
									`&lt;provider&gt;:&lt;path&gt;` — `env:…` or `file:…`. The
									runtime resolves this before calling the embedding API.
								</p>
							)}
						</div>
					</div>

					<DialogFooter>
						<Button
							type="button"
							variant="ghost"
							onClick={() => onOpenChange(false)}
							disabled={create.isPending}
						>
							Cancel
						</Button>
						<Button type="submit" variant="brand" disabled={create.isPending}>
							{create.isPending ? "Creating…" : "Create vector store"}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}
