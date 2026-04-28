import { ArrowLeft, MessageSquare, Send, Sparkles } from "lucide-react";
import { Link, Navigate, useParams } from "react-router-dom";
import { ErrorState, LoadingState } from "@/components/common/states";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useWorkspace } from "@/hooks/useWorkspaces";
import { ApiError, formatApiError } from "@/lib/api";

/**
 * Workspace-level chat page.
 *
 * Scaffold for the upcoming chat-with-Bobbie feature
 * (see docs/CHAT_DESIGN.md / approved plan). The route, layout, and
 * navigation entry are wired so users can find the page; the
 * conversation list, message stream, and composer are all visual
 * placeholders for now. Subsequent PRs add persistence (re-using the
 * Stage-2 agentic tables), routes, HuggingFace integration, and SSE
 * streaming.
 */
export function ChatPage() {
	const { workspaceUid } = useParams<{ workspaceUid: string }>();
	const { data, isLoading, isError, error } = useWorkspace(workspaceUid);

	if (!workspaceUid) return <Navigate to="/" replace />;
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
				<Link to={`/workspaces/${workspaceUid}`}>
					<ArrowLeft className="h-4 w-4" />
					{data.name}
				</Link>
			</Button>

			<div className="flex items-start justify-between gap-4">
				<div className="min-w-0">
					<div className="flex items-center gap-3 flex-wrap">
						<h1 className="text-2xl font-semibold tracking-tight text-slate-900 truncate">
							Chat with Bobbie
						</h1>
					</div>
					<p className="mt-1 text-sm text-slate-500">
						Ask questions grounded in{" "}
						<span className="font-medium text-slate-700">{data.name}</span>'s
						knowledge bases.
					</p>
				</div>
			</div>

			<div className="grid grid-cols-[14rem_minmax(0,1fr)] gap-4 min-h-[28rem]">
				{/* Sidebar slot — conversation list lands here in the implementation PR. */}
				<aside
					className="rounded-lg border border-dashed border-slate-200 bg-slate-50/60 p-4 text-xs text-slate-400"
					aria-label="Conversations (placeholder)"
					data-testid="chat-conversation-list-placeholder"
				>
					<div className="flex items-center gap-2 font-medium text-slate-500">
						<MessageSquare className="h-3.5 w-3.5" aria-hidden="true" />
						Conversations
					</div>
					<p className="mt-2 leading-relaxed">
						Your chat history will live here once the feature ships.
					</p>
				</aside>

				<Card className="flex flex-col">
					<CardHeader>
						<CardTitle className="flex items-center gap-2">
							<Sparkles
								className="h-4 w-4 text-[var(--color-brand-600)]"
								aria-hidden="true"
							/>
							Coming soon
						</CardTitle>
					</CardHeader>
					<CardContent className="flex flex-1 flex-col">
						<div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
							<div className="rounded-full bg-[var(--color-brand-50)] p-3">
								<Sparkles
									className="h-6 w-6 text-[var(--color-brand-600)]"
									aria-hidden="true"
								/>
							</div>
							<p className="max-w-md text-sm text-slate-700">
								Bobbie will answer questions using the knowledge bases in this
								workspace. Pick which knowledge bases to ground each
								conversation in, or let Bobbie use them all.
							</p>
							<p className="max-w-md text-xs text-slate-500">
								The chat surface is being built in follow-up PRs. The route,
								navigation, and layout are in place so you know where to find
								it.
							</p>
							<Button variant="brand" disabled>
								<MessageSquare className="h-4 w-4" />
								New chat
							</Button>
						</div>
						<form
							className="mt-6 flex items-end gap-2 border-t border-slate-100 pt-4"
							onSubmit={(e) => e.preventDefault()}
							aria-label="Composer (disabled — chat is coming soon)"
						>
							<label htmlFor="chat-composer" className="sr-only">
								Send a message
							</label>
							<textarea
								id="chat-composer"
								disabled
								rows={2}
								placeholder="Chat is coming soon — Bobbie will reply here."
								className="flex-1 resize-none rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-500 placeholder:text-slate-400 disabled:cursor-not-allowed"
							/>
							<Button type="submit" variant="brand" disabled>
								<Send className="h-4 w-4" />
								Send
							</Button>
						</form>
					</CardContent>
				</Card>
			</div>
		</div>
	);
}
