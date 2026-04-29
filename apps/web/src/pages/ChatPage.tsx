import {
	ArrowLeft,
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
	useChat,
	useChatMessages,
	useChats,
	useCreateChat,
	useDeleteChat,
	useSendChatStream,
} from "@/hooks/useChats";
import { useWorkspace } from "@/hooks/useWorkspaces";
import { ApiError, formatApiError } from "@/lib/api";
import type { Chat, ChatMessage } from "@/lib/schemas";
import { cn, formatDate } from "@/lib/utils";

/**
 * Workspace-level chat with Bobbie.
 *
 * Full CRUD over conversations + persistent message history.
 * Sending a message opens an SSE stream against
 * `POST .../chats/{id}/messages/stream` so Bobbie's reply renders
 * token-by-token. The runtime falls back to `503 chat_disabled` if
 * the operator hasn't wired a `chat:` block in `workbench.yaml`;
 * the UI surfaces that as a toast.
 */
export function ChatPage() {
	const { workspaceUid } = useParams<{ workspaceUid: string }>();
	const [searchParams, setSearchParams] = useSearchParams();
	const activeChatId = searchParams.get("id");

	const workspaceQuery = useWorkspace(workspaceUid);
	const chatsQuery = useChats(workspaceUid);

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

	const onSelect = (chatId: string) => {
		const next = new URLSearchParams(searchParams);
		next.set("id", chatId);
		setSearchParams(next, { replace: false });
	};
	const onClearSelection = () => {
		const next = new URLSearchParams(searchParams);
		next.delete("id");
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
						Chat with Bobbie
					</h1>
					<p className="mt-1 text-sm text-slate-500">
						Ask questions grounded in{" "}
						<span className="font-medium text-slate-700">{workspace.name}</span>
						's knowledge bases.
					</p>
				</div>
			</div>

			<div className="grid grid-cols-[14rem_minmax(0,1fr)] gap-4 min-h-[28rem]">
				<ChatSidebar
					workspaceUid={workspaceUid}
					chats={chatsQuery.data ?? []}
					loading={chatsQuery.isLoading}
					error={chatsQuery.isError ? formatApiError(chatsQuery.error) : null}
					activeChatId={activeChatId}
					onSelect={onSelect}
					onCreated={(chat) => onSelect(chat.chatId)}
				/>

				{activeChatId ? (
					<ChatThread
						key={activeChatId}
						workspaceUid={workspaceUid}
						chatId={activeChatId}
						onDeleted={onClearSelection}
					/>
				) : (
					<EmptyChatPane
						hasChats={(chatsQuery.data?.length ?? 0) > 0}
						workspaceUid={workspaceUid}
						onCreated={(chat) => onSelect(chat.chatId)}
					/>
				)}
			</div>
		</div>
	);
}

interface ChatSidebarProps {
	workspaceUid: string;
	chats: Chat[];
	loading: boolean;
	error: string | null;
	activeChatId: string | null;
	onSelect: (chatId: string) => void;
	onCreated: (chat: Chat) => void;
}

