import {
	ArrowLeft,
	Bot,
	MessageSquare,
	Pencil,
	Plus,
	Sparkles,
	Trash2,
} from "lucide-react";
import { useState } from "react";
import { Link, Navigate, useParams } from "react-router-dom";
import { AgentFormDialog } from "@/components/agents/AgentFormDialog";
import { AgentTemplateGallery } from "@/components/agents/AgentTemplateGallery";
import { DeleteAgentDialog } from "@/components/agents/DeleteAgentDialog";
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
import { useAgents, useLlmServices } from "@/hooks/useConversations";
import { useKnowledgeBases } from "@/hooks/useKnowledgeBases";
import { useRerankingServices } from "@/hooks/useServices";
import { useWorkspace } from "@/hooks/useWorkspaces";
import { ApiError, formatApiError } from "@/lib/api";
import type { AgentRecord } from "@/lib/schemas";
import { formatDate } from "@/lib/utils";

/**
 * Workspace-level agent management page.
 *
 * Each agent row exposes inline edit / delete dialogs. The "Chat"
 * link navigates to ChatPage with that agent preselected. LLM service
 * setup lives under workspace settings; agents still read those
 * services here for binding choices.
 */
export function AgentsPage() {
	const { workspaceId } = useParams<{ workspaceId: string }>();
	const workspaceQuery = useWorkspace(workspaceId);

	if (!workspaceId) return <Navigate to="/" replace />;
	if (workspaceQuery.isLoading) {
		return <LoadingState label="Loading workspace…" />;
	}
	if (workspaceQuery.isError || !workspaceQuery.data) {
		const message =
			workspaceQuery.error instanceof ApiError &&
			workspaceQuery.error.code === "workspace_not_found"
				? "This workspace doesn't exist or was deleted."
				: formatApiError(workspaceQuery.error);
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

	const workspace = workspaceQuery.data;

	return (
		<div className="mx-auto max-w-5xl flex flex-col gap-6 px-4 py-8">
			<div className="flex items-center justify-between gap-3">
				<div className="min-w-0">
					<Button variant="ghost" size="sm" asChild>
						<Link
							to={`/workspaces/${workspace.workspaceId}`}
							className="gap-1.5"
						>
							<ArrowLeft className="h-3.5 w-3.5" />
							Back to workspace
						</Link>
					</Button>
					<h1 className="mt-2 text-2xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">
						Agents
					</h1>
					<p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
						{workspace.name} · Manage workspace agents and their knowledge-base
						scope.
					</p>
				</div>
			</div>

			<AgentsCard workspace={workspace.workspaceId} />
		</div>
	);
}

function AgentsCard({ workspace }: { workspace: string }) {
	const list = useAgents(workspace);
	const llmServices = useLlmServices(workspace);
	const knowledgeBases = useKnowledgeBases(workspace);
	const rerankingServices = useRerankingServices(workspace);
	const [creating, setCreating] = useState(false);
	const [templating, setTemplating] = useState(false);
	const [editing, setEditing] = useState<AgentRecord | null>(null);
	const [deleting, setDeleting] = useState<AgentRecord | null>(null);

	if (list.isLoading) return <LoadingState label="Loading agents…" />;
	if (list.isError) {
		return (
			<ErrorState
				title="Couldn't load agents"
				message={formatApiError(list.error)}
			/>
		);
	}

	const agents = list.data ?? [];

	return (
		<Card>
			<CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
				<div>
					<CardTitle className="flex items-center gap-2">
						<Bot className="h-5 w-5 text-slate-500 dark:text-slate-400" />
						Agents
					</CardTitle>
					<p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
						Each agent carries a system prompt, default RAG scope, and optional
						LLM service binding.
					</p>
				</div>
				<div className="flex items-center gap-2">
					<Button
						variant="secondary"
						onClick={() => setTemplating(true)}
						title="Spin up a tuned agent from the template catalog — each template ships a persona, system prompt, and tool-use guidance you can edit after creation."
					>
						<Sparkles className="h-4 w-4" />
						From template
					</Button>
					<Button onClick={() => setCreating(true)}>
						<Plus className="h-4 w-4" />
						New agent
					</Button>
				</div>
			</CardHeader>
			<CardContent>
				{agents.length === 0 ? (
					<div className="rounded-md border border-dashed border-slate-300 p-6 text-center dark:border-slate-600">
						<p className="text-sm text-slate-600 dark:text-slate-400">
							No agents yet.
						</p>
						<p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
							Create one to start running conversations against this workspace.
						</p>
					</div>
				) : (
					<ul className="divide-y divide-slate-100 dark:divide-slate-800">
						{agents.map((agent) => (
							<AgentRow
								key={agent.agentId}
								workspace={workspace}
								agent={agent}
								onEdit={() => setEditing(agent)}
								onDelete={() => setDeleting(agent)}
							/>
						))}
					</ul>
				)}
			</CardContent>

			<AgentFormDialog
				workspace={workspace}
				mode="create"
				open={creating}
				onOpenChange={setCreating}
				knowledgeBases={knowledgeBases.data ?? []}
				llmServices={llmServices.data ?? []}
				rerankingServices={rerankingServices.data ?? []}
			/>
			<TemplateGalleryDialog
				workspace={workspace}
				existingAgents={agents}
				open={templating}
				onOpenChange={setTemplating}
			/>
			<AgentFormDialog
				workspace={workspace}
				mode="edit"
				agent={editing}
				open={editing !== null}
				onOpenChange={(o) => {
					if (!o) setEditing(null);
				}}
				knowledgeBases={knowledgeBases.data ?? []}
				llmServices={llmServices.data ?? []}
				rerankingServices={rerankingServices.data ?? []}
			/>
			<DeleteAgentDialog
				workspace={workspace}
				agent={deleting}
				onClose={() => setDeleting(null)}
			/>
		</Card>
	);
}

function TemplateGalleryDialog({
	workspace,
	existingAgents,
	open,
	onOpenChange,
}: {
	workspace: string;
	existingAgents: AgentRecord[];
	open: boolean;
	onOpenChange: (open: boolean) => void;
}) {
	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="max-w-2xl">
				<DialogHeader>
					<DialogTitle>Add an agent from the template catalog</DialogTitle>
					<DialogDescription>
						Templates ship with a tuned persona and tool-use guidance. Pick one
						to instantiate it as a new agent in this workspace — you can edit or
						delete it after.
					</DialogDescription>
				</DialogHeader>
				<div className="max-h-[60vh] overflow-y-auto pr-1">
					<AgentTemplateGallery
						workspaceId={workspace}
						existingAgents={existingAgents}
					/>
				</div>
				<DialogFooter>
					<Button variant="ghost" onClick={() => onOpenChange(false)}>
						Done
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

function AgentRow({
	workspace,
	agent,
	onEdit,
	onDelete,
}: {
	workspace: string;
	agent: AgentRecord;
	onEdit: () => void;
	onDelete: () => void;
}) {
	const llmLabel = agent.llmServiceId
		? `bound to LLM service ${agent.llmServiceId.slice(0, 8)}…`
		: "uses runtime default chat config";
	const kbLabel = agent.knowledgeBaseIds.length
		? `${agent.knowledgeBaseIds.length} KB${agent.knowledgeBaseIds.length === 1 ? "" : "s"} bound`
		: "draws from all KBs";
	const toolLabel = agent.toolIds.length
		? `${agent.toolIds.length} tool${agent.toolIds.length === 1 ? "" : "s"}`
		: "all tools";
	return (
		<li className="flex items-start justify-between gap-3 py-3">
			<div className="min-w-0 flex-1">
				<p className="text-sm font-semibold truncate">{agent.name}</p>
				{agent.description ? (
					<p className="mt-0.5 text-xs text-slate-600 truncate dark:text-slate-400">
						{agent.description}
					</p>
				) : null}
				<p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
					{llmLabel} · {kbLabel} · {toolLabel}
					{agent.rerankEnabled ? " · reranking on" : ""} · updated{" "}
					{formatDate(agent.updatedAt)}
				</p>
			</div>
			<div className="flex shrink-0 gap-1">
				<Button size="sm" variant="ghost" asChild title="Open chat">
					<Link to={`/workspaces/${workspace}/chat?agent=${agent.agentId}`}>
						<MessageSquare className="h-4 w-4" />
					</Link>
				</Button>
				<Button size="sm" variant="ghost" onClick={onEdit} title="Edit agent">
					<Pencil className="h-4 w-4" />
				</Button>
				<Button
					size="sm"
					variant="ghost"
					onClick={onDelete}
					title="Delete agent"
				>
					<Trash2 className="h-4 w-4 text-red-600" />
				</Button>
			</div>
		</li>
	);
}
