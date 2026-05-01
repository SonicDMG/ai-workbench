import { MessageSquare, Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
	useConversations,
	useCreateConversation,
} from "@/hooks/useConversations";
import { formatApiError } from "@/lib/api";
import { cn, formatDate } from "@/lib/utils";

interface ConversationSidebarProps {
	workspaceId: string;
	agentId: string;
	activeConversationId: string | null;
	onSelect: (conversationId: string) => void;
}

/**
 * Left rail of the chat surface. Lists every conversation under the
 * active agent (newest-first per the runtime sort), highlights the
 * one the user is reading, and exposes a "New conversation" button
 * that resolves the new id back to the parent so it can switch the
 * `?conversation=` query param.
 */
export function ConversationSidebar({
	workspaceId,
	agentId,
	activeConversationId,
	onSelect,
}: ConversationSidebarProps) {
	const conversationsQuery = useConversations(workspaceId, agentId);
	const create = useCreateConversation(workspaceId, agentId);
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