function ChatSidebar({
	workspaceUid,
	chats,
	loading,
	error,
	activeChatId,
	onSelect,
	onCreated,
}: ChatSidebarProps) {
	const create = useCreateChat(workspaceUid);
	const onNew = async () => {
		try {
			const chat = await create.mutateAsync({ title: "New chat" });
			onCreated(chat);
		} catch (err) {
			toast.error("Couldn't start chat", { description: formatApiError(err) });
		}
	};
	return (
		<aside
			className="flex flex-col rounded-lg border border-slate-200 bg-white"
			aria-label="Chat conversations"
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
					{create.isPending ? "Starting…" : "New chat"}
				</Button>
			</div>
			<div className="flex-1 overflow-y-auto">
				{loading ? (
					<p className="p-3 text-xs text-slate-400">Loading…</p>
				) : error ? (
					<p className="p-3 text-xs text-red-600">{error}</p>
				) : chats.length === 0 ? (
					<p className="p-3 text-xs text-slate-400">
						No conversations yet. Start one above.
					</p>
				) : (
					<ul className="flex flex-col">
						{chats.map((chat) => (
							<li key={chat.chatId}>
								<button
									type="button"
									onClick={() => onSelect(chat.chatId)}
									className={cn(
										"flex w-full flex-col items-start gap-1 border-b border-slate-100 px-3 py-2 text-left text-sm transition hover:bg-slate-50",
										activeChatId === chat.chatId &&
											"bg-[var(--color-brand-50)]/60",
									)}
								>
									<span className="truncate font-medium text-slate-800 max-w-full">
										{chat.title ?? "Untitled"}
									</span>
									<span className="flex items-center gap-1 text-xs text-slate-400">
										<MessageSquare className="h-3 w-3" />
										{chat.knowledgeBaseIds.length === 0
											? "all KBs"
											: `${chat.knowledgeBaseIds.length} KB${chat.knowledgeBaseIds.length > 1 ? "s" : ""}`}
										<span aria-hidden="true">·</span>
										{formatDate(chat.createdAt)}
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

function EmptyChatPane({
	hasChats,
	workspaceUid,
	onCreated,
}: {
	hasChats: boolean;
	workspaceUid: string;
	onCreated: (chat: Chat) => void;
}) {
	const create = useCreateChat(workspaceUid);
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
					{hasChats
						? "Pick a conversation from the left, or start a new one."
						: "No chats yet. Start a conversation grounded in this workspace's knowledge bases."}
				</p>
				<Button
					variant="brand"
					disabled={create.isPending}
					onClick={async () => {
						try {
							const chat = await create.mutateAsync({ title: "New chat" });
							onCreated(chat);
						} catch (err) {
							toast.error("Couldn't start chat", {
								description: formatApiError(err),
							});
						}
					}}
				>
					<Plus className="h-4 w-4" />
					{create.isPending ? "Starting…" : "Start a chat"}
				</Button>
			</CardContent>
		</Card>
	);
}

interface ChatThreadProps {
	workspaceUid: string;
	chatId: string;
	onDeleted: () => void;
}

function ChatThread({ workspaceUid, chatId, onDeleted }: ChatThreadProps) {
	const chatQuery = useChat(workspaceUid, chatId);
	const messagesQuery = useChatMessages(workspaceUid, chatId);
	const deleteChat = useDeleteChat(workspaceUid);
	const stream = useSendChatStream(workspaceUid, chatId);

	const [draft, setDraft] = useState("");
	const messageListRef = useRef<HTMLDivElement | null>(null);

	// Auto-scroll the message list to the bottom when new content
	// arrives. We key off both the persisted message count AND the
	// in-flight token buffer so streaming replies stay visible at the
	// bottom of the viewport without snapping the scroll on every
	// frame.
	const messageCount = messagesQuery.data?.length ?? 0;
	const pendingDeltaLength = stream.pendingDelta.length;
	// biome-ignore lint/correctness/useExhaustiveDependencies: scrolling depends on content length, not the ref identity
	useEffect(() => {
		const node = messageListRef.current;
		// jsdom and some test environments don't implement scrollTo —
		// guard so test renders don't crash the effect.
		if (node && typeof node.scrollTo === "function") {
			node.scrollTo({ top: node.scrollHeight, behavior: "smooth" });
		}
	}, [messageCount, pendingDeltaLength]);

	if (chatQuery.isLoading) {
		return (
			<Card className="flex flex-col">
				<CardContent className="flex-1 p-8">
					<LoadingState label="Loading chat…" />
				</CardContent>
			</Card>
		);
	}
	if (chatQuery.isError || !chatQuery.data) {
		const message =
			chatQuery.error instanceof ApiError &&
			chatQuery.error.code === "chat_not_found"
				? "This chat doesn't exist or was deleted."
				: formatApiError(chatQuery.error);
		return (
			<Card className="flex flex-col">
				<CardContent className="flex flex-1 items-center justify-center p-8">
					<ErrorState title="Couldn't load chat" message={message} />
				</CardContent>
			</Card>
		);
	}

	const chat = chatQuery.data;

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
				`Delete chat${chat.title ? ` "${chat.title}"` : ""}? This cannot be undone.`,
			)
		) {
			return;
		}
		try {
			await deleteChat.mutateAsync(chat.chatId);
			toast.success("Chat deleted");
			onDeleted();
		} catch (err) {
			toast.error("Couldn't delete chat", {
				description: formatApiError(err),
			});
		}
	};

	return (
		<Card className="flex flex-col">
			<header className="flex items-start justify-between gap-3 border-b border-slate-100 p-4">
				<div className="min-w-0">
					<h2 className="truncate text-base font-semibold tracking-tight text-slate-900">
						{chat.title ?? "Untitled"}
					</h2>
					<p className="mt-1 text-xs text-slate-500">
						{chat.knowledgeBaseIds.length === 0
							? "Grounded in: all knowledge bases in this workspace"
							: `Grounded in ${chat.knowledgeBaseIds.length} KB${chat.knowledgeBaseIds.length > 1 ? "s" : ""}`}
					</p>
				</div>
				<Button
					variant="ghost"
					size="sm"
					onClick={onDelete}
					disabled={deleteChat.isPending}
					title="Delete chat"
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
						<EmptyMessages />
					) : (
						<ul className="flex flex-col gap-3">
							{messagesQuery.data?.map((m) => (
								<MessageBubble
									key={m.messageId}
									message={m}
									workspaceId={workspaceUid}
								/>
							))}
							{stream.pending ? (
								<StreamingBubble delta={stream.pendingDelta} />
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
						placeholder="Ask Bobbie about this workspace… (Enter to send)"
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

function EmptyMessages() {
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
				Bobbie answers grounded in this workspace's knowledge bases. Replies
				stream in token-by-token as the model generates.
			</p>
		</div>
	);
}

function MessageBubble({
	message,
	workspaceId,
}: {
	message: ChatMessage;
	workspaceId: string;
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
				{isUser ? "You" : message.role === "agent" ? "Bobbie" : "System"}
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
				data-testid={isError ? "bobbie-error" : undefined}
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

function BobbieThinking() {
	return (
		<li
			className="flex items-center gap-2 self-start rounded-md bg-slate-100 px-3 py-1.5 text-xs text-slate-600"
			data-testid="bobbie-thinking"
		>
			<Sparkles className="h-3 w-3 animate-pulse" aria-hidden="true" />
			Bobbie is thinking…
		</li>
	);
}

/**
 * Renders Bobbie's in-flight reply while the SSE stream is open.
 * Once the stream emits `done`, the canonical assistant row lands
 * in the cached message list and this bubble is replaced by a
 * regular {@link MessageBubble}.
 *
 * Falls back to {@link BobbieThinking} when no tokens have arrived
 * yet (initial retrieval delay) so the UI doesn't render an empty
 * bubble.
 */
function StreamingBubble({ delta }: { delta: string }) {
	if (delta.length === 0) return <BobbieThinking />;
	return (
		<li
			className="flex flex-col gap-1 items-start"
			data-testid="bobbie-streaming"
		>
			<span className="text-xs font-medium text-slate-500">
				Bobbie
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
