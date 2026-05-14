import { ArrowLeft } from "lucide-react";
import { Link, Navigate, useParams, useSearchParams } from "react-router-dom";
import { ErrorState, LoadingState } from "@/components/common/states";
import { Button } from "@/components/ui/button";
import { useAgents, useConversationMessages } from "@/hooks/useConversations";
import { useWorkspace } from "@/hooks/useWorkspaces";
import { ApiError, formatApiError } from "@/lib/api";
import { AgentPicker } from "./chat/AgentPicker";
import { ConversationSidebar } from "./chat/ConversationSidebar";
import {
	ConversationThread,
	EmptyConversationPane,
} from "./chat/ConversationThread";
import { CreateFirstAgent } from "./chat/CreateFirstAgent";
import { RetrievedContextPanel } from "./chat/RetrievedContextPanel";

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
					<h1 className="text-2xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">
						Chat
					</h1>
					<p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
						Talk to an agent in{" "}
						<span className="font-medium text-slate-700 dark:text-slate-300">
							{workspace.name}
						</span>
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
					<ChatLayout
						workspaceId={workspaceId}
						agentId={activeAgent.agentId}
						activeConversationId={activeConversationId}
						onSelectConversation={onSelectConversation}
					>
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
					</ChatLayout>
				</>
			) : null}
		</div>
	);
}

interface ChatLayoutProps {
	readonly workspaceId: string;
	readonly agentId: string;
	readonly activeConversationId: string | null;
	readonly onSelectConversation: (conversationId: string) => void;
	readonly children: React.ReactNode;
}

/**
 * Three-column chat layout: ConversationSidebar (left), the
 * conversation pane (middle, supplied as `children` so this layout
 * doesn't need to know whether the right pane is the live thread or
 * the empty-state), and {@link RetrievedContextPanel} (right) which
 * surfaces the chunks the agent grounded its latest turn on.
 *
 * The context panel collapses on narrower viewports — chat is
 * functional without it, so the right rail is allowed to fall away
 * when the screen runs out of room. We share the same React Query
 * key for messages between the thread and the panel, so the panel
 * is effectively free network-wise.
 */
function ChatLayout({
	workspaceId,
	agentId,
	activeConversationId,
	onSelectConversation,
	children,
}: ChatLayoutProps) {
	// Same hook as ConversationThread → TanStack Query dedupes the
	// fetch through the shared cache, so the panel is rendered from
	// the same data the thread renders without an extra round trip.
	const messagesQuery = useConversationMessages(
		workspaceId,
		agentId,
		activeConversationId ?? undefined,
	);
	const messages = messagesQuery.data ?? [];

	return (
		// Desktop gets a fixed-height multi-column chat surface so each
		// rail owns its internal scroll. Narrow viewports stack the
		// conversation picker above a bounded thread pane; this keeps
		// the 14rem sidebar from forcing horizontal page overflow.
		<div className="grid grid-cols-1 gap-4 lg:h-[calc(100vh-14rem)] lg:min-h-[32rem] lg:grid-cols-[14rem_minmax(0,1fr)] xl:grid-cols-[14rem_minmax(0,1fr)_18rem]">
			<ConversationSidebar
				workspaceId={workspaceId}
				agentId={agentId}
				activeConversationId={activeConversationId}
				onSelect={onSelectConversation}
				className="max-h-72 min-h-0 lg:h-full lg:max-h-none"
			/>
			<div className="h-[calc(100dvh-18rem)] min-h-[28rem] min-w-0 lg:h-full lg:min-h-0">
				{children}
			</div>
			{/* Hidden below xl until the screen has room. Operators on
			    smaller viewports still see citations through the per-
			    message Sources disclosure inside MessageBubble. */}
			<RetrievedContextPanel
				workspaceId={workspaceId}
				messages={messages}
				className="hidden xl:flex"
			/>
		</div>
	);
}
