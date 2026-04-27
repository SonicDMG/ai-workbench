import {
	Box,
	ChevronDown,
	ChevronRight,
	Plus,
	RefreshCw,
	Trash2,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { ErrorState, LoadingState } from "@/components/common/states";
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
import {
	useChunkingServices,
	useCreateChunkingService,
	useCreateEmbeddingService,
	useCreateRerankingService,
	useDeleteChunkingService,
	useDeleteEmbeddingService,
	useDeleteRerankingService,
	useEmbeddingServices,
	useRerankingServices,
} from "@/hooks/useServices";
import { formatApiError } from "@/lib/api";
import type {
	ChunkingServiceRecord,
	CreateChunkingServiceInput,
	CreateEmbeddingServiceInput,
	CreateRerankingServiceInput,
	EmbeddingServiceRecord,
	RerankingServiceRecord,
} from "@/lib/schemas";
import {
	CHUNKING_ENGINES,
	CHUNKING_PRESETS,
	CHUNKING_STRATEGIES,
	CUSTOM_OPTION,
	EMBEDDING_MODELS,
	EMBEDDING_PRESETS,
	EMBEDDING_PROVIDERS,
	RERANKING_MODELS,
	RERANKING_PRESETS,
	RERANKING_PROVIDERS,
} from "@/lib/service-catalog";

const PRESET_NONE = "_preset_none_";

/**
 * Workspace-scoped panel for the three execution-service surfaces.
 * Chunking, embedding, and reranking sit alongside each other because
 * a knowledge base composes one of each at create time.
 */
export function ServicesPanel({ workspace }: { workspace: string }) {
	return (
		<div className="flex flex-col gap-4">
			<div>
				<p className="text-sm font-medium text-slate-900">Execution services</p>
				<p className="text-xs text-slate-500 mt-0.5">
					Chunkers, embedders, and rerankers a knowledge base can bind to. A KB
					composes exactly one chunking + one embedding service at create time,
					plus an optional reranker.
				</p>
			</div>
			<EmbeddingSubpanel workspace={workspace} />
			<ChunkingSubpanel workspace={workspace} />
			<RerankingSubpanel workspace={workspace} />
		</div>
	);
}

/* ============================== Embedding ============================== */

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

function EmbeddingSubpanel({ workspace }: { workspace: string }) {
	const list = useEmbeddingServices(workspace);
	const create = useCreateEmbeddingService(workspace);
	const del = useDeleteEmbeddingService(workspace);
	const [open, setOpen] = useState(false);
	const [createOpen, setCreateOpen] = useState(false);
	const [presetId, setPresetId] = useState<string>(PRESET_NONE);
	const [draft, setDraft] =
		useState<CreateEmbeddingServiceInput>(EMBEDDING_BLANK);
	const [providerCustom, setProviderCustom] = useState(false);
	const [modelCustom, setModelCustom] = useState(false);

	function reset(): void {
		setPresetId(PRESET_NONE);
		setDraft(EMBEDDING_BLANK);
		setProviderCustom(false);
		setModelCustom(false);
	}

	function applyPreset(id: string): void {
		setPresetId(id);
		if (id === PRESET_NONE) {
			setDraft(EMBEDDING_BLANK);
			setProviderCustom(false);
			setModelCustom(false);
			return;
		}
		const preset = EMBEDDING_PRESETS.find((p) => p.id === id);
		if (!preset) return;
		setDraft(preset.input);
		setProviderCustom(
			!EMBEDDING_PROVIDERS.some((p) => p.value === preset.input.provider),
		);
		const knownModels = EMBEDDING_MODELS[preset.input.provider] ?? [];
		setModelCustom(
			!knownModels.some((m) => m.value === preset.input.modelName),
		);
	}

	function setProvider(value: string): void {
		if (value === CUSTOM_OPTION) {
			setProviderCustom(true);
			return;
		}
		setProviderCustom(false);
		setModelCustom(false);
		setDraft((d) => ({ ...d, provider: value, modelName: "" }));
	}

	function setModel(value: string): void {
		if (value === CUSTOM_OPTION) {
			setModelCustom(true);
			return;
		}
		setModelCustom(false);
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
							id="emb-name"
							value={draft.name}
							onChange={(v) => setDraft((d) => ({ ...d, name: v }))}
						/>
						<SelectWithCustom
							label="Provider"
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

/* ============================== Chunking =============================== */

const CHUNKING_BLANK: CreateChunkingServiceInput = {
	name: "",
	description: null,
	engine: "langchain_ts",
	strategy: "recursive",
};

function ChunkingSubpanel({ workspace }: { workspace: string }) {
	const list = useChunkingServices(workspace);
	const create = useCreateChunkingService(workspace);
	const del = useDeleteChunkingService(workspace);
	const [open, setOpen] = useState(false);
	const [createOpen, setCreateOpen] = useState(false);
	const [presetId, setPresetId] = useState<string>(PRESET_NONE);
	const [draft, setDraft] =
		useState<CreateChunkingServiceInput>(CHUNKING_BLANK);
	const [engineCustom, setEngineCustom] = useState(false);
	const [strategyCustom, setStrategyCustom] = useState(false);

	function reset(): void {
		setPresetId(PRESET_NONE);
		setDraft(CHUNKING_BLANK);
		setEngineCustom(false);
		setStrategyCustom(false);
	}

	function applyPreset(id: string): void {
		setPresetId(id);
		if (id === PRESET_NONE) {
			setDraft(CHUNKING_BLANK);
			setEngineCustom(false);
			setStrategyCustom(false);
			return;
		}
		const preset = CHUNKING_PRESETS.find((p) => p.id === id);
		if (!preset) return;
		setDraft(preset.input);
		setEngineCustom(
			!CHUNKING_ENGINES.some((e) => e.value === preset.input.engine),
		);
		const knownStrategies = CHUNKING_STRATEGIES[preset.input.engine] ?? [];
		setStrategyCustom(
			!!preset.input.strategy &&
				!knownStrategies.some((s) => s.value === preset.input.strategy),
		);
	}

	function setEngine(value: string): void {
		if (value === CUSTOM_OPTION) {
			setEngineCustom(true);
			return;
		}
		setEngineCustom(false);
		setStrategyCustom(false);
		setDraft((d) => ({ ...d, engine: value, strategy: null }));
	}

	function setStrategy(value: string): void {
		if (value === CUSTOM_OPTION) {
			setStrategyCustom(true);
			return;
		}
		setStrategyCustom(false);
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
							id="chunk-name"
							value={draft.name}
							onChange={(v) => setDraft((d) => ({ ...d, name: v }))}
						/>
						<SelectWithCustom
							label="Engine"
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
		</ServiceCard>
	);
}

/* ============================= Reranking =============================== */

const RERANKING_BLANK: CreateRerankingServiceInput = {
	name: "",
	description: null,
	provider: "cohere",
	modelName: "",
};

function RerankingSubpanel({ workspace }: { workspace: string }) {
	const list = useRerankingServices(workspace);
	const create = useCreateRerankingService(workspace);
	const del = useDeleteRerankingService(workspace);
	const [open, setOpen] = useState(false);
	const [createOpen, setCreateOpen] = useState(false);
	const [presetId, setPresetId] = useState<string>(PRESET_NONE);
	const [draft, setDraft] =
		useState<CreateRerankingServiceInput>(RERANKING_BLANK);
	const [providerCustom, setProviderCustom] = useState(false);
	const [modelCustom, setModelCustom] = useState(false);

	function reset(): void {
		setPresetId(PRESET_NONE);
		setDraft(RERANKING_BLANK);
		setProviderCustom(false);
		setModelCustom(false);
	}

	function applyPreset(id: string): void {
		setPresetId(id);
		if (id === PRESET_NONE) {
			setDraft(RERANKING_BLANK);
			setProviderCustom(false);
			setModelCustom(false);
			return;
		}
		const preset = RERANKING_PRESETS.find((p) => p.id === id);
		if (!preset) return;
		setDraft(preset.input);
		setProviderCustom(
			!RERANKING_PROVIDERS.some((p) => p.value === preset.input.provider),
		);
		const knownModels = RERANKING_MODELS[preset.input.provider] ?? [];
		setModelCustom(
			!knownModels.some((m) => m.value === preset.input.modelName),
		);
	}

	function setProvider(value: string): void {
		if (value === CUSTOM_OPTION) {
			setProviderCustom(true);
			return;
		}
		setProviderCustom(false);
		setModelCustom(false);
		setDraft((d) => ({ ...d, provider: value, modelName: "" }));
	}

	function setModel(value: string): void {
		if (value === CUSTOM_OPTION) {
			setModelCustom(true);
			return;
		}
		setModelCustom(false);
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
							id="rer-name"
							value={draft.name}
							onChange={(v) => setDraft((d) => ({ ...d, name: v }))}
						/>
						<SelectWithCustom
							label="Provider"
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

/* ============================== Helpers ================================ */

interface PresetOption {
	readonly value: string;
	readonly label: string;
	readonly description?: string;
}

function PresetPicker({
	id,
	value,
	onChange,
	options,
}: {
	id: string;
	value: string;
	onChange: (v: string) => void;
	options: readonly PresetOption[];
}) {
	const selected = options.find((o) => o.value === value);
	return (
		<div className="flex flex-col gap-1.5">
			<Label htmlFor={id}>Preset</Label>
			<Select value={value} onValueChange={onChange}>
				<SelectTrigger id={id}>
					<SelectValue placeholder="Pick a preset (or fill in below)" />
				</SelectTrigger>
				<SelectContent>
					<SelectItem value={PRESET_NONE}>None — custom</SelectItem>
					{options.map((o) => (
						<SelectItem key={o.value} value={o.value}>
							{o.label}
						</SelectItem>
					))}
				</SelectContent>
			</Select>
			{selected?.description ? (
				<p className="text-xs text-slate-500">{selected.description}</p>
			) : null}
		</div>
	);
}

interface SelectOption {
	readonly value: string;
	readonly label: string;
}

function SelectWithCustom({
	label,
	id,
	value,
	custom,
	onChange,
	onCustomChange,
	options,
	customPlaceholder,
	disabled,
}: {
	label: string;
	id: string;
	value: string;
	custom: boolean;
	onChange: (v: string) => void;
	onCustomChange: (v: string) => void;
	options: readonly SelectOption[];
	customPlaceholder?: string;
	disabled?: boolean;
}) {
	// Force the Select to display "Other…" when in custom mode by
	// using CUSTOM_OPTION as the controlled value. The text input
	// underneath drives the actual draft state. Parent components
	// already clear the dependent value when the parent option changes
	// (e.g. setProvider clears modelName) so we don't need a sync
	// effect here.
	const selectValue = custom
		? CUSTOM_OPTION
		: options.some((o) => o.value === value)
			? value
			: "";
	return (
		<div className="flex flex-col gap-1.5">
			<Label htmlFor={id}>{label}</Label>
			<Select
				value={selectValue}
				onValueChange={onChange}
				disabled={disabled || (options.length === 0 && !custom)}
			>
				<SelectTrigger id={id}>
					<SelectValue placeholder={`Pick a ${label.toLowerCase()}`} />
				</SelectTrigger>
				<SelectContent>
					{options.map((o) => (
						<SelectItem key={o.value} value={o.value}>
							{o.label}
						</SelectItem>
					))}
					<SelectItem value={CUSTOM_OPTION}>Other…</SelectItem>
				</SelectContent>
			</Select>
			{custom ? (
				<Input
					id={`${id}-custom`}
					value={value}
					onChange={(e) => onCustomChange(e.target.value)}
					placeholder={customPlaceholder}
				/>
			) : null}
		</div>
	);
}

interface ServiceCardProps<T> {
	label: string;
	countLabel: string;
	rows: readonly T[] | undefined;
	loading: boolean;
	error: string | null;
	onRetry: () => void;
	expanded: boolean;
	onToggle: () => void;
	onCreate: () => void;
	renderRow: (row: T) => React.ReactNode;
	children: React.ReactNode;
}

function ServiceCard<T>(props: ServiceCardProps<T>) {
	const rows = props.rows ?? [];
	return (
		<div className="rounded-lg border border-slate-200 bg-white">
			<div className="flex items-center gap-3 p-3">
				<button
					type="button"
					onClick={props.onToggle}
					className="flex flex-1 items-center gap-2 text-left"
					aria-expanded={props.expanded}
				>
					{props.expanded ? (
						<ChevronDown className="h-4 w-4 text-slate-400" />
					) : (
						<ChevronRight className="h-4 w-4 text-slate-400" />
					)}
					<Box className="h-4 w-4 text-slate-400" aria-hidden />
					<span className="font-medium text-slate-900">{props.label}</span>
					<span className="text-xs text-slate-500">
						{rows.length} {props.countLabel}
						{rows.length === 1 ? "" : "s"}
					</span>
				</button>
				<Button variant="secondary" size="sm" onClick={props.onCreate}>
					<Plus className="h-4 w-4" /> New
				</Button>
			</div>
			{props.expanded ? (
				<div className="border-t border-slate-100 bg-slate-50/50 p-3 flex flex-col gap-2">
					{props.loading ? (
						<LoadingState label={`Loading ${props.label.toLowerCase()}…`} />
					) : props.error ? (
						<ErrorState
							title="Couldn't load"
							message={props.error}
							actions={
								<Button variant="secondary" onClick={props.onRetry}>
									<RefreshCw className="h-4 w-4" /> Retry
								</Button>
							}
						/>
					) : rows.length === 0 ? (
						<p className="text-xs text-slate-500">
							None yet. Click <span className="font-medium">New</span> to add
							one.
						</p>
					) : (
						rows.map((row) => props.renderRow(row))
					)}
				</div>
			) : null}
			{props.children}
		</div>
	);
}

function ServiceRow({
	title,
	subtitle,
	status,
	onDelete,
}: {
	title: string;
	subtitle: string;
	status: string;
	onDelete: () => void;
}) {
	return (
		<div className="flex items-center gap-2 rounded-md bg-white border border-slate-200 px-2 py-1.5 text-sm">
			<span className="font-medium text-slate-900 truncate">{title}</span>
			<span className="text-xs text-slate-500 truncate">{subtitle}</span>
			<span className="ml-auto rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-600">
				{status}
			</span>
			<Button
				variant="ghost"
				size="sm"
				onClick={onDelete}
				aria-label={`Delete ${title}`}
			>
				<Trash2 className="h-4 w-4 text-red-600" />
			</Button>
		</div>
	);
}

function Field({
	label,
	id,
	value,
	onChange,
	placeholder,
	type,
}: {
	label: string;
	id: string;
	value: string;
	onChange: (v: string) => void;
	placeholder?: string;
	type?: string;
}) {
	return (
		<div className="flex flex-col gap-1.5">
			<Label htmlFor={id}>{label}</Label>
			<Input
				id={id}
				value={value}
				onChange={(e) => onChange(e.target.value)}
				placeholder={placeholder}
				type={type}
			/>
		</div>
	);
}
