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
	EmbeddingServiceRecord,
	RerankingServiceRecord,
} from "@/lib/schemas";

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

function EmbeddingSubpanel({ workspace }: { workspace: string }) {
	const list = useEmbeddingServices(workspace);
	const create = useCreateEmbeddingService(workspace);
	const del = useDeleteEmbeddingService(workspace);
	const [open, setOpen] = useState(false);
	const [createOpen, setCreateOpen] = useState(false);
	const [name, setName] = useState("");
	const [provider, setProvider] = useState("openai");
	const [modelName, setModelName] = useState("");
	const [dimension, setDimension] = useState("1536");

	async function submit() {
		try {
			await create.mutateAsync({
				name,
				provider,
				modelName,
				embeddingDimension: Number(dimension),
			});
			toast.success(`Embedding service '${name}' created`);
			setCreateOpen(false);
			setName("");
			setModelName("");
		} catch (err) {
			toast.error("Couldn't create", { description: formatApiError(err) });
		}
	}

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
			onCreate={() => setCreateOpen(true)}
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
			<Dialog open={createOpen} onOpenChange={setCreateOpen}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>New embedding service</DialogTitle>
						<DialogDescription>
							Names a remote embedding endpoint plus the dimension/metric every
							KB bound to it must agree on.
						</DialogDescription>
					</DialogHeader>
					<div className="flex flex-col gap-3">
						<Field label="Name" id="emb-name" value={name} onChange={setName} />
						<Field
							label="Provider"
							id="emb-provider"
							value={provider}
							onChange={setProvider}
							placeholder="openai, mock, voyage…"
						/>
						<Field
							label="Model name"
							id="emb-model"
							value={modelName}
							onChange={setModelName}
							placeholder="text-embedding-3-small"
						/>
						<Field
							label="Dimension"
							id="emb-dim"
							value={dimension}
							onChange={setDimension}
							type="number"
						/>
					</div>
					<DialogFooter>
						<Button variant="ghost" onClick={() => setCreateOpen(false)}>
							Cancel
						</Button>
						<Button
							variant="brand"
							onClick={submit}
							disabled={create.isPending || !name || !modelName}
						>
							{create.isPending ? "Creating…" : "Create"}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</ServiceCard>
	);
}

function ChunkingSubpanel({ workspace }: { workspace: string }) {
	const list = useChunkingServices(workspace);
	const create = useCreateChunkingService(workspace);
	const del = useDeleteChunkingService(workspace);
	const [open, setOpen] = useState(false);
	const [createOpen, setCreateOpen] = useState(false);
	const [name, setName] = useState("");
	const [engine, setEngine] = useState("docling");

	async function submit() {
		try {
			await create.mutateAsync({ name, engine });
			toast.success(`Chunking service '${name}' created`);
			setCreateOpen(false);
			setName("");
		} catch (err) {
			toast.error("Couldn't create", { description: formatApiError(err) });
		}
	}

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
			onCreate={() => setCreateOpen(true)}
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
			<Dialog open={createOpen} onOpenChange={setCreateOpen}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>New chunking service</DialogTitle>
						<DialogDescription>
							A document chunker — engine identifies the runtime that splits
							source files into chunks for embedding.
						</DialogDescription>
					</DialogHeader>
					<div className="flex flex-col gap-3">
						<Field
							label="Name"
							id="chunk-name"
							value={name}
							onChange={setName}
						/>
						<Field
							label="Engine"
							id="chunk-engine"
							value={engine}
							onChange={setEngine}
							placeholder="docling, recursive-character…"
						/>
					</div>
					<DialogFooter>
						<Button variant="ghost" onClick={() => setCreateOpen(false)}>
							Cancel
						</Button>
						<Button
							variant="brand"
							onClick={submit}
							disabled={create.isPending || !name}
						>
							{create.isPending ? "Creating…" : "Create"}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</ServiceCard>
	);
}

function RerankingSubpanel({ workspace }: { workspace: string }) {
	const list = useRerankingServices(workspace);
	const create = useCreateRerankingService(workspace);
	const del = useDeleteRerankingService(workspace);
	const [open, setOpen] = useState(false);
	const [createOpen, setCreateOpen] = useState(false);
	const [name, setName] = useState("");
	const [provider, setProvider] = useState("cohere");
	const [modelName, setModelName] = useState("");

	async function submit() {
		try {
			await create.mutateAsync({ name, provider, modelName });
			toast.success(`Reranking service '${name}' created`);
			setCreateOpen(false);
			setName("");
			setModelName("");
		} catch (err) {
			toast.error("Couldn't create", { description: formatApiError(err) });
		}
	}

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
			onCreate={() => setCreateOpen(true)}
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
			<Dialog open={createOpen} onOpenChange={setCreateOpen}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>New reranking service</DialogTitle>
						<DialogDescription>
							Optional — KBs can leave their reranker null until you have one.
						</DialogDescription>
					</DialogHeader>
					<div className="flex flex-col gap-3">
						<Field label="Name" id="rer-name" value={name} onChange={setName} />
						<Field
							label="Provider"
							id="rer-provider"
							value={provider}
							onChange={setProvider}
							placeholder="cohere, mock…"
						/>
						<Field
							label="Model name"
							id="rer-model"
							value={modelName}
							onChange={setModelName}
							placeholder="rerank-english-v3.0"
						/>
					</div>
					<DialogFooter>
						<Button variant="ghost" onClick={() => setCreateOpen(false)}>
							Cancel
						</Button>
						<Button
							variant="brand"
							onClick={submit}
							disabled={create.isPending || !name || !modelName}
						>
							{create.isPending ? "Creating…" : "Create"}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</ServiceCard>
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
