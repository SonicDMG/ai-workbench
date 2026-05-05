import { FileText, Sparkles } from "lucide-react";
import { Link } from "react-router-dom";
import { AstraQueryCodeButton } from "@/components/chat/AstraQueryCodeButton";
import {
	type ChunkRef,
	MarkdownContent,
	parseChunkMap,
} from "@/components/chat/MarkdownContent";
import type { ChatMessage } from "@/lib/schemas";
import { cn, formatDate } from "@/lib/utils";

/**
 * One message row in a conversation thread. Renders user content as
 * plain whitespace-preserved text, agent replies as sanitized markdown
 * (so lists, code blocks, and inline citations land formatted), and
 * agent errors as a red banner. Citations resolved via the `chunkMap`
 * are linked into the KB-explorer through {@link SourcesDisclosure}.
 */
export function MessageBubble({
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
				// `min-w-0` is critical for wide markdown content (code
				// blocks, tables) — without it the `<li>` defaults to
				// `min-width: auto` and is sized by intrinsic content,
				// inflating the parent column past its grid budget. With
				// `min-w-0` the `<li>` is constrained, the bubble's
				// `max-w-[80%]` clamps, and the inner `<pre>` /
				// `overflow-x-auto` on tables/code can scroll horizontally
				// inside the bubble instead of bleeding into siblings.
				"flex flex-col gap-1 min-w-0",
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
					// `break-words` (overflow-wrap: anywhere) lets unbreakable
					// runs like dotted package names / URLs wrap inside the
					// bubble instead of bleeding past the `max-w-[80%]` cap.
					// `min-w-0` lets descendants like `<pre overflow-x-auto>`
					// shrink-and-scroll instead of forcing the bubble wider.
					"max-w-[80%] min-w-0 break-words rounded-lg px-3 py-2 text-sm",
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
			{!isUser ? (
				// `items-start` keeps both chips top-aligned with each other
				// regardless of whether SourcesDisclosure is open (its
				// expanded body grows downward).
				<div className="flex items-start gap-1.5">
					{chunkMap.size > 0 ? (
						<SourcesDisclosure workspaceId={workspaceId} chunks={chunkMap} />
					) : null}
					<AstraQueryCodeButton message={message} />
				</div>
			) : null}
		</li>
	);
}

export function SourcesDisclosure({
	workspaceId,
	chunks,
}: {
	workspaceId: string;
	chunks: ReadonlyMap<string, ChunkRef>;
}) {
	const entries = [...chunks.values()];
	return (
		<details className="text-xs text-slate-500">
			{/*
			 * `<summary>` styled as a chip to match `AstraQueryCodeButton` —
			 * same icon size (3x3), same padding (px-1.5 py-0.5), same text
			 * size (11px), same hover color. The `[&::-webkit-details-marker]`
			 * + `list-none` rules suppress the browser's default disclosure
			 * triangle so the chip's `FileText` icon is the only marker.
			 */}
			<summary
				className={cn(
					"inline-flex cursor-pointer list-none items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium",
					"text-slate-400 transition-colors hover:bg-slate-100 hover:text-[var(--color-brand-700)]",
					"focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-500)]",
					"[&::-webkit-details-marker]:hidden",
				)}
			>
				<FileText className="h-3 w-3" aria-hidden="true" />
				<span>
					{entries.length} source{entries.length === 1 ? "" : "s"}
				</span>
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

export function citationHref(workspaceId: string, ref: ChunkRef): string {
	const params = new URLSearchParams();
	if (ref.documentId) params.set("document", ref.documentId);
	params.set("chunk", ref.chunkId);
	return `/workspaces/${workspaceId}/knowledge-bases/${ref.knowledgeBaseId}?${params.toString()}`;
}

export function EmptyMessages({ agentName }: { agentName: string }) {
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

export function AgentThinking({ agentName }: { agentName: string }) {
	return (
		<li
			className="flex items-center gap-2 self-start rounded-md bg-slate-100 px-3 py-1.5 text-xs"
			data-testid="agent-thinking"
		>
			<Sparkles
				className="h-3.5 w-3.5 animate-wb-thinking-icon"
				aria-hidden="true"
			/>
			<span className="animate-wb-thinking-text font-medium">
				{agentName} is thinking…
			</span>
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
export function StreamingBubble({
	delta,
	agentName,
}: {
	delta: string;
	agentName: string;
}) {
	if (delta.length === 0) return <AgentThinking agentName={agentName} />;
	return (
		<li
			className="flex flex-col gap-1 items-start min-w-0"
			data-testid="agent-streaming"
		>
			<span className="text-xs font-medium text-slate-500">
				{agentName}
				<span className="ml-2 font-normal text-slate-400">streaming…</span>
			</span>
			<div className="max-w-[80%] min-w-0 whitespace-pre-wrap rounded-lg bg-slate-100 px-3 py-2 text-sm text-slate-900">
				{delta}
				<span className="ml-0.5 inline-block animate-pulse text-slate-400">
					▍
				</span>
			</div>
		</li>
	);
}
