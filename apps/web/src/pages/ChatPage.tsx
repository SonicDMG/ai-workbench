import {
	ArrowLeft,
	Bot,
	MessageSquare,
	Plus,
	Send,
	Sparkles,
	Trash2,
} from "lucide-react";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { Link, Navigate, useParams, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import {
	type ChunkRef,
	MarkdownContent,
	parseChunkMap,
} from "@/components/chat/MarkdownContent";
import { ErrorState, LoadingState } from "@/components/common/states";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
	useAgents,
	useConversation,
	useConversationMessages,
	useConversations,
	useCreateAgent,
	useCreateConversation,
	useDeleteConversation,
	useSendConversationStream,
} from "@/hooks/useConversations";
import { useWorkspace } from "@/hooks/useWorkspaces";
import { ApiError, formatApiError } from "@/lib/api";
import type {
	AgentRecord,
	ChatMessage,
	ConversationRecord,
} from "@/lib/schemas";
import { cn, formatDate } from "@/lib/utils";

/**
 * Workspace-level chat surface.
 *
 * Lists the workspace's agents, lets the operator pick one, and runs a
 * conversation against `/agents/{a}/conversations/{c}/*`. When the
 * workspace has no agents yet, prompts the user to create their first
 * agent inline. Replies stream over SSE so tokens render as they
 * arrive.
 *
 * Polished agent management (dedicated /agents page, multi-agent
 * picker, agent edit form, LLM service management) ships in a
 * follow-up PR — this page is the minimum surface needed to send a
 * message to an agent and see the streamed reply.
 */
