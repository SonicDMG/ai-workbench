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
	useCreateRerankingService,
	useDeleteRerankingService,
	useRerankingServices,
} from "@/hooks/useServices";
import { formatApiError } from "@/lib/api";
import type {
	CreateRerankingServiceInput,
	RerankingServiceRecord,
} from "@/lib/schemas";
import {
	CUSTOM_OPTION,
	RERANKING_MODELS,
	RERANKING_PRESETS,
	RERANKING_PROVIDERS,
} from "@/lib/service-catalog";
import {
	Field,
	PresetPicker,
	SelectWithCustom,
	ServiceCard,
	ServiceRow,
} from "./ServicesPanelHelpers";

const RERANKING_BLANK: CreateRerankingServiceInput = {
	name: "",
	description: null,
	provider: "cohere",
	modelName: "",
};

export function RerankingSubpanel({ workspace }: { workspace: string }) {
	const list = useRerankingServices(workspace);
	const create = useCreateRerankingService(workspace);
	const del = useDeleteRerankingService(workspace);
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
	} = useServicePresetState<CreateRerankingServiceInput>({
		blank: RERANKING_BLANK,
		presets: RERANKING_PRESETS,
		customFields: [
			{
				key: "provider",
				isCustom: (input) =>
					!RERANKING_PROVIDERS.some((p) => p.value === input.provider),
			},
			{
				key: "model",
				isCustom: (input) => {
					const known = RERANKING_MODELS[input.provider] ?? [];
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
		setDraft((d) => ({ ...d, modelName: value }));
	}

	async function submit(): Promise<void> {
		try {
			await create.mutateAsync({
				...draft,
				name: draft.name.trim() || draft.modelName,
			});
			toast.success(
				`Reranking service '${draft.name || draft.modelName}' created`,
			);
			setCreateOpen(false);
			reset();
		} catch (err) {
			toast.error("Couldn't create", { description: formatApiError(err) });
		}
	}

	const knownModels = RERANKING_MODELS[draft.provider] ?? [];
	const submitDisabled =
		create.isPending || !draft.name || !draft.provider || !draft.modelName;

	return (
		<ServiceCard
			label="Reranking services"
			countLabel="reranking service"
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
			renderRow={(s: RerankingServiceRecord) => (
				<ServiceRow
					key={s.rerankingServiceId}
					title={s.name}
					subtitle={`${s.provider}:${s.modelName}`}
					status={s.status}
					onDelete={async () => {
						try {
							await del.mutateAsync(s.rerankingServiceId);
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
						<DialogTitle>New reranking service</DialogTitle>
						<DialogDescription>
							Optional — KBs can leave their reranker null until you have one.
						</DialogDescription>
					</DialogHeader>
					<div className="flex flex-col gap-3">
						<PresetPicker
							id="rer-preset"
							help="Presets fill in common reranking providers and models. Reranking is optional for a knowledge base."
							value={presetId}
							onChange={applyPreset}
							options={RERANKING_PRESETS.map((p) => ({
								value: p.id,
								label: p.label,
								description: p.description,
							}))}
						/>
						<Field
							label="Name"
							help="A recognizable name for this reranking service. Knowledge bases show this name when selecting an optional reranker."
							id="rer-name"
							value={draft.name}
							onChange={(v) => setDraft((d) => ({ ...d, name: v }))}
						/>
						<SelectWithCustom
							label="Provider"
							help="The service that will rerank retrieved candidates after vector search returns them."
							id="rer-provider"
							value={draft.provider}
							custom={providerCustom}
							onChange={setProvider}
							onCustomChange={(v) =>
								setDraft((d) => ({ ...d, provider: v, modelName: "" }))
							}
							options={RERANKING_PROVIDERS}
							customPlaceholder="voyage, jina…"
						/>
						<SelectWithCustom
							label="Model"
							help="The reranking model name to send to the provider."
							id="rer-model"
							value={draft.modelName}
							custom={modelCustom}
							onChange={setModel}
							onCustomChange={(v) => setDraft((d) => ({ ...d, modelName: v }))}
							options={knownModels.map((m) => ({
								value: m.value,
								label: m.value,
							}))}
							customPlaceholder="rerank-english-v3.0"
							disabled={!draft.provider}
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
