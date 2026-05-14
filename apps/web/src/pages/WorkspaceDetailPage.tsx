import {
	ArrowLeft,
	Bot,
	Code2,
	Database,
	Pencil,
	Plug,
	Plus,
	Settings,
	Trash2,
} from "lucide-react";
import { useState } from "react";
import { Link, Navigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import { AgentForm } from "@/components/agents/AgentForm";
import { ErrorState, LoadingState } from "@/components/common/states";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { CreateKnowledgeBaseDialog } from "@/components/workspaces/CreateKnowledgeBaseDialog";
import { KindBadge } from "@/components/workspaces/KindBadge";
import { KnowledgeBasesPanel } from "@/components/workspaces/KnowledgeBasesPanel";
import { McpUrlButton } from "@/components/workspaces/McpUrlButton";
import {
	useAgents,
	useCreateAgent,
	useDeleteAgent,
	useLlmServices,
	useUpdateAgent,
} from "@/hooks/useConversations";
import { useFeatures } from "@/hooks/useFeatures";
import { useKnowledgeBases } from "@/hooks/useKnowledgeBases";
import { useRerankingServices } from "@/hooks/useServices";
import { useWorkspace } from "@/hooks/useWorkspaces";
import { ApiError, formatApiError } from "@/lib/api";
import type {
	AgentRecord,
	CreateAgentInput,
	UpdateAgentInput,
} from "@/lib/schemas";

export function WorkspaceDetailPage() {
	const { workspaceId } = useParams<{ workspaceId: string }>();
	const { data, isLoading, isError, error } = useWorkspace(workspaceId);
	const features = useFeatures();
	const mcpBaseUrl =
		features.data?.mcp.enabled === true ? features.data.mcp.baseUrl : null;

	if (!workspaceId) return <Navigate to="/" replace />;
	if (isLoading) return <LoadingState label="Loading workspace…" />;
	if (isError || !data) {
		const message =
			error instanceof ApiError && error.code === "workspace_not_found"
				? "This workspace doesn't exist or was deleted."
				: formatApiError(error);
		return (
			<ErrorState
				title="Couldn't load workspace"
				message={message}
				actions={
					<Button variant="secondary" asChild>
						<Link to="/">Back to workspaces</Link>
					</Button>
				}
			/>
		);
	}

	return (
		<div className="flex flex-col gap-6">
			<Button variant="ghost" size="sm" asChild className="-ml-3 self-start">
				<Link to="/">
					<ArrowLeft className="h-4 w-4" />
					All workspaces
				</Link>
			</Button>

			<div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
				<div className="min-w-0">
					<div className="flex flex-wrap items-center gap-3">
						<h1 className="truncate text-2xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">
							{data.name}
						</h1>
						<KindBadge kind={data.kind} />
					</div>
					<p className="mt-1 max-w-2xl text-sm text-slate-500 dark:text-slate-400">
						Build searchable knowledge bases and bind them to workspace agents.
					</p>
				</div>
				<div className="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto sm:shrink-0 sm:flex-wrap sm:items-center sm:justify-end">
					{data.kind === "astra" ? (
						<Button variant="secondary" className="justify-center" asChild>
							<Link to={`/workspaces/${data.workspaceId}/playground`}>
								<Code2 className="h-4 w-4" />
								Playground
							</Link>
						</Button>
					) : (
						<Button
							variant="secondary"
							className="justify-center"
							disabled
							title="Playground is available for Astra workspaces"
						>
							<Code2 className="h-4 w-4" />
							Playground
						</Button>
					)}
					{mcpBaseUrl ? (
						<McpUrlButton
							workspaceId={data.workspaceId}
							baseUrl={mcpBaseUrl}
							className="justify-center"
						/>
					) : null}
					<Button variant="secondary" className="justify-center" asChild>
						<Link to={`/workspaces/${data.workspaceId}/connect`}>
							<Plug className="h-4 w-4" />
							Connect
						</Link>
					</Button>
					<Button variant="secondary" className="justify-center" asChild>
						<Link to={`/workspaces/${data.workspaceId}/settings`}>
							<Settings className="h-4 w-4" />
							Settings
						</Link>
					</Button>
				</div>
			</div>

			<KnowledgeBaseHero workspaceId={data.workspaceId} />
			<AgentsHero workspaceId={data.workspaceId} />
		</div>
	);
}

function KnowledgeBaseHero({ workspaceId }: { workspaceId: string }) {
	const [createOpen, setCreateOpen] = useState(false);

	return (
		<>
			<Card className="overflow-hidden border-t-2 border-t-[var(--color-brand-500)] shadow-sm">
				<CardHeader className="flex flex-col items-stretch gap-4 space-y-0 bg-gradient-to-b from-[var(--color-brand-50)]/60 to-white pb-4 sm:flex-row sm:items-start sm:justify-between dark:to-slate-900">
					<div className="min-w-0">
						<CardTitle className="flex items-center gap-3 text-lg">
							<SectionIcon tone="brand">
								<Database className="h-4 w-4" />
							</SectionIcon>
							Knowledge bases
						</CardTitle>
						<p className="mt-2 pl-11 text-sm text-slate-600 dark:text-slate-400">
							Collections this workspace can search, ingest into, and expose to
							agents.
						</p>
					</div>
					<Button
						variant="brand"
						size="sm"
						className="w-full shrink-0 sm:w-auto"
						onClick={() => setCreateOpen(true)}
					>
						<Plus className="h-4 w-4" />
						New knowledge base
					</Button>
				</CardHeader>
				<CardContent className="pt-2">
					<KnowledgeBasesPanel workspace={workspaceId} />
				</CardContent>
			</Card>
			<CreateKnowledgeBaseDialog
				workspace={workspaceId}
				open={createOpen}
				onOpenChange={setCreateOpen}
			/>
		</>
	);
}

function AgentsHero({ workspaceId }: { workspaceId: string }) {
	const agents = useAgents(workspaceId);
	const knowledgeBases = useKnowledgeBases(workspaceId);
	const llmServices = useLlmServices(workspaceId);
	const rerankingServices = useRerankingServices(workspaceId);
	const [creating, setCreating] = useState(false);
	const [editing, setEditing] = useState<AgentRecord | null>(null);
	const [deleting, setDeleting] = useState<AgentRecord | null>(null);

	return (
		<Card className="overflow-hidden">
			<CardHeader className="flex flex-col items-stretch gap-4 space-y-0 sm:flex-row sm:items-start sm:justify-between">
				<div className="min-w-0">
					<CardTitle className="flex items-center gap-3 text-lg">
						<SectionIcon tone="brand">
							<Bot className="h-4 w-4" />
						</SectionIcon>
						Agents
					</CardTitle>
					<p className="mt-2 pl-11 text-sm text-slate-600 dark:text-slate-400">
						Workspace assistants that use these knowledge bases for chat and
						tools.
					</p>
				</div>
				<div className="flex w-full shrink-0 items-center gap-2 sm:w-auto">
					<Button
						variant="brand"
						className="w-full sm:w-auto"
						onClick={() => setCreating(true)}
					>
						<Plus className="h-4 w-4" />
						New agent
					</Button>
				</div>
			</CardHeader>
			<CardContent>
				{agents.isLoading ? (
					<LoadingState label="Loading agents…" />
				) : agents.isError ? (
					<ErrorState
						title="Couldn't load agents"
						message={formatApiError(agents.error)}
					/>
				) : (agents.data?.length ?? 0) === 0 ? (
					<div className="rounded-md border border-dashed border-slate-300 p-6 text-sm text-slate-600 dark:border-slate-600 dark:text-slate-400">
						No agents yet. Add one from a template or create a custom agent.
					</div>
				) : (
					<ul className="grid grid-cols-1 gap-3 md:grid-cols-2">
						{(agents.data ?? []).map((agent) => (
							<AgentSummaryCard
								key={agent.agentId}
								workspaceId={workspaceId}
								agent={agent}
								onEdit={() => setEditing(agent)}
								onDelete={() => setDeleting(agent)}
							/>
						))}
					</ul>
				)}
			</CardContent>
			<CreateAgentDialog
				workspace={workspaceId}
				open={creating}
				onOpenChange={setCreating}
				knowledgeBases={knowledgeBases.data ?? []}
				llmServices={llmServices.data ?? []}
				rerankingServices={rerankingServices.data ?? []}
			/>
			<EditAgentDialog
				workspace={workspaceId}
				agent={editing}
				onClose={() => setEditing(null)}
				knowledgeBases={knowledgeBases.data ?? []}
				llmServices={llmServices.data ?? []}
				rerankingServices={rerankingServices.data ?? []}
			/>
			<DeleteAgentConfirm
				workspace={workspaceId}
				agent={deleting}
				onClose={() => setDeleting(null)}
			/>
		</Card>
	);
}

function AgentSummaryCard({
	workspaceId,
	agent,
	onEdit,
	onDelete,
}: {
	workspaceId: string;
	agent: AgentRecord;
	onEdit: () => void;
	onDelete: () => void;
}) {
	const kbLabel = agent.knowledgeBaseIds.length
		? `${agent.knowledgeBaseIds.length} KB${agent.knowledgeBaseIds.length === 1 ? "" : "s"}`
		: "all KBs";
	return (
		<li className="group relative rounded-lg border border-slate-200 bg-white p-4 shadow-sm transition-colors hover:border-slate-300 dark:border-slate-700 dark:bg-slate-900 dark:hover:border-slate-600">
			<Link
				to={`/workspaces/${workspaceId}/chat?agent=${agent.agentId}`}
				aria-label={`Chat with ${agent.name}`}
				className="absolute inset-0 z-10 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-500)]"
			/>
			<div className="pointer-events-none flex h-full flex-col gap-4 pr-16">
				<div className="flex items-start gap-3">
					<div
						aria-hidden="true"
						className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-[var(--color-brand-100)] text-[var(--color-brand-700)] dark:bg-[var(--color-brand-900)]/40 dark:text-[var(--color-brand-200)]"
					>
						<Bot className="h-5 w-5" />
					</div>
					<div className="min-w-0 flex-1">
						<p className="truncate text-sm font-semibold text-slate-900 dark:text-slate-100">
							{agent.name}
						</p>
						<p className="mt-1 line-clamp-2 text-xs leading-5 text-slate-500 dark:text-slate-400">
							{agent.description || "No description"}
						</p>
					</div>
				</div>
				<div className="mt-auto flex items-center gap-3">
					<div className="min-w-0">
						<span className="inline-flex rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] font-medium text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
							{kbLabel}
						</span>
					</div>
				</div>
			</div>
			<div className="absolute right-3 top-3 z-20 flex items-center gap-1">
				<Button
					type="button"
					size="sm"
					variant="ghost"
					onClick={onEdit}
					aria-label={`Edit ${agent.name}`}
					title={`Edit ${agent.name}`}
				>
					<Pencil className="h-4 w-4 text-slate-600 dark:text-slate-400" />
				</Button>
				<Button
					type="button"
					size="sm"
					variant="ghost"
					onClick={onDelete}
					aria-label={`Delete ${agent.name}`}
					title={`Delete ${agent.name}`}
				>
					<Trash2 className="h-4 w-4 text-red-600" />
				</Button>
			</div>
		</li>
	);
}

interface AgentDialogContext {
	readonly workspace: string;
	readonly knowledgeBases: ReturnType<typeof useKnowledgeBases>["data"];
	readonly llmServices: ReturnType<typeof useLlmServices>["data"];
	readonly rerankingServices: ReturnType<typeof useRerankingServices>["data"];
}

function CreateAgentDialog({
	workspace,
	open,
	onOpenChange,
	knowledgeBases,
	llmServices,
	rerankingServices,
}: AgentDialogContext & {
	open: boolean;
	onOpenChange: (v: boolean) => void;
}) {
	const create = useCreateAgent(workspace);
	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="max-w-2xl">
				<DialogHeader>
					<DialogTitle>New agent</DialogTitle>
					<DialogDescription>
						Define a workspace-scoped agent with its own persona and RAG
						defaults.
					</DialogDescription>
				</DialogHeader>
				<AgentForm
					mode="create"
					knowledgeBases={knowledgeBases ?? []}
					llmServices={llmServices ?? []}
					rerankingServices={rerankingServices ?? []}
					submitting={create.isPending}
					onSubmit={async (values) => {
						try {
							await create.mutateAsync(values as CreateAgentInput);
							toast.success("Agent created");
							onOpenChange(false);
						} catch (err) {
							toast.error("Couldn't create agent", {
								description: formatApiError(err),
							});
						}
					}}
					onCancel={() => onOpenChange(false)}
				/>
			</DialogContent>
		</Dialog>
	);
}

