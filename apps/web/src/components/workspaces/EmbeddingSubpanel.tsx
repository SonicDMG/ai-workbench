import { useState } from "react";
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
import { useServicePresetState } from "@/hooks/useServicePresetState";
import {
	useCreateEmbeddingService,
	useDeleteEmbeddingService,
	useEmbeddingServices,
} from "@/hooks/useServices";
import { formatApiError } from "@/lib/api";
import type {
	CreateEmbeddingServiceInput,
	EmbeddingServiceRecord,
} from "@/lib/schemas";
import {
	CUSTOM_OPTION,
	EMBEDDING_MODELS,
	EMBEDDING_PRESETS,
	EMBEDDING_PROVIDERS,
} from "@/lib/service-catalog";
import {
	Field,
	PresetPicker,
	SelectWithCustom,
	ServiceCard,
	ServiceRow,
} from "./ServicesPanelHelpers";

const EMBEDDING_BLANK: CreateEmbeddingServiceInput = {
	name: "",
	description: null,
	provider: "openai",
	modelName: "",
	embeddingDimension: 1536,
	distanceMetric: "cosine",
	authType: "api_key",
	credentialRef: "env:OPENAI_API_KEY",
};

export function EmbeddingSubpanel({ workspace }: { workspace: string }) {
	const list = useEmbeddingServices(workspace);
	const create = useCreateEmbeddingService(workspace);
	const del = useDeleteEmbeddingService(workspace);
	const [open, setOpen] = useState(false);
	const [createOpen, setCreateOpen] = useState(false);
	const {
		presetId,
		draft,
		setDraft,
		customMode,
		setCustomMode,
		applyPreset,
		reset,
	} = useServicePresetState<CreateEmbeddingServiceInput>({
		blank: EMBEDDING_BLANK,
		presets: EMBEDDING_PRESETS,
		customFields: [
			{
				key: "provider",
				isCustom: (input) =>
					!EMBEDDING_PROVIDERS.some((p) => p.value === input.provider),
			},
			{
				key: "model",
				isCustom: (input) => {
					const known = EMBEDDING_MODELS[input.provider] ?? [];
					return !known.some((m) => m.value === input.modelName);
				},
			},
		],
	});
	const providerCustom = customMode.provider ?? false;
	const modelCustom = customMode.model ?? false;

	function setProvider(value: string): void {
		if (value === CUSTOM_OPTION) {
			setCustomMode("provider", true);
			return;
		}
		setCustomMode("provider", false);
		setCustomMode("model", false);
		setDraft((d) => ({ ...d, provider: value, modelName: "" }));
	}

	function setModel(value: string): void {
		if (value === CUSTOM_OPTION) {
			setCustomMode("model", true);
			return;
		}
		setCustomMode("model", false);
		const knownDim = EMBEDDING_MODELS[draft.provider]?.find(
			(m) => m.value === value,
		)?.dimension;
		setDraft((d) => ({
			...d,
			modelName: value,
			...(knownDim ? { embeddingDimension: knownDim } : {}),
		}));
	}

	async function submit(): Promise<void> {
		try {
			await create.mutateAsync({
				...draft,
				name: draft.name.trim() || draft.modelName,
			});
			toast.success(
				`Embedding service '${draft.name || draft.modelName}' created`,
			);
			setCreateOpen(false);
			reset();
		} catch (err) {
			toast.error("Couldn't create", { description: formatApiError(err) });
		}
	}

	const knownModels = EMBEDDING_MODELS[draft.provider] ?? [];
	const submitDisabled =
		create.isPending ||
		!draft.name ||
		!draft.provider ||
		!draft.modelName ||
		!Number.isFinite(draft.embeddingDimension) ||
		draft.embeddingDimension <= 0;

	return (
		<ServiceCard
			label="Embedding services"
			countLabel="embedding service"
			rows={list.data}
			loading={list.isLoading}
			error={list.isError ? list.error.message : null}
			onRetry={() => list.refetch()}
			expanded={open}
			onToggle={() => setOpen((v) => !v)}
			onCreate={() => {
				reset();
				setCreateOpen(true);
			}}
			renderRow={(s: EmbeddingServiceRecord) => (
				<ServiceRow
					key={s.embeddingServiceId}
					title={s.name}
					subtitle={`${s.provider}:${s.modelName} • dim ${s.embeddingDimension} • ${s.distanceMetric}`}
					status={s.status}
					onDelete={async () => {
						try {
							await del.mutateAsync(s.embeddingServiceId);
							toast.success(`'${s.name}' deleted`);
						} catch (err) {
							toast.error("Couldn't delete", {
								description: formatApiError(err),
							});
						}
					}}
				/>
			)}
		>
			<Dialog
				open={createOpen}
				onOpenChange={(v) => {
					setCreateOpen(v);
					if (!v) reset();
				}}
			>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>New embedding service</DialogTitle>
						<DialogDescription>
							Pick a preset for one-click setup, or build a custom embedding
							endpoint.
						</DialogDescription>
					</DialogHeader>
					<div className="flex flex-col gap-3">
						<PresetPicker
							id="emb-preset"
							help="Presets fill in the common provider, model, dimension, and credential reference values. Choose custom when connecting a provider not listed here."
							value={presetId}
							onChange={applyPreset}
							options={EMBEDDING_PRESETS.map((p) => ({
								value: p.id,
								label: p.label,
								description: p.description,
							}))}
						/>
						<Field
							label="Name"
							help="A recognizable name for this embedding service. Knowledge bases show this name when you choose how documents should be embedded."
							id="emb-name"
							value={draft.name}
							onChange={(v) => setDraft((d) => ({ ...d, name: v }))}
						/>
						<SelectWithCustom
							label="Provider"
							help="The embedding provider the runtime will call, such as OpenAI or Cohere. The provider controls which model names and credentials are valid."
							id="emb-provider"
							value={draft.provider}
							custom={providerCustom}
							onChange={setProvider}
							onCustomChange={(v) =>
								setDraft((d) => ({ ...d, provider: v, modelName: "" }))
							}
							options={EMBEDDING_PROVIDERS}
							customPlaceholder="voyage, jina, mistral…"
						/>
						<SelectWithCustom
							label="Model"
							help="The embedding model to use. Its native vector dimension must match the dimension stored on this service."
							id="emb-model"
							value={draft.modelName}
							custom={modelCustom}
							onChange={setModel}
							onCustomChange={(v) => setDraft((d) => ({ ...d, modelName: v }))}
							options={knownModels.map((m) => ({
								value: m.value,
								label: m.value,
							}))}
							customPlaceholder="text-embedding-3-small"
							disabled={!draft.provider}
						/>
						<Field
							label="Dimension"
							help="The number of floats each embedding returns. This must match the model and the vector collection dimension."
							id="emb-dim"
							value={String(draft.embeddingDimension)}
							onChange={(v) =>
								setDraft((d) => ({
									...d,
									embeddingDimension: Number(v) || 0,
								}))
							}
							type="number"
						/>
						<Field
							label="Secret ref"
							help="Where the runtime reads the provider credential, for example env:OPENAI_API_KEY. Keep raw API keys out of this field."
							id="emb-secret-ref"
							value={draft.credentialRef ?? ""}
							onChange={(v) =>
								setDraft((d) => ({ ...d, credentialRef: v || null }))
							}
							placeholder="env:OPENAI_API_KEY"
						/>
					</div>
					<DialogFooter>
						<Button variant="ghost" onClick={() => setCreateOpen(false)}>
							Cancel
						</Button>
						<Button variant="brand" onClick={submit} disabled={submitDisabled}>
							{create.isPending ? "Creating…" : "Create"}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</ServiceCard>
	);
}
