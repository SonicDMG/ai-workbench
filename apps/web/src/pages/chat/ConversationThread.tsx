import { Plus, Send, Sparkles, Trash2 } from "lucide-react";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { ErrorState, LoadingState } from "@/components/common/states";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
	useConversation,
	useConversationMessages,
	useCreateConversation,
	useDeleteConversation,
	useSendConversationStream,
} from "@/hooks/useConversations";
import { ApiError, formatApiError } from "@/lib/api";
import type { AgentRecord, ConversationRecord } from "@/lib/schemas";
import { EmptyMessages, MessageBubble, StreamingBubble } from "./MessageBubble";

interface EmptyConversationPaneProps {
	workspaceId: string;
	agent: AgentRecord;
	onCreated: (conv: ConversationRecord) => void;
}

/**
 * Empty-state pane shown in the right rail when no conversation is
 * selected yet. Encourages the user to either pick an existing
 * conversation from the sidebar or start a fresh one with a single
 * click.
 */
export function EmptyConversationPane({
	workspaceId,
	agent,
	onCreated,
}: EmptyConversationPaneProps) {
	const create = useCreateConversation(workspaceId, agent.agentId);
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
	workspaceId: string;
	agent: AgentRecord;
	conversationId: string;
	onDeleted: () => void;
}

/**
 * Right rail when a conversation is selected. Owns the message list,
 * the SSE streaming reply state, the composer, and the delete-thread
 * action. Auto-scrolls the message list to the bottom on every new
 * persisted message OR token batch so streaming replies stay in view.
 */
export function ConversationThread({
	workspaceId,
	agent,
	conversationId,
	onDeleted,
}: ConversationThreadProps) {
	const conversationQuery = useConversation(
		workspaceId,
		agent.agentId,
		conversationId,
	);
	const messagesQuery = useConversationMessages(
		workspaceId,
		agent.agentId,
		conversationId,
	);
	const deleteConv = useDeleteConversation(workspaceId, agent.agentId);
	const stream = useSendConversationStream(
		workspaceId,
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
		// `send` returns the error message (or null on success). Reading
		// `stream.error` here would see stale state from the previous
		// render — React hasn't flushed the setError yet.
		const sendError = await stream.send(content);
		if (sendError) {
			toast.error("Couldn't send message", { description: sendError });
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
									workspaceId={workspaceId}
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