function EditAgentDialog({
	workspace,
	agent,
	onClose,
	knowledgeBases,
	llmServices,
	rerankingServices,
}: AgentDialogContext & {
	agent: AgentRecord | null;
	onClose: () => void;
}) {
	const update = useUpdateAgent(workspace, agent?.agentId ?? "__missing__");
	if (!agent) return null;
	return (
		<Dialog open onOpenChange={(o) => (!o ? onClose() : undefined)}>
			<DialogContent className="max-w-2xl">
				<DialogHeader>
					<DialogTitle>Edit agent</DialogTitle>
					<DialogDescription>{agent.name}</DialogDescription>
				</DialogHeader>
				<AgentForm
					mode="edit"
					agent={agent}
					knowledgeBases={knowledgeBases ?? []}
					llmServices={llmServices ?? []}
					rerankingServices={rerankingServices ?? []}
					submitting={update.isPending}
					onSubmit={async (values) => {
						try {
							await update.mutateAsync(values as UpdateAgentInput);
							toast.success("Agent updated");
							onClose();
						} catch (err) {
							toast.error("Couldn't save changes", {
								description: formatApiError(err),
							});
						}
					}}
					onCancel={onClose}
				/>
			</DialogContent>
		</Dialog>
	);
}

function DeleteAgentConfirm({
	workspace,
	agent,
	onClose,
}: {
	workspace: string;
	agent: AgentRecord | null;
	onClose: () => void;
}) {
	const del = useDeleteAgent(workspace);
	if (!agent) return null;
	return (
		<Dialog open onOpenChange={(o) => (!o ? onClose() : undefined)}>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>Delete this agent?</DialogTitle>
					<DialogDescription>
						<strong>{agent.name}</strong> will be deleted along with all of its
						conversations and message history. This cannot be undone.
					</DialogDescription>
				</DialogHeader>
				<DialogFooter>
					<Button variant="ghost" onClick={onClose} disabled={del.isPending}>
						Cancel
					</Button>
					<Button
						variant="destructive"
						disabled={del.isPending}
						onClick={async () => {
							try {
								await del.mutateAsync(agent.agentId);
								toast.success("Agent deleted");
								onClose();
							} catch (err) {
								toast.error("Couldn't delete agent", {
									description: formatApiError(err),
								});
							}
						}}
					>
						{del.isPending ? "Deleting…" : "Delete agent"}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

function SectionIcon({
	tone,
	children,
}: {
	tone: "brand" | "slate";
	children: React.ReactNode;
}) {
	const cls =
		tone === "brand"
			? "bg-[var(--color-brand-100)] text-[var(--color-brand-700)]"
			: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400";
	return (
		<div
			aria-hidden="true"
			className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md ${cls}`}
		>
			{children}
		</div>
	);
}