export function ChatPage() {
	const { workspaceUid } = useParams<{ workspaceUid: string }>();
	const [searchParams, setSearchParams] = useSearchParams();
	const activeAgentId = searchParams.get("agent");
	const activeConversationId = searchParams.get("conversation");

	const workspaceQuery = useWorkspace(workspaceUid);
	const agentsQuery = useAgents(workspaceUid);

	if (!workspaceUid) return <Navigate to="/" replace />;
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
				<Link to={`/workspaces/${workspaceUid}`}>
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
				<CreateFirstAgent
					workspaceUid={workspaceUid}
					onCreated={onSelectAgent}
				/>
			) : activeAgent ? (
				<>
					<AgentPicker
						agents={agents}
						activeAgentId={activeAgent.agentId}
						onSelect={onSelectAgent}
					/>
					<div className="grid grid-cols-[14rem_minmax(0,1fr)] gap-4 min-h-[28rem]">
						<ConversationSidebar
							workspaceUid={workspaceUid}
							agentId={activeAgent.agentId}
							activeConversationId={activeConversationId}
							onSelect={onSelectConversation}
						/>
						{activeConversationId ? (
							<ConversationThread
								key={activeConversationId}
								workspaceUid={workspaceUid}
								agent={activeAgent}
								conversationId={activeConversationId}
								onDeleted={onClearConversation}
							/>
						) : (
							<EmptyConversationPane
								workspaceUid={workspaceUid}
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

interface CreateFirstAgentProps {
	workspaceUid: string;
	onCreated: (agentId: string) => void;
}

function CreateFirstAgent({ workspaceUid, onCreated }: CreateFirstAgentProps) {
	const create = useCreateAgent(workspaceUid);
	const [name, setName] = useState("");
	const [systemPrompt, setSystemPrompt] = useState("");

	const onSubmit = async (e: FormEvent<HTMLFormElement>) => {
		e.preventDefault();
		const trimmedName = name.trim();
		if (trimmedName.length === 0) return;
		try {
			const agent = await create.mutateAsync({
				name: trimmedName,
				systemPrompt: systemPrompt.trim() ? systemPrompt.trim() : null,
			});
			toast.success(`Agent '${agent.name}' created`);
			onCreated(agent.agentId);
		} catch (err) {
			toast.error("Couldn't create agent", {
				description: formatApiError(err),
			});
		}
	};

	return (
		<Card>
			<CardContent className="flex flex-col gap-4 p-6">
				<div className="flex items-center gap-3">
					<div className="rounded-full bg-[var(--color-brand-50)] p-2">
						<Bot
							className="h-5 w-5 text-[var(--color-brand-600)]"
							aria-hidden="true"
						/>
					</div>
					<div>
						<h2 className="text-base font-semibold text-slate-900">
							Create your first agent
						</h2>
						<p className="text-xs text-slate-500">
							An agent owns its conversations, system prompt, and (later)
							knowledge bases.
						</p>
					</div>
				</div>
				<form
					onSubmit={onSubmit}
					className="flex flex-col gap-3"
					aria-label="Create agent"
				>
					<label className="flex flex-col gap-1 text-sm">
						<span className="font-medium text-slate-700">Name</span>
						<input
							type="text"
							required
							value={name}
							onChange={(e) => setName(e.target.value)}
							placeholder="e.g. Bobbie"
							className="rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 placeholder:text-slate-400 focus:border-[var(--color-brand-600)] focus:outline-none focus:ring-2 focus:ring-[var(--color-brand-100)]"
						/>
					</label>
					<label className="flex flex-col gap-1 text-sm">
						<span className="font-medium text-slate-700">
							System prompt{" "}
							<span className="font-normal text-slate-400">(optional)</span>
						</span>
						<textarea
							rows={3}
							value={systemPrompt}
							onChange={(e) => setSystemPrompt(e.target.value)}
							placeholder="You are a helpful assistant grounded in this workspace."
							className="resize-y rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 placeholder:text-slate-400 focus:border-[var(--color-brand-600)] focus:outline-none focus:ring-2 focus:ring-[var(--color-brand-100)]"
						/>
					</label>
					<div className="flex justify-end">
						<Button
							type="submit"
							variant="brand"
							disabled={create.isPending || name.trim().length === 0}
						>
							<Plus className="h-4 w-4" />
							{create.isPending ? "Creating…" : "Create agent"}
						</Button>
					</div>
				</form>
			</CardContent>
		</Card>
	);
}

interface AgentPickerProps {
	agents: readonly AgentRecord[];
	activeAgentId: string;
	onSelect: (agentId: string) => void;
}

function AgentPicker({ agents, activeAgentId, onSelect }: AgentPickerProps) {
	if (agents.length <= 1) {
		const only = agents[0];
		if (!only) return null;
		return (
			<div className="flex items-center gap-2 text-sm text-slate-700">
				<Bot
					className="h-4 w-4 text-[var(--color-brand-600)]"
					aria-hidden="true"
				/>
				<span className="font-medium">{only.name}</span>
			</div>
		);
	}
	return (
		<label className="flex items-center gap-2 text-sm text-slate-700">
			<Bot
				className="h-4 w-4 text-[var(--color-brand-600)]"
				aria-hidden="true"
			/>
			<span className="font-medium">Agent</span>
			<select
				value={activeAgentId}
				onChange={(e) => onSelect(e.target.value)}
				className="rounded-md border border-slate-200 bg-white px-2 py-1 text-sm text-slate-800 focus:border-[var(--color-brand-600)] focus:outline-none focus:ring-2 focus:ring-[var(--color-brand-100)]"
				data-testid="agent-picker"
			>
				{agents.map((agent) => (
					<option key={agent.agentId} value={agent.agentId}>
						{agent.name}
					</option>
				))}
			</select>
		</label>
	);
}

interface ConversationSidebarProps {
	workspaceUid: string;
	agentId: string;
	activeConversationId: string | null;
	onSelect: (conversationId: string) => void;
}

function ConversationSidebar({
	workspaceUid,
	agentId,
	activeConversationId,
	onSelect,
}: ConversationSidebarProps) {
	const conversationsQuery = useConversations(workspaceUid, agentId);
	const create = useCreateConversation(workspaceUid, agentId);
	const conversations = conversationsQuery.data ?? [];

	const onNew = async () => {
		try {
			const conv = await create.mutateAsync({ title: "New conversation" });
			onSelect(conv.conversationId);
		} catch (err) {
			toast.error("Couldn't start conversation", {
				description: formatApiError(err),
			});
		}
	};

	return (
		<aside
			className="flex flex-col rounded-lg border border-slate-200 bg-white"
			aria-label="Conversations"
		>
			<div className="border-b border-slate-100 px-3 py-2">
				<Button
					variant="brand"
					size="sm"
					className="w-full justify-center"
					disabled={create.isPending}
					onClick={onNew}
				>
					<Plus className="h-3.5 w-3.5" />
					{create.isPending ? "Starting…" : "New conversation"}
				</Button>
			</div>
			<div className="flex-1 overflow-y-auto">
				{conversationsQuery.isLoading ? (
					<p className="p-3 text-xs text-slate-400">Loading…</p>
				) : conversationsQuery.isError ? (
					<p className="p-3 text-xs text-red-600">
						{formatApiError(conversationsQuery.error)}
					</p>
				) : conversations.length === 0 ? (
					<p className="p-3 text-xs text-slate-400">
						No conversations yet. Start one above.
					</p>
				) : (
					<ul className="flex flex-col">
						{conversations.map((conv) => (
							<li key={conv.conversationId}>
								<button
									type="button"
									onClick={() => onSelect(conv.conversationId)}
									className={cn(
										"flex w-full flex-col items-start gap-1 border-b border-slate-100 px-3 py-2 text-left text-sm transition hover:bg-slate-50",
										activeConversationId === conv.conversationId &&
											"bg-[var(--color-brand-50)]/60",
									)}
								>
									<span className="truncate font-medium text-slate-800 max-w-full">
										{conv.title ?? "Untitled"}
									</span>
									<span className="flex items-center gap-1 text-xs text-slate-400">
										<MessageSquare className="h-3 w-3" />
										{conv.knowledgeBaseIds.length === 0
											? "agent default KBs"
											: `${conv.knowledgeBaseIds.length} KB${conv.knowledgeBaseIds.length > 1 ? "s" : ""}`}
										<span aria-hidden="true">·</span>
										{formatDate(conv.createdAt)}
									</span>
								</button>
							</li>
						))}
					</ul>
				)}
			</div>
		</aside>
	);
}

interface EmptyConversationPaneProps {
	workspaceUid: string;
	agent: AgentRecord;
	onCreated: (conv: ConversationRecord) => void;
}

function EmptyConversationPane({
	workspaceUid,
	agent,
	onCreated,
}: EmptyConversationPaneProps) {
	const create = useCreateConversation(workspaceUid, agent.agentId);
	return (
		<Card className="flex flex-col">
			<CardContent className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
				<div className="rounded-full bg-[var(--color-brand-50)] p-3">
					<Sparkles
						className="h-6 w-6 text-[var(--color-brand-600)]"
						aria-hidden="true"
					/>
				</div>
				<p className="max-w-md text-sm text-slate-700">
					Pick a conversation from the left, or start a new one with{" "}
					<span className="font-medium">{agent.name}</span>.
				</p>
				<Button
					variant="brand"
					disabled={create.isPending}
					onClick={async () => {
						try {
							const conv = await create.mutateAsync({
								title: "New conversation",
							});
							onCreated(conv);
						} catch (err) {
							toast.error("Couldn't start conversation", {
								description: formatApiError(err),
							});
						}
					}}
				>
					<Plus className="h-4 w-4" />
					{create.isPending ? "Starting…" : "Start a conversation"}
				</Button>
			</CardContent>
		</Card>
	);
}

interface ConversationThreadProps {
	workspaceUid: string;
	agent: AgentRecord;
	conversationId: string;
	onDeleted: () => void;
}

function ConversationThread({
	workspaceUid,
	agent,
	conversationId,
	onDeleted,
}: ConversationThreadProps) {
	const conversationQuery = useConversation(
		workspaceUid,
		agent.agentId,
		conversationId,
	);
	const messagesQuery = useConversationMessages(
		workspaceUid,
		agent.agentId,
		conversationId,
	);
	const deleteConv = useDeleteConversation(workspaceUid, agent.agentId);
	const stream = useSendConversationStream(
		workspaceUid,
		agent.agentId,
		conversationId,
	);

	const [draft, setDraft] = useState("");
	const messageListRef = useRef<HTMLDivElement | null>(null);

	// Auto-scroll the message list to the bottom when new content
	// arrives. Key off both persisted message count AND the in-flight
	// token buffer so streaming replies stay visible at the bottom of
	// the viewport without snapping the scroll on every frame.
	const messageCount = messagesQuery.data?.length ?? 0;
	const pendingDeltaLength = stream.pendingDelta.length;
	// biome-ignore lint/correctness/useExhaustiveDependencies: scrolling depends on content length, not the ref identity
	useEffect(() => {
		const node = messageListRef.current;
		if (node && typeof node.scrollTo === "function") {
			node.scrollTo({ top: node.scrollHeight, behavior: "smooth" });
		}
	}, [messageCount, pendingDeltaLength]);

	if (conversationQuery.isLoading) {
		return (
			<Card className="flex flex-col">
				<CardContent className="flex-1 p-8">
					<LoadingState label="Loading conversation…" />
				</CardContent>
			</Card>
		);
	}
	if (conversationQuery.isError || !conversationQuery.data) {
		const message =
			conversationQuery.error instanceof ApiError &&
			conversationQuery.error.code === "conversation_not_found"
				? "This conversation doesn't exist or was deleted."
				: formatApiError(conversationQuery.error);
		return (
			<Card className="flex flex-col">
				<CardContent className="flex flex-1 items-center justify-center p-8">
					<ErrorState title="Couldn't load conversation" message={message} />
				</CardContent>
			</Card>
		);
	}

	const conversation = conversationQuery.data;

	const onSubmit = async (e: FormEvent<HTMLFormElement>) => {
		e.preventDefault();
		const content = draft.trim();
		if (!content) return;
		setDraft("");
		await stream.send(content);
		if (stream.error) {
			toast.error("Couldn't send message", { description: stream.error });
			setDraft(content); // restore so the user doesn't lose their typing
		}
	};

	const onDelete = async () => {
		if (
			!window.confirm(
				`Delete conversation${conversation.title ? ` "${conversation.title}"` : ""}? This cannot be undone.`,
			)
		) {
			return;
		}
		try {
			await deleteConv.mutateAsync(conversation.conversationId);
			toast.success("Conversation deleted");
			onDeleted();
		} catch (err) {
			toast.error("Couldn't delete conversation", {
				description: formatApiError(err),
			});
		}
	};

	return (
		<Card className="flex flex-col">
			<header className="flex items-start justify-between gap-3 border-b border-slate-100 p-4">
				<div className="min-w-0">
					<h2 className="truncate text-base font-semibold tracking-tight text-slate-900">
						{conversation.title ?? "Untitled"}
					</h2>
					<p className="mt-1 text-xs text-slate-500">
						{conversation.knowledgeBaseIds.length === 0
							? `Grounded in: ${agent.name}'s default knowledge bases`
							: `Grounded in ${conversation.knowledgeBaseIds.length} KB${conversation.knowledgeBaseIds.length > 1 ? "s" : ""}`}
					</p>
				</div>
				<Button
					variant="ghost"
					size="sm"
					onClick={onDelete}
					disabled={deleteConv.isPending}
					title="Delete conversation"
				>
					<Trash2 className="h-4 w-4" />
					Delete
				</Button>
			</header>

			<CardContent className="flex flex-1 flex-col gap-4 p-0">
				<div
					ref={messageListRef}
					className="flex-1 overflow-y-auto px-4 py-4"
					data-testid="chat-message-list"
				>
					{messagesQuery.isLoading ? (
						<LoadingState label="Loading messages…" />
					) : messagesQuery.isError ? (
						<p className="text-sm text-red-600">
							{formatApiError(messagesQuery.error)}
						</p>
					) : (messagesQuery.data?.length ?? 0) === 0 && !stream.pending ? (
						<EmptyMessages agentName={agent.name} />
					) : (
						<ul className="flex flex-col gap-3">
							{messagesQuery.data?.map((m) => (
								<MessageBubble
									key={m.messageId}
									message={m}
									workspaceId={workspaceUid}
									agentName={agent.name}
								/>
							))}
							{stream.pending ? (
								<StreamingBubble
									delta={stream.pendingDelta}
									agentName={agent.name}
								/>
							) : null}
						</ul>
					)}
				</div>

				<form
					onSubmit={onSubmit}
					className="flex items-end gap-2 border-t border-slate-100 p-3"
					aria-label="Send a message"
				>
					<label htmlFor="chat-composer" className="sr-only">
						Message
					</label>
					<textarea
						id="chat-composer"
						rows={2}
						value={draft}
						onChange={(e) => setDraft(e.target.value)}
						onKeyDown={(e) => {
							if (e.key === "Enter" && !e.shiftKey) {
								e.preventDefault();
								(e.currentTarget.form as HTMLFormElement).requestSubmit();
							}
						}}
						disabled={stream.pending}
						placeholder={`Ask ${agent.name}… (Enter to send)`}
						className="flex-1 resize-none rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 placeholder:text-slate-400 focus:border-[var(--color-brand-600)] focus:outline-none focus:ring-2 focus:ring-[var(--color-brand-100)] disabled:cursor-not-allowed disabled:bg-slate-50"
					/>
					{stream.pending ? (
						<Button
							type="button"
							variant="ghost"
							onClick={stream.cancel}
							title="Cancel"
						>
							Cancel
						</Button>
					) : null}
					<Button
						type="submit"
						variant="brand"
						disabled={stream.pending || draft.trim().length === 0}
					>
						<Send className="h-4 w-4" />
						{stream.pending ? "Streaming…" : "Send"}
					</Button>
				</form>
			</CardContent>
		</Card>
	);
}

function EmptyMessages({ agentName }: { agentName: string }) {
	return (
		<div
			className="flex flex-col items-center justify-center gap-2 py-12 text-center"
			data-testid="chat-empty-messages"
		>
			<div className="rounded-full bg-[var(--color-brand-50)] p-3">
				<Sparkles
					className="h-5 w-5 text-[var(--color-brand-600)]"
					aria-hidden="true"
				/>
			</div>
			<p className="text-sm text-slate-700">No messages yet — say hi!</p>
			<p className="text-xs text-slate-500 max-w-sm">
				{agentName} streams its replies token-by-token as the model generates.
			</p>
		</div>
	);
}

function MessageBubble({
	message,
	workspaceId,
	agentName,
}: {
	message: ChatMessage;
	workspaceId: string;
	agentName: string;
}) {
	const isUser = message.role === "user";
	const isError = message.metadata.finish_reason === "error";
	const chunkMap = parseChunkMap(message.metadata);
	return (
		<li
			className={cn(
				"flex flex-col gap-1",
				isUser ? "items-end" : "items-start",
			)}
		>
			<span className="text-xs font-medium text-slate-500">
				{isUser ? "You" : message.role === "agent" ? agentName : "System"}
				<span className="ml-2 font-normal text-slate-400">
					{formatDate(message.messageTs)}
				</span>
			</span>
			<div
				className={cn(
					"max-w-[80%] rounded-lg px-3 py-2 text-sm",
					// User content stays plain (whitespace preserved); the model's
					// reply is rendered as sanitized markdown so lists, code, and
					// citations land formatted.
					isUser
						? "whitespace-pre-wrap bg-[var(--color-brand-600)] text-white"
						: isError
							? "whitespace-pre-wrap border border-red-200 bg-red-50 text-red-900"
							: "bg-slate-100 text-slate-900",
				)}
				data-testid={isError ? "agent-error" : undefined}
			>
				{isUser || isError ? (
					(message.content ?? "")
				) : (
					<MarkdownContent
						content={message.content ?? ""}
						workspaceId={workspaceId}
						chunkMap={chunkMap}
					/>
				)}
			</div>
			{!isUser && chunkMap.size > 0 ? (
				<SourcesDisclosure workspaceId={workspaceId} chunks={chunkMap} />
			) : null}
		</li>
	);
}

function SourcesDisclosure({
	workspaceId,
	chunks,
}: {
	workspaceId: string;
	chunks: ReadonlyMap<string, ChunkRef>;
}) {
	const entries = [...chunks.values()];
	return (
		<details className="self-start text-xs text-slate-500">
			<summary className="cursor-pointer hover:text-slate-700">
				{entries.length} source{entries.length === 1 ? "" : "s"}
			</summary>
			<ul className="mt-1 flex flex-col gap-0.5 pl-2">
				{entries.map((ref) => (
					<li key={ref.chunkId} className="font-mono text-[11px]">
						{ref.knowledgeBaseId.length > 0 ? (
							<Link
								to={citationHref(workspaceId, ref)}
								className="text-slate-500 hover:text-[var(--color-brand-700)] hover:underline"
								data-testid="chat-source-link"
							>
								{ref.chunkId}
							</Link>
						) : (
							// Legacy `context_document_ids` only — no KB / doc info,
							// so we can't deep-link. Render as plain text.
							<span className="text-slate-400">{ref.chunkId}</span>
						)}
					</li>
				))}
			</ul>
		</details>
	);
}

function citationHref(workspaceId: string, ref: ChunkRef): string {
	const params = new URLSearchParams();
	if (ref.documentId) params.set("document", ref.documentId);
	params.set("chunk", ref.chunkId);
	return `/workspaces/${workspaceId}/knowledge-bases/${ref.knowledgeBaseId}?${params.toString()}`;
}

function AgentThinking({ agentName }: { agentName: string }) {
	return (
		<li
			className="flex items-center gap-2 self-start rounded-md bg-slate-100 px-3 py-1.5 text-xs text-slate-600"
			data-testid="agent-thinking"
		>
			<Sparkles className="h-3 w-3 animate-pulse" aria-hidden="true" />
			{agentName} is thinking…
		</li>
	);
}

/**
 * Renders the agent's in-flight reply while the SSE stream is open.
 * Once the stream emits `done`, the canonical assistant row lands in
 * the cached message list and this bubble is replaced by a regular
 * {@link MessageBubble}.
 *
 * Falls back to {@link AgentThinking} when no tokens have arrived yet
 * (initial retrieval delay) so the UI doesn't render an empty bubble.
 */
function StreamingBubble({
	delta,
	agentName,
}: {
	delta: string;
	agentName: string;
}) {
	if (delta.length === 0) return <AgentThinking agentName={agentName} />;
	return (
		<li
			className="flex flex-col gap-1 items-start"
			data-testid="agent-streaming"
		>
			<span className="text-xs font-medium text-slate-500">
				{agentName}
				<span className="ml-2 font-normal text-slate-400">streaming…</span>
			</span>
			<div className="max-w-[80%] whitespace-pre-wrap rounded-lg bg-slate-100 px-3 py-2 text-sm text-slate-900">
				{delta}
				<span className="ml-0.5 inline-block animate-pulse text-slate-400">
					▍
				</span>
			</div>
		</li>
	);
}
