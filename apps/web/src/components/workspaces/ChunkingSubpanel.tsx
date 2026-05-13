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
	useChunkingServices,
	useCreateChunkingService,
	useDeleteChunkingService,
	useUpdateChunkingService,
} from "@/hooks/useServices";
import { formatApiError } from "@/lib/api";
import type {
	ChunkingServiceRecord,
	CreateChunkingServiceInput,
	UpdateChunkingServiceInput,
} from "@/lib/schemas";
import {
	CHUNKING_ENGINES,
	CHUNKING_PRESETS,
	CHUNKING_STRATEGIES,
	CUSTOM_OPTION,
} from "@/lib/service-catalog";
import {
	Field,
	PresetPicker,
	SelectWithCustom,
	ServiceCard,
	ServiceRow,
} from "./ServicesPanelHelpers";

const CHUNKING_BLANK: CreateChunkingServiceInput = {
	name: "",
	description: null,
	engine: "langchain_ts",
	strategy: "recursive",
};

export function ChunkingSubpanel({ workspace }: { workspace: string }) {
	const list = useChunkingServices(workspace);
	const create = useCreateChunkingService(workspace);
	const del = useDeleteChunkingService(workspace);
	const [open, setOpen] = useState(false);
	const [createOpen, setCreateOpen] = useState(false);
	const [editing, setEditing] = useState<ChunkingServiceRecord | null>(null);
	const {
		presetId,
		draft,
		setDraft,
		customMode,
		setCustomMode,
		applyPreset,
		reset,
	} = useServicePresetState<CreateChunkingServiceInput>({
		blank: CHUNKING_BLANK,
		presets: CHUNKING_PRESETS,
		customFields: [
			{
				key: "engine",
				isCustom: (input) =>
					!CHUNKING_ENGINES.some((e) => e.value === input.engine),
			},
			{
				key: "strategy",
				isCustom: (input) => {
					const known = CHUNKING_STRATEGIES[input.engine] ?? [];
					return (
						!!input.strategy && !known.some((s) => s.value === input.strategy)
					);
				},
			},
		],
	});
	const engineCustom = customMode.engine ?? false;
	const strategyCustom = customMode.strategy ?? false;

	function setEngine(value: string): void {
		if (value === CUSTOM_OPTION) {
			setCustomMode("engine", true);
			return;
		}
		setCustomMode("engine", false);
		setCustomMode("strategy", false);
		setDraft((d) => ({ ...d, engine: value, strategy: null }));
	}

	function setStrategy(value: string): void {
		if (value === CUSTOM_OPTION) {
			setCustomMode("strategy", true);
			return;
		}
		setCustomMode("strategy", false);
		setDraft((d) => ({ ...d, strategy: value }));
	}

	async function submit(): Promise<void> {
		try {
			await create.mutateAsync(draft);
			toast.success(`Chunking service '${draft.name}' created`);
			setCreateOpen(false);
			reset();
		} catch (err) {
			toast.error("Couldn't create", { description: formatApiError(err) });
		}
	}

	const knownStrategies = CHUNKING_STRATEGIES[draft.engine] ?? [];
	const submitDisabled = create.isPending || !draft.name || !draft.engine;

	return (
		<ServiceCard
			label="Chunking services"
			countLabel="chunking service"
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
			renderRow={(s: ChunkingServiceRecord) => (
				<ServiceRow
					key={s.chunkingServiceId}
					title={s.name}
					subtitle={`${s.engine}${s.strategy ? ` / ${s.strategy}` : ""}`}
					status={s.status}
					onEdit={() => setEditing(s)}
					onDelete={async () => {
						try {
							await del.mutateAsync(s.chunkingServiceId);
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
						<DialogTitle>New chunking service</DialogTitle>
						<DialogDescription>
							Pick a preset for one-click setup, or build a custom chunker.
						</DialogDescription>
					</DialogHeader>
					<div className="flex flex-col gap-3">
						<PresetPicker
							id="chunk-preset"
							help="Presets choose a supported LangChainTS-style strategy and chunk sizes. Start here unless you need a custom chunker."
							value={presetId}
							onChange={applyPreset}
							options={CHUNKING_PRESETS.map((p) => ({
								value: p.id,
								label: p.label,
								description: p.description,
							}))}
						/>
						<Field
							label="Name"
							help="A recognizable name for this chunking service. Knowledge bases show this name when choosing how documents are split."
							id="chunk-name"
							value={draft.name}
							onChange={(v) => setDraft((d) => ({ ...d, name: v }))}
						/>
						<SelectWithCustom
							label="Engine"
							help="The chunking family. langchain_ts uses the built-in recursive and line-based splitters; docling is reserved for layout-aware extraction."
							id="chunk-engine"
							value={draft.engine}
							custom={engineCustom}
							onChange={setEngine}
							onCustomChange={(v) =>
								setDraft((d) => ({ ...d, engine: v, strategy: null }))
							}
							options={CHUNKING_ENGINES}
							customPlaceholder="custom engine name"
						/>
						<SelectWithCustom
							label="Strategy"
							help="The splitting behavior inside the selected engine. Recursive is best for prose and markdown; line-based is best for CSV, JSONL, and logs."
							id="chunk-strategy"
							value={draft.strategy ?? ""}
							custom={strategyCustom}
							onChange={setStrategy}
							onCustomChange={(v) => setDraft((d) => ({ ...d, strategy: v }))}
							options={knownStrategies}
							customPlaceholder="custom strategy"
							disabled={!draft.engine}
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
			{editing ? (
				<EditChunkingDialog
					workspace={workspace}
					service={editing}
					onClose={() => setEditing(null)}
				/>
			) : null}
		</ServiceCard>
	);
}

function EditChunkingDialog({
	workspace,
	service,
	onClose,
}: {
	workspace: string;
	service: ChunkingServiceRecord;
	onClose: () => void;
}) {
	const update = useUpdateChunkingService(workspace, service.chunkingServiceId);
	const [draft, setDraft] = useState(() => ({
		name: service.name,
		engine: service.engine,
		strategy: service.strategy ?? "",
	}));

	async function submit(): Promise<void> {
		const patch: UpdateChunkingServiceInput = {
			name: draft.name.trim(),
			engine: draft.engine.trim(),
			strategy: draft.strategy.trim() || null,
		};
		try {
			await update.mutateAsync(patch);
			toast.success(`'${patch.name}' updated`);
			onClose();
		} catch (err) {
			toast.error("Couldn't save changes", {
				description: formatApiError(err),
			});
		}
	}

	const submitDisabled =
		update.isPending || !draft.name.trim() || !draft.engine.trim();

	return (
		<Dialog open onOpenChange={(v) => (!v ? onClose() : undefined)}>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>Edit chunking service</DialogTitle>
					<DialogDescription>{service.name}</DialogDescription>
				</DialogHeader>
				<div className="flex flex-col gap-3">
					<Field
						label="Name"
						help="Shown when choosing how a knowledge base splits documents."
						id="edit-chunk-name"
						value={draft.name}
						onChange={(v) => setDraft((d) => ({ ...d, name: v }))}
					/>
					<Field
						label="Engine"
						help="The chunking family, such as langchain_ts or docling."
						id="edit-chunk-engine"
						value={draft.engine}
						onChange={(v) => setDraft((d) => ({ ...d, engine: v }))}
					/>
					<Field
						label="Strategy"
						help="Optional splitting behavior inside the selected engine."
						id="edit-chunk-strategy"
						value={draft.strategy}
						onChange={(v) => setDraft((d) => ({ ...d, strategy: v }))}
						placeholder="recursive"
					/>
				</div>
				<DialogFooter>
					<Button variant="ghost" onClick={onClose} disabled={update.isPending}>
						Cancel
					</Button>
					<Button variant="brand" onClick={submit} disabled={submitDisabled}>
						{update.isPending ? "Saving…" : "Save changes"}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
