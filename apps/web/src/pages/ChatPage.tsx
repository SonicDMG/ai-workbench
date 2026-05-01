import { ArrowLeft } from "lucide-react";
import { Link, Navigate, useParams, useSearchParams } from "react-router-dom";
import { ErrorState, LoadingState } from "@/components/common/states";
import { Button } from "@/components/ui/button";
import { useAgents } from "@/hooks/useConversations";
import { useWorkspace } from "@/hooks/useWorkspaces";
import { ApiError, formatApiError } from "@/lib/api";
import { AgentPicker } from "./chat/AgentPicker";
import { ConversationSidebar } from "./chat/ConversationSidebar";
import {
	ConversationThread,
	EmptyConversationPane,
} from "./chat/ConversationThread";
import { CreateFirstAgent } from "./chat/CreateFirstAgent";

/**
 * Workspace-level chat surface.
 *
 * Lists the workspace's agents, lets the operator pick one, and runs a
 * conversation against `/agents/{a}/conversations/{c}/*`. When the
 * workspace has no agents yet, prompts the user to create their first
 * agent inline. Replies stream over SSE so tokens render as they
 * arrive.
 *
 * Per-area sub-components:
 * - {@link CreateFirstAgent} — empty-state for workspaces with 0 agents
 * - {@link AgentPicker} — header with the active-agent select
 * - {@link ConversationSidebar} — left rail listing conversations
 * - {@link ConversationThread} — right rail with the message list, SSE
 *   streaming reply, composer, and delete action
 * - {@link EmptyConversationPane} — right rail when no conversation is
 *   selected yet
 */
export function ChatPage() {
	const { workspaceId } = useParams<{ workspaceId: string }>();
	const [searchParams, setSearchParams] = useSearchParams();
	const activeAgentId = searchParams.get("agent");
	const activeConversationId = searchParams.get("conversation");

	const workspaceQuery = useWorkspace(workspaceId);
	const agentsQuery = useAgents(workspaceId);

	if (!workspaceId) return <Navigate to="/" replace />;
	if (workspaceQuery.isLoading)
		return <LoadingState label="Loading workspace…" />;
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
	const agents = agentsQuery.data ?? [];
	const activeAgent =
		agents.find((a) => a.agentId === activeAgentId) ?? agents[0] ?? null;

	const onSelectAgent = (agentId: string) => {
		const next = new URLSearchParams(searchParams);
		next.set("agent", agentId);
		next.delete("conversation");
		setSearchParams(next, { replace: false });
	};
	const onSelectConversation = (conversationId: string) => {
		const next = new URLSearchParams(searchParams);
		if (activeAgent) next.set("agent", activeAgent.agentId);
		next.set("conversation", conversationId);
		setSearchParams(next, { replace: false });
	};
	const onClearConversation = () => {
		const next = new URLSearchParams(searchParams);
		next.delete("conversation");
		setSearchParams(next, { replace: true });
	};

	return (
		<div className="flex flex-col gap-6">
			<Button variant="ghost" size="sm" asChild className="-ml-3 self-start">
				<Link to={`/workspaces/${workspaceId}`}>
					<ArrowLeft className="h-4 w-4" />
					{workspace.name}
				</Link>
			</Button>

			<div className="flex items-start justify-between gap-4">
				<div className="min-w-0">
					<h1 className="text-2xl font-semibold tracking-tight text-slate-900">
						Chat
					</h1>
					<p className="mt-1 text-sm text-slate-500">
						Talk to an agent in{" "}
						<span className="font-medium text-slate-700">{workspace.name}</span>
						.
					</p>
				</div>
			</div>

			{agentsQuery.isLoading ? (
				<LoadingState label="Loading agents…" />
			) : agentsQuery.isError ? (
				<ErrorState
					title="Couldn't load agents"
					message={formatApiError(agentsQuery.error)}
				/>
			) : agents.length === 0 ? (
				<CreateFirstAgent workspaceId={workspaceId} onCreated={onSelectAgent} />
			) : activeAgent ? (
				<>
					<AgentPicker
						agents={agents}
						activeAgentId={activeAgent.agentId}
						onSelect={onSelectAgent}
						workspaceId={workspaceId}
					/>
					<div className="grid grid-cols-[14rem_minmax(0,1fr)] gap-4 min-h-[28rem]">
						<ConversationSidebar
							workspaceId={workspaceId}
							agentId={activeAgent.agentId}
							activeConversationId={activeConversationId}
							onSelect={onSelectConversation}
						/>
						{activeConversationId ? (
							<ConversationThread
								key={activeConversationId}
								workspaceId={workspaceId}
								agent={activeAgent}
								conversationId={activeConversationId}
								onDeleted={onClearConversation}
							/>
						) : (
							<EmptyConversationPane
								workspaceId={workspaceId}
								agent={activeAgent}
								onCreated={(c) => onSelectConversation(c.conversationId)}
							/>
						)}
					</div>
				</>
			) : null}
		</div>
	);
}
